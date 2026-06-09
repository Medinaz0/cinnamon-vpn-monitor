# VPN Monitor — Cinnamon Applet

Monitorea el estado de interfaces VPN (`tun0`) directamente en el panel de Cinnamon.

- 🟢 Muestra la IP de la VPN cuando está conectada
- 🔴 Indica **VPN OFF** cuando está desconectada
- Tooltip con detalles de la interfaz
- Menú contextual con Refresh, Copy IP, Open Terminal

## Requisitos

- Linux Mint con Cinnamon 6.0+ (Mint 21.x+)
- `iproute2` (incluido en toda distribución Linux)

## Instalación

```bash
# 1. Clonar el repo
git clone https://github.com/medinaz0/cinnamon-vpn-monitor.git

# 2. Copiar al directorio de applets de Cinnamon
cp -r cinnamon-vpn-monitor/vpnmonitor@medinaz0 ~/.local/share/cinnamon/applets/

# 3. Recargar Cinnamon
ctrl + alt + esc

# 4. Click derecho en panel → Applets → + VPN Monitor
```

Luego recargar Cinnamon y agregar desde la interfaz de Applets.

## Uso

| Estado         | Label               | Color |
|----------------|---------------------|-------|
| Conectada      | `● VPN 10.8.0.1`    | Verde |
| Desconectada   | `● VPN OFF`         | Gris  |
| Error          | `● VPN ERR`         | Rojo  |

### Menú contextual

| Opción           | Descripción                              |
|------------------|------------------------------------------|
| 🔄 Refresh Now   | Fuerza una actualización inmediata       |
| 📋 Copy IP       | Copia la IP de VPN al portapapeles       |
| 🖥️ Open Terminal | Abre la terminal del sistema             |
| About            | Enlace al repo                           |

## Personalización

Los colores de estado se definen en `stylesheet.css`. Podés cambiarlos editando las reglas:

```css
.vpn-connected    { color: #4CAF50; }  /* verde */
.vpn-disconnected { color: #9E9E9E; }  /* gris */
.vpn-error        { color: #F44336; }  /* rojo */
```
## Extender a otras interfaces

Por defecto monitorea `tun0`. Para cambiar la interfaz es tan simple como:

1. Abrir `applet.js`
2. Buscar la línea:
   ```js
   this._monitor = new VpnMonitor('tun0');
   ```
3. Cambiar por la interfaz deseada (ej: `wg0`, `ppp0`, `ovpn`):
   ```js
   this._monitor = new VpnMonitor('wg0');
   ```
4. Recargar Cinnamon: `cinnamon --replace &`

La clase `VpnMonitor` es agnóstica al tipo de interfaz — funciona con cualquier nombre.

## Arquitectura

```
VpnMonitor          → lógica pura: ejecuta `ip -4 addr show` y parsea la IP
  └─ check()       → { connected, ip, error }

VpnApplet           → extiende TextIconApplet del framework de Cinnamon
  ├─ Timer 3s      → polling automático sin consumir recursos
  ├─ Menú contextual → Refresh, Copy IP, Terminal, About
  ├─ Tooltip       → información multilínea al hacer hover
  └─ CSS classes   → connected / disconnected / error
```

## Licencia

GNU General Public License v2.0 — ver [LICENSE](LICENSE).
