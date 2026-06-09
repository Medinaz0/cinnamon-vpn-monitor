// ---------------------------------------------------------------------------
// VPN Monitor — Applet para Cinnamon
// ---------------------------------------------------------------------------
// Monitorea la interfaz VPN tun0 y muestra estado + IP en el panel.
//
// Arquitectura:
//   VpnMonitor  → lógica pura: ejecuta `ip -4 addr show` y parsea salida
//   VpnApplet   → extiende TextIconApplet, maneja UI, timer y menú contextual
//
// Extensibilidad futura:
//   VpnMonitor acepta cualquier nombre de interfaz. Para monitorear múltiples
//   interfaces basta con cambiar el constructor o añadir un array + settings.
// ---------------------------------------------------------------------------

const Applet = imports.ui.applet;
const GLib  = imports.gi.GLib;
const Gio   = imports.gi.Gio;
const St    = imports.gi.St;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Util  = imports.misc.util;

// ---------------------------------------------------------------------------
// VpnMonitor — detección de interfaz VPN
// ---------------------------------------------------------------------------
//   check() → { connected: bool, ip: string|null, error: string|null }
//
//   Usa `ip -4 addr show <iface>` que devuelve algo como:
//     7: tun0: <POINTOPOINT,MULTICAST,NOARP,UP> mtu 1500 qdisc fq_codel ...
//         inet 10.8.0.1/24 scope global tun0
//         ...
//   Si existe una línea "inet" extraemos la IP. Si no → desconectado.
// ---------------------------------------------------------------------------

var VpnMonitor = class VpnMonitor {

    /**
     * @param {string} interfaceName — nombre de interfaz a monitorear (ej: "tun0")
     */
    constructor(interfaceName) {
        this._interfaceName = interfaceName || 'tun0';
    }

    /**
     * Ejecuta el chequeo de la interfaz.
     * @returns {{ connected: boolean, ip: (string|null), error: (string|null) }}
     */
    check() {
        try {
            let [ok, stdout, stderr] = GLib.spawn_command_line_sync(
                `ip -4 addr show ${this._interfaceName}`
            );

            // La interfaz no existe o el comando falló
            if (!ok || !stdout || stdout.length === 0) {
                return { connected: false, ip: null, error: null };
            }

            // Convertir el buffer (Uint8Array) a string de forma segura
            let output = this._bytesToString(stdout).trim();
            if (!output) {
                return { connected: false, ip: null, error: null };
            }

            // Buscar "inet <IP>" en la salida
            let match = output.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
            if (match && match[1]) {
                return { connected: true, ip: match[1], error: null };
            }

            // La interfaz existe pero no tiene IP asignada
            return { connected: false, ip: null, error: null };

        } catch (e) {
            return { connected: false, ip: null, error: `Error al ejecutar ip: ${e.message}` };
        }
    }

    /**
     * Convierte un Uint8Array (o GLib.Bytes) a string UTF-8.
     */
    _bytesToString(bytes) {
        if (!bytes) return '';
        if (typeof bytes === 'string') return bytes;

        // Soporte para Uint8Array y array-like
        let chunk = [];
        for (let i = 0; i < bytes.length; i++) {
            chunk.push(String.fromCharCode(bytes[i]));
        }
        return chunk.join('');
    }
};


// ---------------------------------------------------------------------------
// VpnApplet — applet de panel Cinnamon
// ---------------------------------------------------------------------------

var VpnApplet = class VpnApplet extends Applet.TextIconApplet {

    /**
     * @param {object} metadata — contenido de metadata.json
     * @param {number} orientation — St.Side.TOP | BOTTOM | LEFT | RIGHT
     * @param {number} panelHeight — altura del panel en píxeles
     * @param {number} instanceId — identificador único de instancia
     */
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        // Inicializar monitor para tun0 (extensible: pasar otro nombre aquí)
        this._monitor    = new VpnMonitor('tun0');

        // Estado interno
        this._connected  = false;
        this._currentIp  = null;
        this._timeoutId  = null;

        // Construir UI y menú
        this._initUI();
        this._buildMenu();

        // Arrancar polling
        this._startPolling();
    }


    // =================== UI ===================

    /**
     * Prepara la apariencia inicial del applet.
     */
    _initUI() {
        this.set_applet_label('● VPN ...');
        this.set_applet_tooltip('VPN Monitor — iniciando...');

        // Clases CSS para personalización vía stylesheet.css
        this.actor.add_style_class_name('vpn-applet');
        if (this._label) {
            this._label.add_style_class_name('vpn-label');
        }
    }


    // =================== Menú contextual ===================

    /**
     * Construye (o reconstruye) el menú contextual del applet.
     * Se llama desde el constructor y desde on_orientation_changed.
     */
    _buildMenu() {
        // Crear manager y menú si no existen aún
        if (!this._menuManager) {
            this._menuManager = new PopupMenu.PopupMenuManager(this);
        }
        if (!this._menu) {
            this._menu = new Applet.AppletPopupMenu(this, this._orientation);
            this._menuManager.addMenu(this._menu);
        }

        // Limpiar elementos previos (útil en re-construcción por cambio de orientación)
        this._menu.removeAll();

        // ---- Refresh Now ----
        let refreshItem = new PopupMenu.PopupMenuItem('🔄 Refresh Now');
        refreshItem.connect('activate', () => this._refresh());
        this._menu.addMenuItem(refreshItem);

        // ---- Copy IP ----
        this._copyItem = new PopupMenu.PopupMenuItem('📋 Copy IP');
        this._copyItem.connect('activate', () => this._copyIpToClipboard());
        this._menu.addMenuItem(this._copyItem);

        // ---- Open Terminal ----
        let termItem = new PopupMenu.PopupMenuItem('🖥️ Open Terminal');
        termItem.connect('activate', () => {
            Util.spawnCommandLine('x-terminal-emulator');
        });
        this._menu.addMenuItem(termItem);

        // ---- Separador ----
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ---- About ----
        let aboutItem = new PopupMenu.PopupMenuItem('About VPN Monitor');
        aboutItem.connect('activate', () => {
            Util.spawnCommandLine(
                'xdg-open https://github.com/medinaz0/cinnamon-vpn-monitor'
            );
        });
        this._menu.addMenuItem(aboutItem);

        // Sincronizar estado del menú con el estado actual
        this._updateMenuState();
    }

    /**
     * Copia la IP actual al portapapeles del sistema.
     * Intenta xclip (común en Mint) con fallback a xsel.
     */
    _copyIpToClipboard() {
        if (!this._currentIp) return;

        let ip = this._currentIp;
        GLib.spawn_command_line_async(
            `bash -c 'printf "%s" "${ip}" | xclip -selection clipboard 2>/dev/null || ` +
            `printf "%s" "${ip}" | xsel -ib 2>/dev/null'`
        );
    }


    // =================== Polling cada 3 segundos ===================

    /**
     * Inicia el timer de actualización periódica.
     * Ejecuta el primer chequeo inmediatamente, luego cada 3s.
     */
    _startPolling() {
        this._refresh();                           // inmediato
        this._timeoutId = Mainloop.timeout_add_seconds(
            3,
            () => { this._refresh(); return true; } // true = mantener timer vivo
        );
    }

    /**
     * Ejecuta un chequeo completo y actualiza UI + menú.
     */
    _refresh() {
        let result = this._monitor.check();
        this._connected = result.connected;
        this._currentIp = result.ip;

        this._updateDisplay(result);
        this._updateMenuState();
    }


    // =================== Actualización visual ===================

    /**
     * Actualiza el label del panel y el tooltip según el resultado.
     * @param {{ connected, ip, error }} result — salida de VpnMonitor.check()
     */
    _updateDisplay(result) {
        // --- Error ---
        if (result.error) {
            this.set_applet_label('● VPN ERR');
            this.set_applet_tooltip(`VPN Monitor — ${result.error}`);
            this._setStyle('error');
            return;
        }

        // --- Conectada ---
        if (result.connected && result.ip) {
            this.set_applet_label(`● VPN  ${result.ip}`);
            this.set_applet_tooltip(
                [
                    `VPN — Conectada`,
                    `Interfaz: tun0`,
                    `IP: ${result.ip}`,
                    `Estado: Activa`,
                    `Última actualización: hace unos segundos`
                ].join('\n')
            );
            this._setStyle('connected');
            return;
        }

        // --- Desconectada ---
        this.set_applet_label('● VPN  OFF');
        this.set_applet_tooltip(
            [
                `VPN — Desconectada`,
                `Interfaz: tun0`,
                `Estado: Inactiva`,
                `Última actualización: hace unos segundos`
            ].join('\n')
        );
        this._setStyle('disconnected');
    }

    /**
     * Aplica la clase CSS correspondiente al estado actual.
     * @param {'connected'|'disconnected'|'error'} state
     */
    _setStyle(state) {
        ['connected', 'disconnected', 'error'].forEach(cls => {
            this.actor.remove_style_class_name(`vpn-${cls}`);
            if (this._label) {
                this._label.remove_style_class_name(`vpn-${cls}`);
            }
        });
        this.actor.add_style_class_name(`vpn-${state}`);
        if (this._label) {
            this._label.add_style_class_name(`vpn-${state}`);
        }
    }

    /**
     * Habilita/deshabilita elementos del menú según el estado actual.
     */
    _updateMenuState() {
        if (this._copyItem) {
            this._copyItem.setSensitive(this._connected && !!this._currentIp);
        }
    }


    // =================== Ciclo de vida del applet ===================

    /**
     * Se dispara al hacer clic sobre el applet en el panel.
     */
    on_applet_clicked(event) {
        this._menu.toggle();
    }

    /**
     * Se dispara cuando el applet es removido del panel.
     * Limpia el timer y el menú para evitar fugas de memoria.
     */
    on_applet_removed_from_panel() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        if (this._menuManager) {
            this._menuManager = null;
        }
    }

    /**
     * Se dispara cuando el panel cambia de orientación.
     * Reconstruye el menú con la nueva orientación.
     */
    on_orientation_changed(orientation) {
        this._orientation = orientation;

        // Destruir menú anterior y crear uno nuevo con la orientación correcta
        if (this._menu) {
            this._menuManager.removeMenu(this._menu);
            this._menu.destroy();
        }

        this._menu = new Applet.AppletPopupMenu(this, orientation);
        this._menuManager.addMenu(this._menu);
        this._buildMenu();
    }
};


// ---------------------------------------------------------------------------
// Punto de entrada — Cinnamon llama a main() al cargar el applet
// ---------------------------------------------------------------------------

/**
 * @param {object}  metadata       — contenido de metadata.json
 * @param {number}  orientation    — orientación del panel
 * @param {number}  panelHeight    — altura del panel
 * @param {number}  instanceId     — ID de instancia
 * @returns {VpnApplet}
 */
function main(metadata, orientation, panelHeight, instanceId) {
    return new VpnApplet(metadata, orientation, panelHeight, instanceId);
}
