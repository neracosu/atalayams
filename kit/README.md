<p align="center">
  <img src="docs/img/banner.svg" alt="Atalaya Monitor Server" width="100%">
</p>

<h1 align="center">Kit de temas</h1>

<p align="center">
  <img alt="Interfaz de Atalaya" src="https://img.shields.io/badge/interfaz-{{VERSION}}-22d3ee?style=flat-square&labelColor=0b1530">
  <img alt="Node 20+" src="https://img.shields.io/badge/node-20%2B-34d399?style=flat-square&labelColor=0b1530">
  <img alt="Sin instalar nada" src="https://img.shields.io/badge/sin-dependencias-a78bfa?style=flat-square&labelColor=0b1530">
  <img alt="10 temas" src="https://img.shields.io/badge/temas-10-f472b6?style=flat-square&labelColor=0b1530">
</p>

<p align="center">
  <a href="#los-temas-que-ya-vienen"><b>Galería</b></a> ·
  <a href="#empezar"><b>Empezar</b></a> ·
  <a href="#lo-que-su-tema-recibe-gratis"><b>Gratis en su tema</b></a> ·
  <a href="#crear-un-tema"><b>Crear un tema</b></a> ·
  <a href="docs/TEMAS.md"><b>Guía completa</b></a>
</p>

<p align="center"><b>Atalaya Monitor Server:</b> <a href="https://neracosu.com/atalaya/">neracosu.com/atalaya</a> · <a href="https://neracosu.com/atalaya/vibe-coding/">para vibe coders</a> · <a href="https://github.com/neracosu/atalayams">código de Atalaya</a></p>

<br>

Todo lo necesario para **diseñar un tema de Atalaya** sin tener un servidor: la interfaz real de
Atalaya, un **simulador** que reproduce en bucle unos minutos grabados de un servidor de verdad (en
**modo público**: sin nombres, dominios ni IPs) y la guía completa.

Un tema cambia **el mundo** (cómo se ven el servidor, las cuentas, los servicios, las visitas, los
ataques y los agentes de Claude Code) **y el HUD** (cómo se ven y dónde van los paneles). Puede ser
pixel art en 2D con PixiJS, 3D con three.js o solo HTML.

---

## Los temas que ya vienen

<table>
  <tr>
    <td width="50%"><img src="docs/img/theme-ciudad.webp" alt="Ciudad clásica"><br><sub><b><code>ciudad</code></b> · 2D, PixiJS. Ciudad isométrica en pixel art: distritos, edificios, robots, autos e invasores.</sub></td>
    <td width="50%"><img src="docs/img/theme-ciudad3d.webp" alt="Ciudad 3D"><br><sub><b><code>ciudad3d</code></b> · 3D, three.js. La ciudad de noche: torres que crecen con la memoria.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/img/theme-oficina.webp" alt="Oficina"><br><sub><b><code>oficina</code></b> · 2D, PixiJS. Piso isométrico estilo hotel virtual, con globos de diálogo.</sub></td>
    <td><img src="docs/img/theme-acuario.webp" alt="Acuario"><br><sub><b><code>acuario</code></b> · 3D, three.js. Una pared de peceras: una por cuenta, con la placa de sus peces.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/img/theme-villa.webp" alt="Villa"><br><sub><b><code>villa</code></b> · 2D, PixiJS. RPG de casillas: castillo, pueblos amurallados, aldeanos, slimes y magos.</sub></td>
    <td><img src="docs/img/theme-ops.webp" alt="Ops"><br><sub><b><code>ops</code></b> · 3D, three.js. Mesa táctica holográfica con fichas de sector.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/img/theme-raid.webp" alt="Raid"><br><sub><b><code>raid</code></b> · 2D, PixiJS. Banda de MMO: héroes con vida y maná, números de combate y El Intruso.</sub></td>
    <td><img src="docs/img/theme-planta.webp" alt="Planta"><br><sub><b><code>planta</code></b> · 3D, three.js. Fábrica con paleta PICO-8: máquinas, cintas y drones.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/img/theme-castillo.webp" alt="Castillo"><br><sub><b><code>castillo</code></b> · 2D, PixiJS. Castillo gótico de costado: candelabros, vitrales, murciélagos y espectros.</sub></td>
    <td><img src="docs/img/theme-terminal.webp" alt="Terminal"><br><sub><b><code>terminal</code></b> · Solo HTML. Consola de fósforo verde con ventanas de texto.</sub></td>
  </tr>
</table>

Sirven de ejemplo y de punto de partida: copie el más parecido al que quiere hacer.

---

## Empezar

Requisito: [Node.js](https://nodejs.org) 20 o superior. No hay nada que instalar.

```sh
npm start                 # o: node sim/server.js
```

- Pantalla: <http://localhost:4000/?theme=oficina>
- Escenarios (caídas, ataques, permisos, despliegues, picos de visitas): <http://localhost:4000/sim>
- Tecla **T**: pasar al tema siguiente · **?**: leyenda del tema · **D**: modo director
- Para ver la versión de teléfono: la ventana angosta, o las herramientas de dispositivo del navegador.

---

## Lo que su tema recibe gratis

<p align="center">
  <img src="docs/img/vigilancia.webp" alt="Patrullas voladoras junto a un edificio en vigilancia, reflectores por un pico de visitas y el rótulo del director" width="100%">
</p>

Con un solo método, `screenOf(kind, id)` (dónde está cada cosa en la ventana), Atalaya dibuja **encima de
su mundo** una capa de efectos compartida por todos los temas. Usted no programa nada de esto:

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/img/icons/siren.svg" width="36"><br><b>Patrullas voladoras</b><br><sub>Cuando un sitio está en vigilancia (escaneo o scraping), despegan de su torre (<code>'tower'</code>), custodian el edificio y vuelven.</sub></td>
    <td width="33%" valign="top"><img src="docs/img/icons/fire.svg" width="36"><br><b>Reflectores</b><br><sub>Un pico de visitas sobre el edificio del sitio.</sub></td>
    <td width="33%" valign="top"><img src="docs/img/icons/camera.svg" width="36"><br><b>El director</b><br><sub>Enfoca lo que pasa con su <code>pick(kind, id)</code> y lo cuenta con un rótulo y una marca de esquinas.</sub></td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/img/icons/bot.svg" width="36"><br><b>Agentes que se hablan</b><br><sub>Encargos, resultados, mensajes y el haz al proyecto que se lee o edita; el haz de entrada y salida de cada sesión.</sub></td>
    <td valign="top"><img src="docs/img/icons/invader.svg" width="36"><br><b>Robots que sondean</b><br><sub>El auto con sirena que busca rutas vulnerables y el cartel «EXPUESTO» si una respondió.</sub></td>
    <td valign="top"><img src="docs/img/icons/db.svg" width="36"><br><b>Consultas lentas</b><br><sub>Un pulso con un cilindro y un reloj de arena sobre el sitio cuya base tarda.</sub></td>
  </tr>
  <tr>
    <td valign="top"><img src="docs/img/icons/shield.svg" width="36"><br><b>Escolta a la cárcel</b><br><sub>Cuando se bloquea una IP, las patrullas se llevan el auto sospechoso a la cárcel (<code>'jail'</code>, o hacia el borde si su tema no la tiene).</sub></td>
    <td valign="top"><img src="docs/img/icons/warn.svg" width="36"><br><b>Cápsulas de cuarentena</b><br><sub>Una puerta trasera en cuarentena: la patrulla encierra los bichos del edificio en una cápsula verde y la lleva a la cárcel.</sub></td>
    <td valign="top"><img src="docs/img/icons/lock.svg" width="36"><br><b>Fichas nuevas</b><br><sub>Expediente de cada IP, analítica sin cookies de cada sitio, certificados, accesos a los paneles: todo en las fichas, sin que el tema haga nada.</sub></td>
  </tr>
</table>

La capa queda entre su mundo y la interfaz: nunca tapa una ficha, un menú ni un cuadro. Si prefiere
mostrarlo a su manera, el estado y los eventos traen lo mismo (`watch`, `probe`, `db`, `claude`, `defense`, `phpfile`, `saturation`):
está todo en la [guía](docs/TEMAS.md). La ciudad clásica dibuja además la cárcel, la oficina de correos, los
silos de datos y la torre al límite con `state.jail`, `state.silos` y `state.saturation`; la Ciudad 3D hace lo mismo en
tres dimensiones (vea cómo responde `screenOf('jail')`, `'mail'`, `'gate'` y `'tower'`). Su tema puede hacer lo
mismo a su manera. El simulador trae una cárcel y silos inventados si la grabación no los tiene, y escenarios para
el servidor al límite, una cuota al límite, una IP a la cárcel y un archivo a cuarentena.

---

## Crear un tema

1. Copie un tema parecido: `cp -r web/themes/oficina web/themes/mi-tema`.
2. En `web/themes/mi-tema/theme.json` cambie `id` (igual al nombre de la carpeta), `name`, `author`
   y `description`.
3. Abra <http://localhost:4000/?theme=mi-tema> y recargue cada vez que guarde.
4. `npm run check` revisa que el tema esté completo y cumpla las reglas.

La guía está en [docs/TEMAS.md](docs/TEMAS.md): qué datos recibe el mundo, qué significa cada
evento, cómo reacomodar el HUD, el motor 3D compartido, las placas que nombran cada proyecto, los
favicons, la capa de efectos y cómo se ve en teléfonos y tablets.

## Reglas de Atalaya

- **Pixel art como acento, textos nítidos.** Nunca bajar la resolución de todo el lienzo. Nada de
  emojis, en ningún lado.
- **Inspirado, no copiado.** Géneros sí (RPG, MMO, táctico, terminal…); nombres, logos, sprites,
  fuentes o marcos de un juego existente, no.
- **Cada proyecto se ubica sin hacer clic**: una placa o lista por cuenta, o nombres al acercarse.
- **Al mundo, solo lo que pide atención**; el detalle va en las fichas. Una pantalla que se mira de
  lejos no debe saturarse.
- **Licencias claras.** Arte propio, CC0 o fuentes SIL OFL, cada recurso de terceros en `credits`.
- **Sin red externa.** Todo lo que use el tema va dentro de su carpeta.
- **Colores con significado** y **legible en una TV a tres metros**.

## Entregar un tema

Trabaje en una rama (`tema/<id>`) y abra un pull request con la carpeta `web/themes/<id>/` y una
captura. Solo esa carpeta: lo demás del kit se regenera desde Atalaya y cualquier cambio se pisa.
Antes de publicar un tema, acuerde con NERACOSU cómo se licencia y cómo se lo acredita.

## Qué hay aquí

```
web/              la interfaz de Atalaya (igual a la versión indicada en package.json)
web/themes/       los temas: aquí va el suyo
web/js/stage3d.js motor compartido de los temas 3D
web/js/commfx.js  la capa de efectos compartida (patrullas, director, agentes, sondeos)
web/js/layout.js  agrupar por cuenta, repartir en filas y armar placas (2D y 3D)
sim/              el simulador: servidor, grabación y respuestas de los paneles
docs/TEMAS.md     la guía para crear temas
docs/img/         imágenes de este README
test/             la revisión automática de temas (npm run check)
licenses/         licencias de las librerías y fuentes incluidas
```

---

<p align="center"><sub>© 2026 Neri Colón · NERACOSU. Todos los derechos reservados. Uso limitado a diseñar temas para Atalaya.</sub></p>
