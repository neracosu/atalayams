# Crear un tema para Atalaya

Un tema cambia **el mundo** (cómo se dibujan el servidor, las cuentas, los servicios, las visitas,
los ataques y los agentes) **y el HUD** (cómo se ven y dónde van los paneles). No es una paleta de
colores: es otra forma de mirar el mismo servidor.

Atalaya trae diez temas que sirven de ejemplo:

| Tema | Técnica | Mundo | HUD |
|---|---|---|---|
| `ciudad` | 2D, PixiJS | Ciudad isométrica: distritos, edificios, robots | Paneles a los lados, cinta abajo |
| `villa` | 2D, PixiJS | RPG de casillas: castillo, pueblos, aldeanos, slimes, magos | Marcos de madera, barras de estado, registro tipo chat |
| `raid` | 2D, PixiJS | Arena de MMO: héroes con vida y maná, jefe, números de combate | Barra de acción abajo, registro de combate, medidor |
| `oficina` | 2D, PixiJS | Piso de oficina isométrico estilo hotel virtual: salas, escritorios, globos de diálogo | Intranet corporativa, directorio bajo cada sala |
| `castillo` | 2D, PixiJS | Castillo gótico de costado: torre del reloj, salas, candelabros, vitrales, murciélagos | Marcos heredados de Villa, en noche gótica |
| `ciudad3d` | 3D, three.js | La ciudad de noche: torres, calles, portal «Internet» | El de la Ciudad clásica |
| `acuario` | 3D, three.js | Pared de peceras: una por cuenta, con su placa | Franja inferior con tres placas |
| `ops` | 3D, three.js | Mesa táctica holográfica: sectores, columnas, misiles, drones | Lecturas arriba, fichas de sector con línea guía |
| `planta` | 3D, three.js | Fábrica (paleta PICO-8): naves, máquinas, cintas, drones | Sala de control con pantallas LCD |
| `terminal` | Solo HTML | Consola de fósforo: ventanas de texto, `tail -f`, `sshd` | Todo en texto |

Buenos puntos de partida: `villa` para **arte hecho en código** (todas las texturas se pintan con
funciones o matrices de caracteres, sin archivos de imagen), `oficina` para **isométrico con muebles y
personajes**, `acuario` o `planta` para **3D**, y `terminal` para un tema **sin lienzo**, solo HTML.

## 1. La carpeta

```
web/themes/<id>/
  theme.json     obligatorio: nombre, paleta, layout, leyenda, créditos
  world.js       obligatorio: el mundo (módulo ES con una clase por defecto)
  theme.css      opcional: el HUD de este tema
  preview.png    opcional: captura para el selector de temas
  ...            sprites, fuentes (woff2) y lo que el tema necesite
```

El `<id>` va en minúsculas, con números y guiones (`villa`, `raid`, `terminal-crt`). Atalaya
encuentra la carpeta sola: no hay que registrar nada ni reiniciar.

Para probarlo en una pantalla sin cambiar las demás: `https://SU-ATALAYA/?theme=<id>`, o la tecla
**T**, o el menú › **Tema**.

## 2. `theme.json`

```json
{
  "id": "villa",
  "name": "Villa",
  "description": "Qué es el mundo, en una o dos frases.",
  "author": "Su nombre",
  "version": "1.0.0",
  "license": "La del tema, y la de cada recurso de terceros",
  "world": "world.js",
  "css": "theme.css",
  "preview": "preview.png",
  "hud": { "layout": "barra-lateral" },
  "palette": { "ok": "#…", "warn": "#…", "crit": "#…", "hostile": "#…", "friendly": "#…", "accent": "#…", "bg": "#…", "ink": "#…" },
  "rule": "La regla de oro del tema, en una frase.",
  "credits": [{ "what": "Fuente X", "author": "…", "license": "SIL OFL 1.1", "url": "…" }],
  "legend": [
    { "title": "El mundo", "items": [
      { "icon": "house", "title": "Casa", "text": "Un servicio." },
      { "color": "#ff4d3d", "title": "Rojo", "text": "Caído." }
    ] }
  ]
}
```

- **`palette` tiene significado, no decoración.** `ok` sano, `warn` alerta, `crit` falla,
  `hostile` ataque, `friendly` lo propio, `accent` un solo color de marca, `bg` fondo, `ink` texto.
  El administrador de temas las publica como variables CSS `--t-ok`, `--t-warn`, etc., y el mundo
  las recibe en `manifest.palette`.
- **`hud.layout`** queda en `body[data-layout]`, por si varios temas comparten un layout.
- **`legend`** es lo que muestra la tecla `?`. `icon` es un ícono pixel de Atalaya
  (`web/js/pixicons.js`: `house`, `invader`, `bot`, `shield`, `db`, `web`, `terminal`, `chart`,
  `antenna`, `refresh`, `warn`, `ok`, …) o `color` para un punto de color.
- **`rule`**: la regla que no se rompe. Ejemplos: «nada redondeado ni brillante» (Ops), «la
  información vive en la ciudad antes que en números» (Ciudad).

## 3. `world.js`: el mundo

Un módulo ES que exporta **por defecto** una clase. Hay dos caminos: dibujar en 2D con PixiJS 8
(`/vendor/pixi.csp.mjs`) o en 3D con three.js y el motor compartido `/js/stage3d.js` (ver
[El motor 3D](#el-motor-3d-stage3d)). El administrador de temas la usa así:

```js
const w = new World(contenedorDom, { manifest });   // manifest = el theme.json
await w.init();                                      // crear el canvas dentro del contenedor
w.update(state);                                     // cada ~2 s: el estado completo
w.onEvent(evento, priv);                             // cada evento en vivo
w.destroy();                                         // al cambiar de tema: quitar canvas y escuchas
```

Métodos que la pantalla llama:

| Método | Para qué |
|---|---|
| `pick(kind, id)` | Enfocar algo y avisar con `onSelect(kind, id)` (abre el panel de detalle) |
| `clearSelection()` | El panel de detalle se cerró |
| `setInsets({ top, right, bottom, left })` | Cuánto espacio ocupan los paneles del HUD: el mundo se encuadra en el resto |
| `setDirector(bool)`, `directorOn` | Modo director (cámara automática), tecla D |
| `resetView()`, `zoomBy(f)` | Botones de navegación |
| `navChanged()` | Avisar el estado de la cámara con `onNav({ mode: 'director' \| 'fixed' \| 'manual', left })` |
| `screenOf(kind, id)` | *Opcional, pero muy recomendado.* Dónde está en la ventana una sesión (`'session'`, id de la sesión), un subagente (`'agent'`, `sesión/agente`), un proyecto (`'app'` o `'site'`), la torre del servidor (`'tower'`) o la entrada de Internet (`'gate'`): `{ x, y }` en píxeles, o `null`. Con esto se dibujan **sobre su mundo, sin que usted programe nada**: la comunicación entre agentes (encargos, resultados, mensajes, el haz al proyecto), los autos que buscan rutas vulnerables, el haz de entrada y salida de cada sesión, las **patrullas voladoras** de la vigilancia (salen de `'tower'`; sin ella, del borde de la pantalla), los reflectores de un pico de visitas, el pulso de una consulta lenta y la marca del director. Sin `screenOf`, lo de los agentes va entre las tarjetas del panel y lo demás no se ve. En Pixi, `pixiScreen(app, objeto)` de `../../js/commfx.js` lo resuelve; los temas sobre `Stage3D` ya lo traen. |
| `t`, `manualUntil` | El reloj del mundo en segundos y hasta cuándo la cámara es del usuario. El **director** (`/js/director.js`) llama a `pick(kind, id)` sin abrir la ficha y pone `manualUntil = t + segundos`: cuando `t` lo pasa, su mundo debe devolver la cámara a su recorrido o vista general. |

Callbacks que la pantalla le asigna al mundo:

- `onSelect(kind, id)`: el usuario tocó algo. `kind` ∈ `app`, `site`, `session`, `district`,
  `system`, `security`.
- `onTip({ title, body, meta, hint } | null, x, y)`: tooltip al pasar el mouse. `body` y `meta`
  admiten HTML simple; todo texto que venga del servidor pásenlo por `esc()` de `/js/hud.js`.
- `onNav(estado)`: para el botón de cámara.

Reglas técnicas:

- **Importen con rutas relativas** (`../../js/hud.js`, `../../vendor/pixi.csp.mjs`), nunca
  absolutas (`/js/...`): en Atalaya Cloud cada pantalla vive bajo su propio prefijo
  (`/su-pantalla/`) y una ruta absoluta apuntaría al portal. Las pruebas lo revisan.
- El pixel art de Atalaya (robot, invasor, sobre, carteles) está como datos en
  `../../js/pixeldata.js`, sin PixiJS: sirve para canvas, SVG o lo que el tema use.
- **Todas las escuchas globales** (`window.addEventListener`) con un `AbortController`, y
  `destroy()` las quita. Si no, al cambiar de tema quedan escuchas vivas.
- En Pixi 8 un `Graphics` no debe tener hijos: los textos van en un `Container` aparte.
- Nunca bajen la resolución de todo el lienzo para lograr un look pixel: se ve borroso en un
  televisor. Mezclen formas y textos nítidos con acentos en pixel art.

### El motor 3D (`Stage3D`)

Para un tema en 3D, extiendan `Stage3D` de `/js/stage3d.js`: ya trae la interfaz de arriba completa
(cámara con director, navegación con arrastre y rueda, encuadre en el área libre del HUD, clics,
tooltips y limpieza). El tema solo llena estos ganchos:

```js
import { Stage3D, THREE, color, clamp, billboard, rowsCanvas } from '../../js/stage3d.js';

export default class MiTema extends Stage3D {
  constructor(el, opts) { super(el, opts); this.fov = 34; this.view = { az: -0.9, el: 0.8, dist: 50, tx: 0, ty: 0, tz: 0, zoom: 1 }; }
  async build() { /* armar la escena en this.scene (luces, suelo) */ }
  update(state) { /* crear o ajustar objetos; lo que se pueda tocar va en this.pickables con userData { kind, id } */ }
  onEvent(e, priv) { /* efectos: this.float(pos, texto, tono), this.ring(pos), this.sparks(pos), this.travel(obj, curva, s) */ }
  frame(dt) { /* animacion por cuadro; this.t es el tiempo */ }
  shots() { return [{ x, y, z, zoom }]; }         // tomas del modo director
  locate(kind, id) { return { x, y, z, zoom }; }  // a donde ir al elegir algo en el HUD
  tipFor(u) { return { title, body, meta, hint }; } // tooltip de lo que esta bajo el mouse
}
```

- **Textos nítidos**: `this.label(clase, html, pos)` crea una etiqueta HTML que sigue a un punto (o a
  una función que devuelve el punto, o `null` para ocultarla). Las clases `w3-group`, `w3-item`,
  `w3-agent`, `w3-plaque` y `w3-fish` ya tienen estilo; las `w3-item` y `w3-fish` se esconden solas
  si se pisan en pantalla. Con `data-go="kind:id"` la etiqueta se puede tocar.
- **Pixel art como acento**: `billboard(rowsCanvas(filas, paleta, escala), tamaño)` hace un sprite
  nítido que siempre mira a la cámara (carteles, robots, invasores). El resto, formas limpias.
- **Que se ubique todo sin hacer clic**: nombres visibles al acercarse y una placa que liste lo que
  hay adentro. El motor trae las piezas:
  - `groupsOf(state)`: las cuentas con sus servicios y sitios; `layoutKeyOf(state)` dice si cambió algo.
  - `packRows(grupos, { w, h, gap, aspect, lead, extraH })`: reparte los grupos en filas para que se
    vean lo más grandes posible.
  - `plaqueList(items, iconoDe)`: la lista HTML de una placa (con `data-go` para abrir cada uno).
  - En cada cuadro, `sizePlaques([[placa, anchoEnUnidades]])` ajusta ancho y letra al zoom, y
    `refitPlaques(grupos, k)` mide las placas reales y rearma la distribución si alguna no cabe (en
    pantallas chicas las deja compactas). `distToFit(w, h)` da la distancia de cámara exacta.
  - Acuario, Planta, Ciudad 3D y Ops son ejemplos completos en 3D.
  - Los temas 2D usan las mismas piezas desde `/js/layout.js` (`groupsOf`, `layoutKeyOf`,
    `packRows`, `plaqueList`, `iconURL`); la Oficina es el ejemplo.

### El estado (`update(state)`)

```js
{
  priv: false,                       // modo privado: si es true, hay nombres reales
  system: { cpu, cores, load: [1, 5, 15], mem: { total, used, pct }, uptime, ... },
  accounts: [{ id, label, color, reqMin, sites, claudeProcs }],     // 'root' = el servidor
  apps:  [{ id, account, name, kind, icon, favicon, source, status, cpu, mem, reqMin, instances, online }],
  sites: [{ id, account, name, kind, icon, favicon, type, status, reqMin, lastSeen }],
  sessions: [{ id, account, state, station, activity, waitKind, subagents: [...], tokensOut, tools }],
  keys: [{ label, unit, state }],    // servicios clave: 'active' | 'failed' | 'inactive'
  saturation: { level, causes: [{ id, level, label }], since },   // 'ok' | 'warn' | 'bad' (servidor al límite)
  silos: { list: [{ account, size, n, conns, active, sleep, busy, slow, links: [{ kind, id, active, busy }] }], hot, sb: [{ from, to }] },
  jail: { n, atalaya, quarantine },  // presos (IPs bloqueadas), cuántos puso Atalaya y archivos en cuarentena
  security: { ... }, mail: { ... }, traffic: [...], top: [...]
}
```

- `status`: `online`, `degraded` o `down`.
- `source`: `pm2`, `systemd`, `docker`, `vercel` o `supabase`. `type` (sitios): `wordpress`,
  `php`, `static`, `proxy` o `wip`.
- `icon`: nombre de un cartel pixel (`shop`, `hotel`, `calendar`, `card`, `wp`, `db`, …). Cada
  proyecto trae uno: el de su categoría o uno propio elegido al azar (fijo para ese proyecto).
- **Favicons**: en modo privado, cuando el favicon real del proyecto ya está cargado, `icon` llega
  como `fav:<clave>`. Dibujen los íconos siempre con `signCanvas(icon, escala)` (canvas) o
  `signTexture(icon)` (textura de Pixi) de `/js/sprites.js`: ya saben dibujar ambos, con el mismo
  tamaño que un cartel. Incluyan `icon` en la huella de su distribución (`layoutKeyOf` ya lo hace)
  para rearmar el cartel cuando llega el favicon.
- `health`: la salud del servidor, `[{ id, title, icon, status, bad, warn }]`. `healthLine(state)` de
  `/js/layout.js` la resume en una línea con su color para ponerla junto al servidor del mundo.
- `accounts[i].quota` (VPS con cPanel): `{ what, pct, level }` cuando una cuenta pasa del 85 % de disco, inodos o
  ancho de banda; la ciudad lo marca con una línea bajo su distrito.
- `saturation`: la ciudad pone la torre en rojo («SERVIDOR AL LÍMITE») y un atasco en el peaje cuando `level` es
  `bad`. `silos`: un silo de datos por cuenta con tuberías a los sitios que usan sus bases (`links`); `sb` une
  cada proyecto de Supabase con su app; `hot` (0 a 1) es cuánto del máximo de conexiones del servidor de bases está en uso. `jail`: la cárcel y sus cápsulas de cuarentena. Los tres son opcionales:
  si su tema no los dibuja, el detalle igual está en las fichas.
- `state` de una sesión: `working`, `thinking` o `idle`. `waitKind` (`permission`, `question`,
  `idle`) si espera al usuario.
- En **modo público** los nombres ya vienen reemplazados por categorías y alias: el tema no
  tiene que esconder nada, pero **no debe guardar ni mostrar** nada que no reciba.

### Los eventos (`onEvent(e, priv)`)

| `e.kind` | Campos útiles | Qué pasó |
|---|---|---|
| `http` | `app` o `site`, `account`, `status`, `bot`, `cc` | Una visita (`status` ≥ 500 = error del servidor) |
| `attack` | — | Un intento de acceso fallido |
| `block` | `ip` (solo en privado) | Una IP quedó bloqueada |
| `login` | `user` (solo en privado) | Un acceso SSH correcto |
| `mail` | `dir`: `in`, `out`, `bounce` | Correo |
| `deploy` | `app`, `action`: `building`, `ready`, `error`, `canceled` | Un despliegue |
| `pm2` | `app`, `action`: `down`, `restart` | Un servicio cayó o se reinició |
| `domain` | `account`, `action`: `added`, `removed`, `changed` | Cambió un dominio |
| `claude` | `sid`, `account`, `action`: `start`, `end`, `permission`, `approved`, `tool`, `prompt`, `done`, `error` | Un agente hizo algo (`start` y `end`: la sesión empieza o termina) |
| `probe` | `app` o `site`, `fam`, `status`, `exposed` | Un robot probó una ruta vulnerable (`exposed`: respondió) |
| `watch` | `app` o `site`, `action`: `start`, `end`, `reason`: `scan`, `scraping`, `surge`, `n` | Un sitio entra o sale de vigilancia |
| `db` | `app` o `site` (si se sabe), `action`: `slow`, `secs` | Una consulta lenta a la base de ese sitio |
| `defense` | `app` o `site`, `action`: `block`, `unblock`, `expire`, `reason`, `by`: `auto` o `manual`, `ip` (solo en privado) | Una IP va a la cárcel o sale |
| `phpfile` | `site`, `action`: `suspect`, `hit`, `quarantine`, `why`, `path` e `ip` (solo en privado) | Una posible puerta trasera, alguien la buscó o se puso en cuarentena |
| `saturation` | `action`: `start`, `end`, `causes` | El servidor llega al límite o vuelve a tener margen |

Además, `state.sites[i].watch` y `state.apps[i].watch` traen `{ reason, n, since }` mientras un sitio esté en
vigilancia: sirve para que el tema marque el edificio a su manera (las patrullas de la capa de efectos ya
aparecen solas si el tema tiene `screenOf`).

## 4. `theme.css`: el HUD

El HUD es el mismo HTML para todos los temas (mismos `id`), y cada tema lo **reacomoda y
restiliza**. Todo el CSS del tema va bajo `body[data-theme="<id>"]` para no pisar a otros.

| Elemento | Qué es |
|---|---|
| `#top` | Barra superior: marca, indicadores (`.kpi`), modo, reloj y menú |
| `#left` | Agentes de Claude Code (`.agent`) |
| `#right` | Gráficas (`#chCpu`, `#chReq`), procesos, proyectos, defensa y correo |
| `#ticker` / `#log .ev` | Cinta de novedades (Ops la vuelve una columna arriba a la derecha) |
| `#navbar` | Botones de cámara |
| `.drawer` | Panel de detalle |
| `dialog` | Leyenda, temas, novedades, instalar |

Variables que conviene redefinir: `--bg`, `--panel`, `--panel-solid`, `--line`, `--line-strong`,
`--ink`, `--ink-2`, `--ink-3`, `--accent`, `--good`, `--warn`, `--bad`, `--radius`, `--font`,
`--pixel`, `--mono`, y los colores de las gráficas `--chart-1` a `--chart-4`.

Se puede **mover** cada panel (`top`, `left`, `right`, `bottom`, `width`), **esconderlo**
(`display: none`) o cambiarle el título con CSS (ver `#left h2 .pix::after` en Ops).

**El espacio del mundo.** Por defecto, Atalaya mide dónde quedaron los paneles y encuadra el mundo en
lo que sobra. Si el tema pone paneles en las esquinas, conviene declarar el rectángulo exacto con
`#worldArea` (un elemento invisible que solo sirve para medir):

```css
body[data-theme="villa"] #worldArea { display: block; top: 6.4rem; bottom: 1.2rem;
  left: calc(19vw + 2.6rem); right: calc(22vw + 2.6rem); }
```

Fuentes: dentro de la carpeta del tema, con `@font-face` y ruta relativa (`url(mi-fuente.woff2)`).

**Si la columna derecha no entra en el alto**, Atalaya achica las gráficas lo justo para que se vea
todo: no hace falta resolverlo en el tema.

### Teléfonos y tablets

Con pantallas de hasta 1100 px de ancho (o 560 px de alto) Atalaya pone `body.compact` y **acomoda el
HUD por su cuenta** en todos los temas: barra fina arriba, tira de indicadores, el mundo en el centro,
la última novedad y pestañas abajo (con el teléfono acostado, a la derecha). Esas reglas pisan la
posición que el tema le dio a cada panel, pero conservan sus colores y su letra. Lo que sí le toca al
tema:

- **Que el mundo quepa en un área vertical**: `setInsets` puede traer un área más alta que ancha. Los
  temas 3D ya alejan la cámara solos; en 2D, encuadren con el ancho y el alto del área.
- **Achicar sus textos** cuando el área es angosta (Villa y Raid los escalan con el ancho del área).
- Probar con la ventana angosta, o en el simulador con las herramientas de teléfono del navegador.

## 5. Reglas de Atalaya

- **Pixel art como acento, textos nítidos.** Sprites e íconos en pixel art; los textos y las formas
  grandes, nítidos. Nunca se baja la resolución de todo el lienzo. **Nada de emojis**, en ningún lado.
- **Inspirado, no copiado.** Se puede tomar un género (RPG de casillas, raid de MMO, operaciones
  tácticas, terminal), nunca nombres, logos, sprites, fuentes ni marcos de un juego existente.
- **Licencias claras.** Arte propio, CC0 (Kenney, parte de OpenGameArt) o fuentes SIL OFL. Cada
  recurso de terceros va en `credits` con su licencia.
- **Sin red externa.** La pantalla bloquea toda conexión que no sea con el propio Atalaya (CSP).
  Todo lo que el tema use va dentro de su carpeta.
- **Colores con significado.** El verde, el ámbar y el rojo dicen algo; no se usan de adorno.
- **Legible en una TV a tres metros.** Pocas cifras grandes; el resto, en forma y movimiento.
- **Cada proyecto se ubica sin hacer clic.** Una placa o lista por cuenta, o nombres visibles al acercarse.

## 6. Probar

1. Copie el tema más parecido al que quiere (`web/themes/<otro>` a `web/themes/<id>`) y cambie el
   `id` en `theme.json`.
2. Abra `https://SU-ATALAYA/?theme=<id>` y recargue al guardar.
3. Revise con la consola del navegador abierta que no haya errores, que el cambio con la tecla
   **T** vaya y vuelva sin dejar nada colgado, que en modo público no aparezca nada privado, y que se
   vea bien en una TV (1920×1080), en un monitor ultra ancho y en un teléfono.
4. `npm test` revisa que el manifiesto sea válido y que `world.js` exporte una clase con la
   interfaz completa.
