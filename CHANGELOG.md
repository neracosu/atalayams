# Registro de cambios

Todos los cambios relevantes de Atalaya se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[versionado semántico](https://semver.org/lang/es/):

- **MAYOR** (`1.0.0 → 2.0.0`): cambios que obligan a tocar la instalación (configuración,
  hooks, formato de datos).
- **MENOR** (`0.3.0 → 0.4.0`): funciones nuevas compatibles.
- **PARCHE** (`0.4.0 → 0.4.1`): correcciones sin funciones nuevas.

Mientras la versión sea `0.x`, una versión menor puede traer cambios que pidan ajustar la
instalación; se indican siempre en **Requiere acción**.

## [Sin publicar]

## [0.84.0] - 2026-09-28

### Agregado
- **Cloudflare: las visitas ya se mueven en el mapa.** Antes solo llegaba una cifra por hora y los edificios se veían quietos. Ahora cada visita entra a su proyecto de Pages o a su Worker, con su país y sus errores. Llegan con un par de minutos de atraso, que es lo que tarda Cloudflare en contarlas. Necesita el permiso Zone › Analytics: Read.
- Las visitas por minuto de cada edificio de Cloudflare son las de ese proyecto, no las de todo el dominio.
- **La misma cuenta de Cloudflare con dos tokens es un solo distrito.** Si creó un token nuevo para sumar un permiso, Atalaya usa los dos y no repite los edificios. El asistente lo dice al guardar.

### Corregido
- El subtítulo de un distrito de Cloudflare decía «9 servicios · 0 sitios». Ahora dice cuántos sitios en Pages y cuántos Workers tiene.
- Al pegar algo que no es un token de API de Cloudflare, el asistente explica qué pegar en vez de mostrar «Invalid request headers».

## [0.83.1] - 2026-09-28

### Corregido
- **Atalaya Cloud**: la Torre de control mostraba CPU, memoria y disco en cero, como si midiera un servidor. Ahora muestra solo lo que tiene conectado.
- Los distritos de sitios vigilados, latidos y bases ya no muestran secciones vacías de «Servicios (PM2)».
- En los temas Ops y Planta, el panel Proyectos escondía una fila de más.

## [0.83.0] - 2026-09-28

### Agregado
- **Toda su cuenta de Supabase con un solo dato.** Con el token de su cuenta, Atalaya encuentra todos sus proyectos y conecta cada base, sin pegar las llaves una por una. Le dice el resultado de cada proyecto; los que están pausados lo avisan.
- **Correo del proyecto**: la ficha de cada base de Supabase muestra por dónde envía correo (Mailtrap, Resend, SES, un servidor propio…), el remitente, el tope por hora y si las cuentas nuevas confirman su correo. No hay que conectar el correo aparte.
- Avisa si el proyecto envía al **buzón de pruebas de Mailtrap** (los correos no le llegan a nadie) o con el **correo de prueba de Supabase** (muy pocos envíos por hora).
- El asistente explica el alcance del token de cuenta: Supabase no ofrece uno de solo lectura; Atalaya solo lo usa para leer y nunca lee el usuario ni la contraseña del servidor de correo. Conectar proyecto por proyecto, con su llave, sigue disponible.

## [0.82.0] - 2026-09-28

### Agregado
- **Atalaya para su computadora se actualiza sola.** Ya no hay que descargar el .zip en cada versión: Atalaya baja la versión nueva mientras está abierta, la verifica y la usa la próxima vez que la abra. En menú › **Actualizaciones** puede reiniciar para usarla ya, buscar ahora o apagar las actualizaciones automáticas.
- Cada actualización viene **firmada**: el ejecutable trae la clave que la verifica y no acepta nada que no coincida con su firma y su huella. Nunca retrocede de versión, y si una versión nueva no llega a abrir vuelve sola a la anterior.
- Opción `--sin-actualizar` para usar siempre la versión que trae el ejecutable.

### Requiere acción
- **Descargue el ejecutable una vez más** (esta versión): es el que sabe actualizarse. Desde aquí, las siguientes llegan solas.

## [0.81.4] - 2026-09-28

### Corregido
- **Supabase pide el ID del proyecto**, que es lo que hoy muestra su panel (Project Settings › General › Project ID). Sigue aceptando la dirección y la cadena de conexión de Postgres. Si no reconoce lo pegado, dice por qué: falta el ID, se pegó una llave en ese campo, o se escribió el nombre del proyecto.
- Dos conectores de tipos distintos con el mismo nombre (por ejemplo «Mi empresa» en Cloudflare y en Supabase) ya no se reemplazan uno al otro.

## [0.81.3] - 2026-09-28

### Corregido
- **Atalaya Cloud**: al elegir un tema no se veían sus vistas previas.

## [0.81.2] - 2026-09-28

### Seguridad
- **Modo público**: el diálogo de sitios vigilados, latidos y hostings mostraba los dominios y nombres sin pedir el PIN. Ahora exige el modo privado, en la pantalla y en el servidor.
- La ficha pública de un sitio vigilado ya no lleva su dominio oculto en los datos.

### Corregido
- La ficha de un sitio no decía a qué distrito pertenece.
- El panel Proyectos cuenta como problema un sitio vigilado que no responde.
- Torre de control: el aviso de un conector se leía cortado («le falta el permiso…»). Ahora va completo.
- En celular, los despliegues de un proyecto de Cloudflare se cortaban.
- El asistente actualiza la lista y el contador de conectores al guardar, sin recargar.
- Un proyecto de Cloudflare Pages con el despliegue fallido ahora dice cómo empezar a arreglarlo.

## [0.81.1] - 2026-09-28

### Cambiado
- **El menú dice dónde está cada cosa**: «Conectar o arreglar proyectos» lleva directo a los conectores (Cloudflare, Supabase, Vercel, GitHub, laptops), «Vigilar sitios y latidos» a los sitios por dominio y los latidos, y «Conectar un hosting o WordPress» a los agentes. Antes todo estaba dentro de «Asistente de configuración» y «Conectar un hosting compartido».
- Si un conector tiene problemas, la Torre de control enlaza a donde se arregla.

## [0.81.0] - 2026-09-28

### Cambiado
- **Claude Code en una laptop envía mucho menos, y el filtro corre en su computadora.** Antes el hook mandaba el evento completo y el servidor usaba solo una parte. Ahora, antes de enviar, se descarta todo menos una lista cerrada: qué está haciendo Claude, el nombre de la herramienta y el nombre de la carpeta del proyecto. **Nunca salen** el contenido de sus archivos, las respuestas de Claude, el resultado de los comandos ni sus instrucciones completas.
- El **detalle** (el archivo o comando de cada paso y el comienzo de cada instrucción) pasa a ser **opcional y apagado**: se enciende con una casilla al generar el comando.
- El filtro queda en `~/.claude/atalaya-remote.js`, unas 40 líneas que puede leer. El servidor aplica la misma lista al recibir, así que un hook viejo tampoco deja nada de más.

### Requiere acción
- Si ya conectó una laptop, **genere el comando de nuevo** y péguelo: reemplaza el hook anterior por el que filtra en su computadora.

### Agregado
- **Supabase, varios proyectos de una vez**: elija cuántos va a conectar y llene una caja por proyecto. Atalaya prueba cada uno y le dice el resultado en su caja: los que conectan quedan en verde y los que no, en rojo con el motivo. Se corrige y se vuelve a probar sin recargar; lo que ya conectó no se pierde.
- El formulario explica dónde está cada dato en Supabase: la dirección del proyecto y la llave secreta.

## [0.80.2] - 2026-09-28

### Agregado
- **Quitar conectores y laptops desde el asistente**: cada conector y cada equipo conectado aparece en su bloque con un botón Quitar. Antes solo se podía por terminal.
- **Cambiar un sitio vigilado** sin perder su historial: botón Cambiar junto a cada sitio, para su dirección, la respuesta esperada y la frase.

### Corregido
- **Supabase no conectaba y decía que sí**: si el proyecto se escribía como dirección (`https://….supabase.co`) o faltaba la llave, el conector se guardaba vacío y el asistente decía «guardado». Ahora acepta la dirección o el código, **prueba la llave antes de guardar** y dice qué falta: llave pública en lugar de la secreta, llave de otro proyecto, proyecto pausado o código mal escrito.
- Un mismo conector de Supabase puede tener **varias bases**: repita con el mismo nombre para sumar otra.

## [0.80.1] - 2026-09-28

### Corregido
- **Nombre de los conectores**: ya puede escribirlo como quiera, con espacios y mayúsculas («Mi Tienda»). Antes solo aceptaba minúsculas, números y guiones, y rechazaba lo demás.

## [0.80.0] - 2026-09-28

### Agregado
- **Latidos**: para saber que un respaldo, una tarea cron o un programa **sí corrió**. En menú › Conectar un hosting compartido › Latidos cree uno, diga cada cuánto debe avisar y pegue su dirección al final de la tarea. Si deja de llegar la señal, Atalaya avisa; cuando vuelve, también. La tarea puede avisar además que falló. Trae ejemplos listos para cron, Node, un Worker de Cloudflare y PowerShell.
- Cada latido es un edificio en el distrito «Latidos»: en rojo si se atrasó o avisó que falló. Su ficha muestra cuándo se espera la próxima señal y qué porcentaje llegó a tiempo.
- **Revisión web diaria** de los sitios vigilados, como los ve un buscador. Avisa lo grave: un sitio privado o un espejo técnico que **se puede indexar**, un sitio público que **dejó de indexarse**, una página que llega **vacía** a los buscadores, o un `robots.txt` que **bloquea a las IA** (Cloudflare puede encenderlo solo) o a todos. Y sugiere lo demás: sitemap, título, descripción, datos estructurados, `llms.txt` y direcciones inventadas que responden 200.
- Cada falta dice cómo empezar a arreglarla. Lo que no se pudo medir se dice aparte y no acusa al sitio. Botón **Revisar ahora** en la ficha del sitio.

### Corregido
- **Fichas largas**: el contenido se recortaba dentro de la ficha y había que desplazarlo aparte. Ahora la ficha tiene un solo desplazamiento.

## [0.79.1] - 2026-09-28

### Agregado
- **Claude Code en Windows**: al conectar una laptop, el asistente da ahora dos comandos, uno para **PowerShell de Windows** y otro para macOS, Linux o WSL. El de Windows solo necesita Node.js, el mismo que usa Claude Code.

## [0.79.0] - 2026-09-28

### Agregado
- **Conector de Cloudflare**: sus proyectos de **Pages** y sus **Workers** aparecen como edificios, con un token de solo lectura. Se conecta desde el asistente › Extras › Cloudflare.
- **Despliegues de Pages**: construyendo, listo o falló, con el mensaje del cambio. Si el último despliegue a producción falla, el edificio se ve caído y llega el aviso.
- **Relojes que dejan de correr**: si un Worker con reloj (cron) deja de dispararse, Cloudflare no da ningún error. Atalaya compara lo que debería correr con lo que corrió, pone el edificio en rojo y avisa una vez al callar y una al volver.
- **Corridas de cada Worker** en 24 horas y cuántas terminaron con error.
- **Visitas según Cloudflare** de cada dominio, sin pegar nada en el sitio: visitantes, páginas vistas, peticiones, errores 5xx, países y la última semana.
- Si al token le falta un permiso, esa parte se apaga, el resto sigue, y la Torre de control dice cuál falta.

### Corregido
- **La ficha de un servicio no abría** desde la 0.78.0 («No se pudo mostrar este detalle»).
- **Un conector recién agregado** (Vercel, Supabase, GitHub) no empezaba a leer hasta reiniciar Atalaya. Ahora arranca en segundos.

## [0.78.0] - 2026-09-28

### Agregado
- **Sitios vigilados por su dominio**: para proyectos que viven en Cloudflare Pages, Netlify, Vercel o cualquier sitio que quiera mirar desde afuera, sin instalar nada. En menú › Conectar un hosting compartido escriba el dominio y Atalaya lo visita cada 5 minutos. Aparece en el mapa, en el distrito «Sitios vigilados», y se ve caído como cualquier otro edificio.
- **Usted decide qué respuesta es la correcta**: una página normal, o una puerta que debe exigir llave (401), estar prohibida (403) o no existir (404). Si la puerta abre sin llave, avisa.
- **Frase que debe aparecer**: detecta el sitio publicado en blanco o roto, que igual responde «todo bien».
- **Avisa una vez al caer y una vez al volver**, por Telegram o correo, con el tiempo que estuvo caído. Antes de avisar lo prueba dos veces; y si es Atalaya la que se quedó sin salida a Internet, lo dice y no acusa al sitio.
- **Visitas de esos sitios**: como de ellos no hay registros del servidor, se cuentan con la línea del script sin cookies. Con solo pegarla ya ve visitantes, países, páginas y de dónde llegan.
- Disponibilidad en 24 horas y tiempo de respuesta en la ficha de cada sitio vigilado.

## [0.77.1] - 2026-09-28

### Corregido
- **Alertas de certificado**: el enlace «Abrir en Atalaya» ahora lleva a la ficha del sitio (lo busca por su dominio, con o sin `www`). Antes el aviso llegaba sin enlace.

### Cambiado
- Capturas de los diez temas del README al día: cada una muestra la cárcel, el correo con su cola, las bases y las cuotas como las dibuja hoy su tema.

## [0.77.0] - 2026-09-27

### Agregado
- **Cloudflare**: si un sitio está detrás de Cloudflare y el servidor no recibe la IP real de sus visitantes (casi todo lo que llega viene de sus nodos), su ficha y su analítica lo avisan y dicen exactamente cómo arreglarlo (mod_remoteip con `CF-Connecting-IP`, o pedírselo al hosting).
- **La cárcel también en Cloudflare**: en Defensa web se conecta un token de API de Cloudflare (Zone Read y Firewall Services Edit) y cada IP que la defensa bloquea se bloquea también en la zona de su sitio (en todas, si el bloqueo es de todo el servidor); al salir de la cárcel, la regla se borra sola. Se puede apagar o desconectar. El token queda en un archivo 600 del servidor.

## [0.76.0] - 2026-09-27

### Agregado
- **Script opcional de analítica, sin cookies**: una línea en el sitio (`<script defer src=".../a.js" data-site="...">`, se copia desde la analítica en modo privado) suma lo que los registros no ven: el tiempo que la página estuvo a la vista, cuánto se lee, el **rebote real** (entró y se fue en menos de 10 s sin tocar nada) y las **conversiones** que se reconocen solas (clics en WhatsApp, llamadas, correos, formularios, descargas y enlaces externos) o las propias con `atalaya('event', 'compra')`. No usa cookies ni guarda nada en el navegador, no envía la IP ni datos del visitante; solo acepta envíos desde los dominios del sitio. Funciona en sitios de una sola página y también en las pantallas de la nube. El informe mensual lo incluye.
- **Informe mensual por correo para sus clientes**: en la analítica de cada sitio o app (modo privado, dueño) se anotan los correos que lo reciben. El día 1 de cada mes, desde las 8, les llega el mes anterior contra el previo: un resumen en palabras («recibió 1.234 visitantes, un 12 % más que en agosto; la mayoría llegó desde Google y el 68 % desde el celular»), visitantes, páginas vistas, páginas por visita y rebote, la curva por día, de dónde llegan, las páginas más vistas, países, dispositivos y las páginas rotas. Sale del correo de Alertas. Botón para enviarlo en el momento (si el mes anterior no se midió, va el mes en curso hasta hoy).

### Corregido
- Analítica: «Páginas que no existen» ya no muestra las rutas que buscan los robots de ataque (/.env, /.git, wp-config, copias de respaldo): esas las vigila la defensa.

## [0.75.0] - 2026-09-27

### Agregado
- **Terminal, completo** (todo en texto): `iptables -L ATALAYA` con las IPs bloqueadas y los archivos sellados en cuarentena, cada bloqueo como una regla `-A … -j DROP`; `mailq` con la cola y cada envío, llegada o rebote con su motivo; `mysqladmin processlist` con las bases de cada cuenta. El servidor al límite es un aviso `[ GRAVE ]` del sistema, la cuota va en el título de la ventana de la cuenta y los sitios vigilados llevan `<- vigilado`. En Terminal la capa de efectos ya no dibuja nada encima del texto.
- Kit de temas: escenario **«Cola de correo atascada»** en el simulador, para ver cómo cada tema muestra la cola.

## [0.74.0] - 2026-09-27

### Agregado
- **Leyenda con el arte de cada tema**: cada elemento se explica con un dibujo de su propio mundo (el preso a rayas y el tonel de la villa, el espectro y el ataúd de la mazmorra, el cofre del acuario, el tanque de datos de la planta...) en vez de un icono genérico, y una sección nueva, **«Los que vigilan»**, muestra el elenco del tema con sus nombres. En Terminal, glifos de texto. La leyenda de la Ciudad y la de Ciudad 3D suman la cárcel, la cuarentena, el correo, los silos, la saturación y la cuota. Un tema del kit puede traer su arte (`"art"` con filas y paleta en su `theme.json`).
- **Planta, completa**: la **jaula de decomisos** junto a la central (las IPs bloqueadas son drones capturados y los archivos en cuarentena, barriles sellados), el **despacho** (cada correo es un paquete que viaja por cable; los devueltos vuelven con el motivo y la cola se apila en el palé) y un **tanque de datos** en cada nave con bases, con tuberías a las máquinas que las usan.
- Planta: con el servidor **al límite**, baliza roja en la central, cintas lentas y piezas esperando en el portón; la **cuota** aparece en la placa de la nave.
- **Cada tema con su propio elenco**: las patrullas, las escoltas a la cárcel, los que llegan a sondear, la fila de espera y los archivos maliciosos ya no son autos de policía en todos lados. En la Villa son guardias con lanza, búhos guardianes, ladrones encapuchados y ratas; en el Castillo, centinelas, gárgolas, espectros y arañas; en la Oficina, guardias de seguridad, un dron, intrusos de capucha y cucarachas; en el Raid, paladines, un dragoncito, esbirros y slimes; en el Acuario, caballitos de mar, tortugas, tiburones y erizos; en Ops, blindados, drones y marcadores hostiles; en la Planta, montacargas y drones. La cápsula de cuarentena toma los colores de cada tema. En Terminal no se dibujan vehículos. Un tema del kit puede traer su propio elenco (`fxSkin`).

## [0.73.0] - 2026-09-27

### Agregado
- **Ops, completo**: al fondo de la mesa, la **zona de detención** (las IPs bloqueadas son marcadores hostiles enjaulados y los archivos en cuarentena, contenedores sellados) y la **antena de comunicaciones** (cada correo es un paquete de datos; los rebotados vuelven con el motivo y la cola gira al pie), más un **depósito de datos** en el borde de cada sector con bases, con líneas de luz a las columnas que las usan.
- Ops: con el servidor **al límite**, alerta roja (barrido y cúpula en rojo) y las visitas dan vueltas en espera sobre la base; la **cuota** aparece en la ficha del sector.

## [0.72.0] - 2026-09-27

### Agregado
- **Acuario, completo**: la pecera de **aislamiento** bajo candado (las IPs bloqueadas son medusas encerradas y los archivos en cuarentena, frascos sellados), el **tubo del correo** (cada correo es una cápsula que sube o baja; las rebotadas vuelven con el motivo y la cola se apila al pie) y un **cofre del tesoro** en cada pecera con bases de datos, que se abre con consultas y manda burbujas doradas a los peces que las usan.
- Acuario: con el servidor **al límite**, el agua se enturbia y la comida se queda flotando; la **cuota** aparece en la placa de la pecera.

## [0.71.0] - 2026-09-27

### Agregado
- **Raid, completo**: la **jaula** junto al estrado (las IPs bloqueadas son esbirros del Intruso capturados y los archivos en cuarentena, cofres malditos encadenados), el **buzón** (cada correo es un pergamino que pasa por él; los rebotados vuelven con el motivo y la cola se apila encima) y el **banco** de cada grupo con bases de datos, con hilos dorados hasta los héroes que las usan.
- Raid: con el servidor **al límite**, El Intruso se enfurece (crece, se tiñe de rojo y la pantalla arde en los bordes) y las visitas hacen cola; la **cuota** aparece junto al nombre del grupo.

### Corregido
- Raid: el subtítulo de un grupo ya no pisa el nombre del grupo vecino; si no cabe, baja una línea.

## [0.70.0] - 2026-09-27

### Agregado
- **Castillo, completo**: la **mazmorra** junto a la torre (las IPs bloqueadas son espectros presos tras las rejas y los archivos en cuarentena, ataúdes con cadenas en la puerta), la **torre de los cuervos** (cada correo pasa por ella; los rebotados vuelven con el motivo y la cola espera posada en la percha) y un **librero de grimorios** en cada sala con bases de datos, con hilos violetas hasta las luces que las usan.
- Castillo: con el servidor **al límite**, el castillo queda sitiado (el horizonte arde en rojo y los murciélagos rondan la luna esperando entrar); la **cuota** aparece sobre las almenas de la sala; la luna tiene la **fase de hoy** y cruzan estrellas fugaces.

### Corregido
- Kit de temas: la ficha de un proyecto en el simulador ya no se queda en «Cargando…».

## [0.69.0] - 2026-09-27

### Agregado
- **Oficina, completa**: la sala de **Seguridad** (las IPs bloqueadas son retenidos de mono naranja tras las rejas y los archivos en cuarentena, cajas selladas con cinta roja frente al guardia), la **Mensajería** (casilleros, cartero y mesa donde se apilan las cartas si la cola se atasca; cada sobre pasa por ella y los rebotados vuelven con el motivo) y un **archivador** en cada sala con bases de datos, con cables por el piso hasta los puestos que las usan.
- Oficina: con el servidor **al límite**, los racks se ponen rojos y los aviones de papel hacen fila frente al ascensor; la **cuota** aparece sobre el nombre de la sala.
- Oficina: las ventanas siguen la **hora** de quien mira (día, atardecer y la ciudad encendida de noche) y la recepción tiene un reloj de pared.

## [0.68.0] - 2026-09-27

### Agregado
- **Villa, completa**: el calabozo junto al castillo (las IPs bloqueadas son bandidos a rayas tras las rejas, y los archivos en cuarentena, toneles sellados con cadenas), el palomar (cada correo es una paloma que pasa por él; las que rebotan vuelven rojas con el motivo, y la cola atascada apila cartas), un granero por pueblo con bases de datos y acequias hacia las casas que las usan, el castillo asediado cuando el servidor llega al límite (con fila de aldeanos en el portón) y la línea de cuota bajo cada pueblo.
- Villa: **día y noche** según la hora de quien mira, con antorchas en los portones y las ventanas encendidas de las casas con visitas; un estanque con patos, un pozo en cada plaza, rocas y arbustos con flores.
- Villa: los **nombres de las casas** aparecen al acercarse.
- Sitio: botón **«neracosu.com»** en la franja superior de todas las páginas, para volver al sitio del autor.

### Corregido
- La animación de la cápsula de cuarentena (en todos los temas) podía fallar al arrancar y dejar de dibujarse.

## [0.67.0] - 2026-09-27

### Agregado
- **Aportar sin saber Git**: quien no usa Git descarga el .zip del proyecto, hace su cambio y lo sube en nube.neracosu.com/aportes con su nombre para los créditos. Una guía para el primer aporte (neracosu.com/atalaya/aportar) explica los pasos sin dar nada por sabido, trae instrucciones listas para copiar en su asistente de IA y misiones para empezar ordenadas por dificultad.
- **Créditos de la comunidad**: quienes aportan aparecen en COLABORADORES.md, en la sección «Comunidad» del README y en el sitio. El cambio queda en el historial a su nombre.
- El sitio del proyecto está en el repositorio (`site/`), el mismo que ve el público, abierto a mejoras.

## [0.66.0] - 2026-09-27

### Agregado
- Pantalla de acceso: un enlace discreto, «¿Qué es esto? Conozca Atalaya Monitor Server», para quien llega a la dirección sin tener usuario. Viene encendido y el dueño lo puede apagar en el asistente (Nombre y dirección).
- Ciudad 3D: la **cárcel**, a un costado de la Torre de control. Tiene un edificio con rejas y un patio con un auto por cada IP bloqueada, y en la esquina van las cápsulas de los archivos en cuarentena. Las patrullas escoltan hasta ahí a cada IP que se bloquea. Al hacer clic se abre la lista de presos.
- Ciudad 3D: un **silo de datos** en la esquina de cada distrito que tiene bases MySQL. Su altura depende del tamaño, la tapa late cuando hay consultas en curso, en el suelo aparecen anillos tenues si hay conexiones dormidas y el silo se pone rojo cuando el servidor de bases está al límite. Unas tuberías con pulsos lo unen a los sitios que usan esas bases. Al hacer clic se abren sus bases.
- Ciudad 3D: la **oficina de correos**, del otro lado de la torre. Cada sobre pasa por ella: el ámbar sale de su distrito hacia el portal, el violeta entra y va a su distrito, y el rojo choca antes de salir y vuelve roto con el motivo del rebote. En su rótulo se ve el movimiento del último minuto, y si la cola de correo se atasca se forma una pila de sobres.
- Ciudad 3D: con el **servidor al límite**, la torre se pone roja y las visitas hacen fila para entrar, avanzando de a una (atasco).
- Ciudad 3D: cuando una cuenta se acerca al límite de disco, inodos o ancho de banda, aparece una **línea de cuota** bajo su nombre («DISCO AL 92 %») y el borde de su parcela parpadea en ámbar o rojo.
- Kit de temas: el simulador trae una cárcel y silos de ejemplo y escenarios nuevos: servidor al límite, cuota al límite, una IP a la cárcel y un archivo a cuarentena. Los correos de ejemplo ahora traen su cuenta y el motivo del rebote.

## [0.65.1] - 2026-09-27

### Corregido
- Asistente de Atalaya para su computadora: ya no ofrece «Países de las visitas» (esa edición no recibe visitas web y la descarga respondía «No disponible»). En las demás ediciones, si la descarga falla, lo dice en vez de quedarse en «descargando…».

## [0.65.0] - 2026-09-27

### Añadido
- **Atalaya para Windows ve Claude Code dentro de WSL**: cada distribución encendida (Ubuntu, Debian...) y cada
  usuario con sesiones aparece como su propio distrito, «WSL · Ubuntu (usuario)», junto a las sesiones de Windows
  (terminal de VS Code, Cursor, JetBrains o la extensión del IDE, que ya se veían). Solo lee las distribuciones que
  ya están corriendo: nunca enciende una apagada.

## [0.64.1] - 2026-09-27

### Corregido
- **Atalaya para Windows**: el asistente y todas las páginas respondían «No encontrado», y la primera vez no se
  creaba la carpeta de datos (`%APPDATA%\Atalaya`). Las rutas de las sesiones de Claude Code en Windows también se
  muestran bien.

## [0.64.0] - 2026-09-27

### Añadido
- **Descargar Atalaya para su computadora desde la pantalla**: menú › **Atalaya para su computadora** (o la
  pestaña **Su computadora** de Instalar) lista los ejecutables de Windows, macOS (Apple o Intel) y Linux con su
  tamaño y su huella SHA-256, marca el de su sistema y explica cómo abrirlo. Solo para el dueño de un Atalaya VPS.

### Cambiado
- El menú dice «Alertas por Telegram y correo».

## [0.63.1] - 2026-09-27

### Corregido
- Analítica: las precargas internas de las apps Next.js (`?_rsc=`, que un panel abierto repite cada pocos segundos) y las conexiones de socket.io ya no cuentan como páginas vistas.

## [0.63.0] - 2026-09-27

### Añadido
- **Analítica sin cookies**, como la de Google pero desde los registros del servidor: sin código en el sitio, sin
  banner de cookies, y contando también a quien usa bloqueador de anuncios. Cada ficha de sitio o app trae la
  tarjeta **Analítica · 7 días** (visitantes, comparación y barras por día), y **Ver analítica completa** abre:
  - hoy, 7 días, 30 días, 90 días o 12 meses, con **visitantes, páginas vistas, páginas por visita y rebote**
    comparados con el período anterior (solo cuando ya se medía entonces);
  - una gráfica por día (y por hora en «Hoy»);
  - **de dónde llegan**: buscadores (Google, Bing...), redes sociales, **asistentes de IA** (ChatGPT, Perplexity...),
    otros sitios y directo, más las **campañas utm**;
  - **páginas más vistas y de entrada**, países, celular o computadora, navegadores, sistemas y a qué hora llegan;
  - las **páginas que no existen** que ven las personas (enlaces rotos) y los robots que más la visitan.
  Funciona en el VPS, en los hostings conectados y con el plugin de WordPress. No guarda IPs: cada visitante del
  día es una huella corta que se descarta al cambiar el día. En modo público no se ven las páginas, los sitios que
  enlazan ni las campañas.

### Corregido
- La ficha flotante de un edificio o auto ya no se queda pegada encima de la ficha lateral o del HUD cuando el
  mouse sale del mapa.

## [0.62.1] - 2026-09-27

### Corregido
- **Conectar un WordPress que ya tiene el plugin**: el código para pegar en wp-admin › Ajustes › Atalaya no se
  veía en ninguna parte. Ahora, en **Conectar un sitio WordPress**, el botón **Ya lo tengo instalado: ver código**
  da la dirección y el código, cada uno con su botón Copiar (también al generar el código de un hosting).
- **Plugin de WordPress 1.1.0**: el formulario ya trae puesta la dirección de su Atalaya (y el código, si el .zip
  vino configurado); si no logra conectarse solo al activarse, dice por qué; y las instrucciones indican el botón
  correcto en lugar de una «pestaña WordPress» que no existía.

## [0.62.0] - 2026-09-27

### Añadido
- **Accesos a los paneles** (cPanel, WHM y webmail), en la salud del servidor:
  - cuántas **contraseñas equivocadas** hubo esta semana y desde cuántas IPs, separadas de los escáneres que solo
    tocan el puerto del panel. Si es un ataque repartido (pocas por IP, para no despertar a cPHulk), lo dice y
    recomienda cerrar el puerto 2087 a sus IPs en vez de llevarlas a la cárcel una por una;
  - si root tiene **verificación en dos pasos**;
  - las **últimas entradas** con usuario, panel e IP, marcando las que vienen de una IP nueva. Cada IP abre su
    expediente;
  - **aviso por Telegram o correo** cuando alguien entra a WHM o cPanel desde una IP que ese usuario no usaba, y
    aviso grave si esa IP venía fallando la contraseña (alguien pudo adivinarla).
- El expediente de cada IP muestra sus intentos y entradas en los paneles, y el registro de seguridad guarda
  las entradas desde IPs nuevas.

## [0.61.1] - 2026-09-27

### Corregido
- La revisión «Certificados y servicios» aparece al minuto de arrancar Atalaya, sin esperar la siguiente vuelta de 15 minutos.

## [0.61.0] - 2026-09-27

### Añadido
- **Certificados SSL**: Atalaya revisa el certificado de cada dominio y los del propio servidor (cPanel, correo,
  FTP; solo los de servicios que están funcionando). Avisa si vence en menos de 20 días (la renovación automática
  está fallando), si ya venció, si es autofirmado o si no cubre el nombre, cada uno con su «cómo arreglarlo». La
  ficha de cada sitio muestra su certificado, y si vence pronto le llega **un aviso por Telegram o correo** (uno
  por nivel, sin repetirse).
- **Servicios que se reinician solos**: los que el vigilante de cPanel encontró caídos y levantó esta semana
  (Apache, MySQL, DNS...), los que systemd reinicia una y otra vez, los que quedaron en estado fallido y los
  procesos que el sistema mató por falta de memoria. Todo en la nueva revisión «Certificados y servicios».

### Cambiado
- La hoja de ruta anota el paso futuro del historial largo a SQLite.

## [0.60.0] - 2026-09-27

### Añadido
- **Expediente de cada preso** (clic en cualquier IP de la cárcel, de «Quién lo buscó» o de un historial): país y
  navegador, si está presa y hasta cuándo, **historial de bloqueos** (motivo, quién, cuándo entró y salió), las
  puertas traseras que buscó (y si ya están en cuarentena), los sitios donde la vio la defensa web, su historial
  de seguridad, lo que más pidió y **sus últimas peticiones** en los registros de Apache. Con Liberar o Llevar a
  la cárcel. Solo en modo privado.
- **Registro de seguridad**: cada episodio (vigilancia, cárcel, puerta trasera, cuarentena, alguien la buscó,
  ruta expuesta) queda anotado en `seguridad.jsonl` para armar los expedientes y el **historial de seguridad de
  cada sitio**, que ahora aparece en su ficha. Al crearse, recoge lo que ya se sabía (bloqueos, puertas traseras
  y cuarentenas anteriores).

## [0.59.1] - 2026-09-27

### Corregido
- Las fichas podían necesitar scroll lateral cuando traían rutas largas o código (por ejemplo, la historia de un
  archivo en cuarentena): el texto no se partía y ensanchaba la ficha. Ahora las rutas y el código se parten, las
  filas con fechas bajan de línea y ninguna ficha se ensancha, en PC ni en el teléfono.

## [0.59.0] - 2026-09-27

### Añadido
- **Historia de cada archivo en cuarentena** (ficha de la cárcel › Archivos en cuarentena): dónde estaba (ruta y
  sitio), qué era (por qué se marcó), cuándo se creó, cuándo lo detectó Atalaya, cuándo y quién lo puso en
  cuarentena, su tamaño y **quién lo buscó** en los registros. Para los que se pusieron en cuarentena antes de
  guardar esta historia, se reconstruye del archivo guardado. Acciones: **Borrar para siempre** (escribiendo
  BORRAR) y **Restaurar** (vuelve a su lugar con su dueño y permisos y queda como revisado).

### Cambiado
- Las cápsulas de la cuarentena en el mapa son más grandes y claras (tubo verde con el bicho adentro, brillo que
  late y el rótulo «CUARENTENA · N»); pasar el mouse las explica y el clic abre su historia.

## [0.58.1] - 2026-09-27

### Corregido
- Un archivo puesto en cuarentena antes de que existiera la animación no aparecía como cápsula en la cárcel. Ahora
  la lista sale de la propia carpeta de cuarentena (cada archivo con su registro de origen).
- La cuarentena se ve: al pulsar «Poner en cuarentena» la ficha se cierra sola y la patrulla se lleva la cápsula a
  la vista (antes la ficha tapaba la animación); y arranca aunque el edificio quede detrás de un panel.

## [0.58.0] - 2026-09-27

### Añadido
- **Alertas por correo**, junto a Telegram (menú › Alertas): los mismos avisos, categorías, horario de silencio y
  resumen de cada mañana, por Telegram, por correo o por los dos. El SMTP se configura desde la pantalla, con
  ajustes listos para **Gmail**, **Outlook / Microsoft 365**, **Yahoo**, **Zoho** y **el correo de su hosting**
  (cPanel), o cualquier otro servidor. Para Gmail se explica la contraseña de aplicación, con el enlace para
  crearla. Se guarda solo si el correo de prueba sale bien. Varios destinatarios; mensajes sobrios con el enlace
  a la ficha. Cliente SMTP propio (SSL o STARTTLS, sin dependencias).

### Cambiado
- La configuración de las alertas vive en su propio archivo (permisos 600) y ya no ocupa un conector del plan en
  Atalaya Cloud. La de Telegram existente se muda sola.

## [0.57.0] - 2026-09-27

### Añadido
- **Alertas por Telegram** (menú › Alertas por Telegram): lo grave llega al teléfono aunque nadie mire la pantalla.
  Se conecta sin terminal: se crea un bot con @BotFather, se pega su token y se le escribe «/start <código>» al
  bot, así Atalaya reconoce el chat (y nadie más puede engancharse). Se pueden sumar más chats o un grupo.
  - Qué avisa, cada tipo con su interruptor: **seguridad** (puerta trasera, alguien la buscó, archivo expuesto,
    fuerza bruta), **cárcel** (bloqueos de la defensa automática), **caídas** (servicios y despliegues),
    **saturación** y, apagado de fábrica, **tráfico** (scraping, escaneos, picos).
  - Sin saturar el teléfono: el mismo aviso no se repite en 30 minutos, tope por hora y **horario de silencio**
    en el que solo llega lo grave.
  - Los mensajes no llevan IPs ni rutas: el sitio, el motivo y un **enlace directo a su ficha** en Atalaya.
  - **Resumen de cada mañana** a la hora elegida: qué pasó en las últimas 24 horas y cómo está la salud.

## [0.56.0] - 2026-09-27

### Añadido
- **Cuarentena animada:** al poner un archivo PHP sospechoso en cuarentena, una patrulla baja sobre el edificio,
  encierra los bichos en una **cápsula verde** y se la lleva colgando a la cárcel («EN CUARENTENA»). En el patio
  de la cárcel quedan las cápsulas de los archivos en cuarentena.
- **Alguien busca la puerta trasera:** los bichos se agrandan y se agitan, con resplandor rojo, sirena y el cartel
  «ALGUIEN LA BUSCÓ».

### Corregido
- Llevar a la cárcel a quien buscó una puerta trasera no mostraba la escolta (el bloqueo no sabía de qué sitio
  venía). Ahora las patrullas se lo llevan desde ese edificio.

## [0.55.0] - 2026-09-26

### Cambiado
- Edición Equipo: en una computadora, el edificio central ya no se llama «Torre de control» ni «Sala de
  servidores», sino **«Este equipo»**, y los textos que decían «el servidor» (tooltips de todos los temas, el
  ticker y la ficha central) dicen «este equipo». Cada tema conserva su metáfora (filtro, torre del reloj, base,
  central).

## [0.54.0] - 2026-09-26

### Añadido
- **Cuotas de las cuentas** (cPanel): disco, archivos (inodos) y ancho de banda del mes por cuenta, leídos de lo
  que cPanel ya calcula. La ficha de cada distrito los muestra (con barra si la cuenta tiene límite); la Salud del
  servidor suma «Cuotas de las cuentas», que avisa al 85 % de un límite y cuando una cuenta acumula muchísimos
  archivos. En el mapa, solo si importa: una línea ámbar (o roja) bajo el nombre del distrito, «DISCO AL 92 %».
- **Tareas cron que producen salida seguido** (posible error): cuando una tarea escupe salida, cron la manda por
  correo; si pasa varias veces en la semana, la revisión de Cron lo marca con el comando y cuántas veces.

## [0.53.0] - 2026-09-26

### Añadido
- **Quién buscó la puerta trasera.** Para cada archivo PHP sospechoso, la ficha del sitio lista las IPs que lo
  pidieron (en los registros de Apache actuales y en los archivados de este mes y el anterior), con la fecha y la
  respuesta (200 = lo ejecutó). Junto a cada una, **Llevar a la cárcel**. Pedir la ruta exacta de un archivo así
  delata a quien lo puso.
- En vivo: si alguien pide un archivo sospechoso, aviso en el ticker y el director va al sitio; con la defensa
  automática encendida, esa IP va directo a la cárcel («buscó un archivo PHP malicioso»).

## [0.52.0] - 2026-09-26

### Cambiado
- Cada panel de la columna derecha abre su propia ficha, no la vista general de la torre: **CPU y memoria**
  abre la de CPU, **Tráfico HTTP** la de visitas, **Procesos** una ficha nueva con los que más CPU y memoria
  usan, y **Salud del servidor** la salud completa. Cada chip de la salud (Respaldos, Correo, Cron, Puertos…)
  abre **solo su revisión**, con un enlace a la salud completa.

### Corregido
- Un archivo PHP sospechoso de un subdominio (con su carpeta dentro de la del sitio principal) quedaba
  atribuido al sitio principal. Ahora cada archivo es del sitio más específico.

## [0.51.0] - 2026-09-26

### Añadido
- **Archivos PHP nuevos y sospechosos en los docroots** (posibles puertas traseras). Cada 30 minutos se recorren
  los docroots; la primera vez se toma una foto de referencia y se reporta solo lo sospechoso que ya estaba;
  desde ahí se evalúa cada `.php` nuevo. Es sospechoso si está en una carpeta de subidas, vive en una carpeta
  oculta, trae firmas de webshell (código ofuscado que se ejecuta, ejecuta lo que manda el visitante, webshells
  conocidos) o tiene un nombre generado al azar (aviso menor). Muchos archivos nuevos a la vez en la misma
  carpeta son una actualización o un despliegue: no alarman. Calibrado contra 48.000 archivos reales sin falsos
  positivos.
  - En el mapa, **bichos rojos** caminan sobre el edificio del sitio con el cartel «ARCHIVO PHP SOSPECHOSO».
  - En la ficha del sitio: ruta, motivo, tamaño y fecha, con **Poner en cuarentena** (el ayudante lo saca del
    sitio a una carpeta protegida, sin borrarlo) y **Marcar como revisado**. Aviso en el ticker, el director va
    al sitio, y la Salud del servidor suma «Archivos PHP nuevos».

## [0.50.0] - 2026-09-26

### Añadido
- **Silos de datos: las bases en el mapa.** Cada cuenta tiene en la esquina de su distrito un **silo** (cilindro
  pixel) con sus bases MySQL; su altura crece con el tamaño. **Tuberías** lo unen a los sitios que usan cada base
  (Atalaya lo sabe por su configuración) y por ellas **corren pulsos mientras hay consultas en curso**: se ve qué
  sitio está trabajando su base. La tapa brilla con la actividad, el silo se pone rojo con las conexiones de
  MySQL al límite y lo rodean **anillos tenues cuando acumula conexiones dormidas**. Clic abre sus bases.
- **Supabase como silo verde**: altura por el tamaño de la base, un anillo de luces en la tapa por las conexiones
  activas, una línea de llenado por el disco usado (roja cerca del límite) y gris con la tapa cerrada si está
  pausado o no responde. Una tubería verde lo une a la app de su mismo proyecto (Vercel u otra), con pulsos
  cuando la base tiene conexiones.

## [0.49.1] - 2026-09-26

### Cambiado
- La cárcel y la oficina de correos ahora son edificios isométricos del mismo estilo que los de los distritos,
  cada uno en su parcela: la cárcel, gris con rejas en sus caras y un patio cercado donde quedan los presos; la
  oficina, de ladrillo con ventanas encendidas, techo ámbar, el sobre arriba, el buzón rojo y la pila de sobres.

## [0.49.0] - 2026-09-26

### Añadido
- **Oficina de correos** en la ciudad, junto a la autopista y frente a la cárcel, con su buzón. Por ahí pasa todo el
  correo del servidor:
  - **Saliente (ámbar):** sale del distrito de la cuenta que envía, pasa por la oficina y se va por la autopista.
  - **Entrante (violeta):** baja por la autopista, pasa por la oficina y llega al distrito de su cuenta.
  - **Rebotado (rojo):** sale, choca antes del peaje, se rompe y **vuelve a quien lo envió** con el motivo en
    corto: «BUZÓN LLENO», «NO EXISTE», «SPAM», «SIN AUTENTICAR», «DOMINIO» o «DEMASIADOS».
  - El correo llega en ráfagas: un sobre por tipo cada tanto y el resto suma al contador de la oficina («12 salen
    · 3 entran · 1 rebota en 1 min»). La **pila de sobres** crece con la cola de correo (roja si pasa de 1000).
  - Clic en la oficina abre la ficha del correo.

## [0.48.0] - 2026-09-26

### Añadido
- **Saturación visible.** Atalaya mide si el servidor da abasto (CPU, carga por núcleo, memoria, swap,
  conexiones de MySQL y errores 5xx; una causa cuenta si se sostiene, un pico suelto no) y qué sitios se
  quedaron sin procesos PHP (los avisos «max_children» de PHP-FPM).
  - En el mapa, solo cuando importa: con el servidor **al límite**, la torre de control se enciende en rojo con
    ondas de calor y el cartel «SERVIDOR AL LÍMITE», y en el peaje se arma un **atasco**: los autos esperan su
    turno en fila y avanzan lento. Un sitio sin procesos PHP muestra **autos grises en fila** junto a su
    edificio y el cartel «PHP AL LÍMITE».
  - Aviso en el ticker al entrar y al salir, el director va a la torre, y la Salud del servidor suma
    «Saturación»: qué está al límite y, por sitio, cuántas veces tocó su tope de PHP esta semana, con el paso
    para subirlo (MultiPHP Manager) y el consejo de caché de página.

## [0.47.3] - 2026-09-26

### Corregido
- La escolta no llegaba a la cárcel: si la vigilancia del sitio se volvía a prender, las patrullas daban media
  vuelta con el preso; y si la cárcel quedaba fuera de pantalla, se iban a la torre. Ahora una escolta en curso
  no se interrumpe, vuela hacia la cárcel aunque no se vea y sigue su posición aunque la cámara se mueva.
- Tras bloquear una IP, la vigilancia se volvía a prender con los sondeos viejos de esa misma IP. Ahora se
  descuentan, también después de reiniciar Atalaya.

## [0.47.2] - 2026-09-26

### Corregido
- La vigilancia podía ofrecer «Bloquear esta IP (127.0.0.1)»: en un escaneo señalaba a la IP con más tráfico,
  no a la que sondeó, y el tráfico del propio servidor contaba como sospechoso. Ahora se señala a la IP que más
  sondeó; el tráfico interno (127.0.0.1, redes privadas, las IPs del servidor) y las revisiones de la propia
  Atalaya (verificación de expuestos, favicons) no cuentan como sondeos ni como scraping; y el botón de bloquear
  solo aparece si esa IP de verdad se puede bloquear.

## [0.47.1] - 2026-09-26

### Cambiado
- Las confirmaciones ya no usan el cuadro del navegador: un cuadro propio con ícono pixel, título, explicación y
  botones (rojo cuando la acción es delicada, como bloquear una IP, borrar un usuario o quitar un hosting). Para
  lo que no tiene vuelta atrás pide escribir el nombre y solo entonces deja aceptar. Cambiar el nombre de un
  proyecto también se hace en ese cuadro.

## [0.47.0] - 2026-09-26

### Añadido
- **La cárcel.** Un edificio junto a la autopista, con rejas, donde quedan las IPs bloqueadas: las que se
  bloquearon a mano en el firewall (permanentes, con su motivo si está anotado) y las de la defensa de Atalaya
  (con su vencimiento). Cada preso es un auto oscuro tras las rejas y el cartel dice cuántos hay. No entran los
  miles de intentos de SSH que frenan fail2ban y cPHulk.
  - Al bloquear, las patrullas llevan al auto sospechoso **a la cárcel**, lo dejan y vuelven a la torre.
  - Cuando un bloqueo vence o se libera, el auto sale de la cárcel con el cartel «LIBERADA» y se va por la
    autopista.
  - Clic en la cárcel, o «En la cárcel» en el panel de Defensa, abre su ficha: cada preso con su motivo, el
    sitio que atacó y cuánto le queda, y el botón **Liberar** (también para los bloqueos manuales del
    firewall, que se quitan y se guardan para el próximo arranque).

## [0.46.0] - 2026-09-26

### Añadido
- **Defensa: detenerlos a tiempo.** Primera acción de Atalaya sobre el servidor, siempre elegida por usted:
  - **Botón «Bloquear esta IP»** en la ficha de un sitio en vigilancia. Bloqueo temporal (24 h de fábrica).
  - **Defensa automática** (apagada de fábrica, se enciende en Defensa web): bloquea sola a quien encontró una
    ruta expuesta, hace fuerza bruta, scraping o sondea varios sitios. Con el servidor al límite (conexiones
    de MySQL al 85 % o la carga disparada) frena también a quienes atacan en ese momento, antes de la caída.
  - Los bloqueos van a una tabla propia de nftables (`inet atalaya`), aparte de iptables, fail2ban y cPHulk, y
    **vencen solos**. Nunca se bloquea Cloudflare (cortaría el sitio a todos los que entran por ese nodo),
    redes privadas, el propio servidor, la lista blanca ni IPs de usuarios de Atalaya.
  - En Defensa web: bloqueos activos e historial, con «Desbloquear», la duración y la lista blanca.
  - En el mapa, al bloquear, **las patrullas se llevan al auto sospechoso** a la torre con el cartel «IP BLOQUEADA».
- Vigilancia con motivos nuevos, cada uno con su cartel y su explicación en la ficha: **EXPUESTO** (una ruta
  sensible respondió), **FUERZA BRUTA** (intentos de login) y **LA MISMA IP EN N SITIOS**.

### Cambiado
- Las patrullas vuelan despacio, para disfrutarlas en pantalla: la salida y el regreso tardan de 4 a 9
  segundos, y la escolta con la IP bloqueada, de 5 a 11.

## [0.45.1] - 2026-09-26

### Corregido
- Las patrullas, los carteles de vigilancia y demás efectos se dibujaban encima de las fichas, el menú, los
  avisos y los cuadros. Ahora quedan entre el mapa y la interfaz: cualquier ficha o cuadro abierto los tapa.

## [0.45.0] - 2026-09-26

### Cambiado
- **Patrullas voladoras.** Cuando un sitio entra en vigilancia (escaneo o scraping), dos patrullas despegan de la
  torre de control, una tras otra, vuelan en arco hasta el edificio y quedan suspendidas a sus lados, flotando
  con las luces rojas y azules encendidas. Cuando la amenaza se descarta, vuelven a la torre. En los temas sin
  torre salen desde el borde de la pantalla más cercano.

## [0.44.0] - 2026-09-26

### Añadido
- **Vigilancia de sitios**: la pantalla hace notar lo que se sale de lo normal en un sitio o app, con tres
  motivos distintos:
  - **Escaneo**: muchos sondeos a rutas sensibles (.env, phpinfo, paneles) en 15 minutos.
  - **Scraping**: una sola IP con cientos de pedidos en 5 minutos, aunque se disfrace de navegador.
  - **Pico de visitas**: el tráfico se multiplica frente a lo normal del sitio y llega de muchas IPs; puede
    ser que se hizo viral o un ataque distribuido.
  En el mapa, escaneo y scraping ponen **dos patrullas con las luces encendidas** junto al edificio y el cartel
  «EN VIGILANCIA»; un pico enciende **reflectores** con el cartel «PICO DE VISITAS». Además, línea en el
  ticker, el director va a mirar, y la ficha del sitio explica qué pasa y qué hacer. Sale sola tras 10 minutos
  de calma. Se ignora el tráfico de la propia pantalla de Atalaya y los buscadores conocidos. Funciona en
  todos los temas; en modo público, sin IPs ni dominios.

### Cambiado
- Los autos de la autopista son autos pixel vistos desde arriba (carrocería del color de la visita,
  parabrisas, faros y luces traseras) que giran hacia donde van. El auto de los sondeos es un auto pixel de
  perfil con la sirena encendida.
- Estaciones de los agentes: «Web» es ahora un globo terráqueo (la antena parecía una copa) y «Editando», una
  hoja con renglones y un lápiz (antes, llave y martillo).
- Los efectos (sobres, haces, vigilancia, marcas del director) ya no se dibujan encima de los paneles.

## [0.43.0] - 2026-09-26

### Cambiado
- **El modo director sigue lo que pasa en el servidor.** Antes recorría los distritos en orden fijo; ahora
  pondera cada evento (un servicio caído, un archivo expuesto, un agente que pide permiso, un despliegue, una
  consulta lenta, una sesión nueva de Claude), encuadra su edificio o su agente unos segundos con un rótulo
  arriba («Consulta lenta de 14 s en tienda.com») y una marca de esquinas sobre lo que muestra. Lo más grave
  interrumpe a lo menor y nada se repite en dos minutos. Sin novedades, muestra lo activo (un agente
  trabajando, el sitio con más visitas); si todo está quieto, vuelve al recorrido general. Funciona en todos
  los temas y en modo público usa los nombres públicos. Si usted mueve la cámara, el director se aparta.

## [0.42.1] - 2026-09-26

### Corregido
- Actividad de bases: el botón «Activar» no llegaba al ayudante (faltaba en la lista de acciones permitidas) y
  el ayudante no encontraba la credencial de root de MySQL en cPanel (`/root/.my.cnf`) porque corre sin `HOME`.

## [0.42.0] - 2026-09-26

### Añadido
- **Actividad de las bases de datos** (Bases de datos › Actividad ahora): conexiones abiertas contra el máximo
  del servidor (con el pico histórico), consultas por segundo (lecturas, altas, cambios y borrados), cuántas
  corren ahora, y las bases más ocupadas de los últimos 15 minutos. Cada base muestra su consulta más larga
  y la más lenta de la última hora, **sin sus valores** (correos, claves e ids se cambian por `?`) y solo en
  modo privado. Se activa con un botón: el ayudante crea un usuario de MySQL con un único permiso
  (`PROCESS`, ver las consultas en curso), que no puede leer ni cambiar datos y usa como mucho 2 conexiones.
- En la Salud del servidor, «Actividad de bases»: avisa cuando las conexiones están casi agotadas, cuando
  alguna fue rechazada por falta de lugar y cuando hubo consultas lentas.
- En el mapa, solo lo que pide atención: una consulta de más de 10 s hace un pulso ámbar con un cilindro y
  un reloj de arena sobre el edificio del sitio que usa esa base. Lo demás queda en la ficha.

## [0.41.0] - 2026-09-26

### Añadido
- Agentes Claude: cada tarjeta dice **en qué proyecto y en qué cuenta** trabaja la sesión (el sitio o la app de
  PM2 cuya carpeta la contiene, por ejemplo «neracosu.com · cuenta neracosu»), y debajo la carpeta exacta y el
  modelo. En la ficha del agente, el proyecto lleva a su edificio. En modo público se ve el nombre público del
  proyecto y de la cuenta, nunca el dominio ni la ruta.

## [0.40.0] - 2026-09-26

### Añadido
- **Entrada y salida de las sesiones de Claude Code**: al abrirse una sesión baja un haz de luz donde aparece
  su robot («nueva sesión»); al cerrarse, el haz sube y el robot se va («sesión cerrada», o «sin actividad» si
  se retiró por tiempo). Funciona en todos los temas.

### Corregido
- Un robot podía quedar «En pausa» hasta 45 minutos después de cerrar su sesión. El aviso de cierre
  (`SessionEnd`) corría en segundo plano y Claude se cerraba antes de que saliera: ahora va sincrónico
  (como mucho 2 s al salir si Atalaya no responde). Y si la terminal se cierra sin aviso, cuando una cuenta
  tiene más sesiones en pantalla que procesos de Claude vivos, las que sobran se retiran a los 2 minutos.
  **Requiere acción:** reinstale los hooks (`node hooks/install.js`, o el comando remoto en cada laptop).

## [0.39.0] - 2026-09-26

### Añadido
- **Usuarios desde la pantalla** (menú › Usuarios): agregar, cambiar el PIN o el rol (dueño o solo ver) y
  borrar, sin terminal. Solo lo usa un dueño con el modo privado activo. Nadie puede borrarse a sí mismo ni
  dejar la pantalla sin dueños; cambiar el PIN de alguien o borrarlo cierra sus sesiones al instante (quien
  cambia su propio PIN sigue dentro).

### Corregido
- Los cuadros de Instalar, Temas, Novedades y Leyenda tenían un ancho fijo mientras la letra crece con la
  pantalla: en monitores grandes y TV quedaban apretados. Ahora escalan con la letra.

## [0.38.0] - 2026-09-26

### Corregido
- Modo privado: el cuadro para activarlo tenía un ancho fijo mientras la letra crece con la pantalla; en monitores
  grandes y TV la duración «Sin límite» se salía de su caja y el botón se partía en dos líneas. Ahora la caja
  escala con la letra, en el teléfono los botones van uno debajo del otro y el candado tiene su tamaño.
- El paquete de instalación es más liviano: lleva solo lo que el monitor necesita.

## [0.37.1] - 2026-09-26

### Corregido
- Archivos expuestos y LeakIX: con el servicio endurecido, averiguar la IP pública del sistema fallaba. Ahora
  se usa la IP principal de cPanel (o `publicIp` en la configuración).

## [0.37.0] - 2026-09-26

### Añadido
- **Archivos expuestos**, en «Salud del servidor»: una vez al día Atalaya busca en los docroots carpetas
  `.git`, `.svn`, `.hg` y archivos `.env`, y los pide a este mismo servidor por **todos** los nombres que
  llegan a ese sitio (el dominio, `www.`, `mail.`, sus alias, la subcarpeta vista desde el dominio padre) y
  por la IP directa: un `.git` tapado para el dominio puede seguir sirviéndose por `mail.dominio` o por la
  IP. También avisa de los repositorios que, aunque hoy no se sirvan, viven dentro
  de un docroot.
- **Buscadores de filtraciones (LeakIX)**: con una clave gratuita de leakix.net (conector en el asistente),
  una vez al día revisa si la IP o los dominios del servidor aparecen publicados allí y cómo pedir la baja.
  Guarda solo el tipo, el nombre y las fechas: nunca el contenido filtrado.

### Cambiado
- Defensa web: al verificar una ruta sensible que respondió, también la prueba por `www.` y `mail.` del
  dominio antes de darla por no expuesta.

## [0.36.2] - 2026-09-26

### Añadido
- **Preparado para abrir el núcleo (open core, AGPL-3.0)**, sin publicarlo todavía: licencia, guía para
  contribuir, política de seguridad y código de conducta, y `scripts/export-public.js`, que arma la versión
  pública con historial nuevo, sin el portal de la nube, el sitio ni `config.json`, y se niega a exportar si
  encuentra cuentas reales, IPs o datos de contacto.
- La hoja de ruta del README se ordena según lo que piden quienes usan Atalaya.

### Corregido
- Las pruebas de plataformas dependían de archivos `.log` de ejemplo y carpetas vacías que el `.gitignore`
  dejaba fuera de git: un clon nuevo fallaba. Ahora están en el repositorio.
- El plugin de WordPress apuntaba su enlace a una pantalla privada; ahora va al sitio del proyecto.

## [0.36.0] - 2026-09-26

### Añadido
- **Definiciones que se actualizan solas**, como las de un antivirus. Lo que Atalaya detecta y cómo empezar
  a resolverlo (familias de sondeos web, motivos de rebote y los textos de «cómo arreglarlo») salió del
  código a `defs/definiciones.json`. Una vez al día cada instalación revisa
  `nube.neracosu.com/definiciones/latest.json`: solo acepta paquetes firmados (ed25519) con la clave
  pública que trae Atalaya, más nuevos que los que tiene y con reglas válidas, y los aplica en caliente sin
  reiniciar. Si algo falla, sigue con las que tenía. No se envía ningún dato del servidor. Las fichas de
  Defensa web y Correo muestran la versión vigente. `node scripts/defs.js keygen | check | publish`.

## [0.35.0] - 2026-09-26

### Añadido
- **Defensa web.** Atalaya reconoce, en las visitas que ya lee, a los robots que buscan rutas vulnerables
  en cada sitio: secretos y respaldos (`/.env`, `/.git`, `.sql`, `wp-config.php.bak`), webshells, paneles
  (`phpmyadmin`, `adminer`), exploits (`../`, `/etc/passwd`, `${jndi`) y el login de WordPress en sitios que
  no lo son (en un WordPress, solo la fuerza bruta cuenta). Sin falsos positivos comunes: el `admin.php`
  propio de un sitio o su `wp-login.php` no son sondeos.
- **Archivos expuestos verificados.** Cuando una ruta de secretos o de webshell responde 200, Atalaya la
  vuelve a pedir una vez (junto con una ruta inventada) para distinguir un archivo expuesto de un sitio
  que responde lo mismo a todo; nunca guarda ni muestra el contenido. Un phpMyAdmin o Adminer que responde
  a cualquiera se anota como riesgo, y la descarga de un `.git` objeto por objeto (hashes exactos) se
  avisa como tal: alguien ya tiene su índice.
- Ficha **Defensa web** (global y por sitio): lo que hay que atender con su «cómo arreglarlo», qué buscan,
  sitios más buscados, países y, en privado, rutas e IPs. En el bloque Defensa, «Sondeos web / h» y
  «Archivos expuestos»; en la ficha de cada sitio y app, sus sondeos de 24 h.
- En el mundo, en los diez temas: un **auto con sirena** va al edificio y rebota con su código; si la ruta
  respondió, el edificio queda marcado en rojo con «EXPUESTO». La cinta resume los sondeos una vez por
  minuto y anuncia al instante un archivo expuesto.

## [0.34.2] - 2026-09-26

### Corregido
- Ficha de Correo: los movimientos se cortaban al borde del panel. Ahora cada uno se lee completo: qué
  pasó y de qué cuenta, «De» y «Para» en su renglón, y el código y el mensaje del servidor remoto,
  limpio (sin los saltos escapados de Exim ni el prefijo «SMTP error from remote mail server»).

## [0.34.1] - 2026-09-26

### Cambiado
- La ficha de Correo no empieza vacía al reiniciar: lee lo último del log (con la hora real de cada
  movimiento) sin animarlo en pantalla.

## [0.34.0] - 2026-09-26

### Añadido
- **Correo con contexto.** Cada movimiento dice de qué cuenta es y, si rebotó, **por qué** en palabras
  simples (sin SPF/DKIM/DMARC, el destinatario no existe, buzón lleno, spam o reputación, dominio
  inexistente, demasiados envíos), con el código del servidor remoto. La ficha de Correo trae «Por qué
  rebota» con qué hacer en cada caso y una tabla por cuenta. En privado, además, remitente, destinatario
  y el mensaje completo del rechazo. Exim y Postfix: la llegada y la entrega de cada mensaje se unen por
  su id; el correo que no es de ninguna cuenta figura como «Servidor (correo del sistema)».

## [0.33.0] - 2026-09-26

### Cambiado
- **Ciudad clásica: la autopista con peaje reemplaza al portal «Internet».** Las visitas llegan como autos
  pixel por una autopista que baja desde fuera del mapa (cian personas, gris robots, ámbar y rojo errores),
  pasan el **peaje** (el firewall: la barrera se levanta) y siguen hasta la torre y su edificio. Los
  ataques bajan por el otro carril y revientan contra la barrera, que se pone roja; los bloqueos lo avisan
  ahí mismo. Clic en la caseta: la ficha de Defensa. Los distritos de arriba dejan libre su corredor.

## [0.32.2] - 2026-09-26

### Corregido
- Ciudad clásica: la fila de estaciones de la Torre de control tapaba la línea de salud del servidor.
  Ahora va debajo del nombre, los servicios y la salud, y los distritos le dejan más espacio.

## [0.32.1] - 2026-09-26

### Corregido
- Ciudad clásica: con las estaciones más separadas, las filas de distritos chicos vecinos (y la de la
  Torre de control) se pisaban. Cada distrito reserva ahora el ancho de su fila de estaciones y la torre
  deja más aire a su alrededor.

## [0.32.0] - 2026-09-26

### Añadido
- **La comunicación entre agentes se ve**, en los diez temas: el **encargo** viaja como un sobre pixel del
  agente al subagente que lanza, el **resultado** vuelve al terminar, los **mensajes** (`SendMessage`) van
  de un agente a otro, y cuando un agente **lee o edita** un archivo de un proyecto sale un haz hacia su
  edificio (ámbar si edita, celeste si lee). El servidor ubica cada archivo en su app de PM2 o en su sitio
  (la carpeta más larga gana), a lo sumo una vez cada 2 s por agente y proyecto; en modo público viajan
  los mismos alias que el estado. Cada tema dice dónde está cada cosa con `screenOf()`; si no lo sabe, la
  animación va entre las tarjetas del panel de agentes.

### Cambiado
- **Ciudad clásica: las estaciones se entienden sin el mouse.** Cada una lleva su nombre (En pausa,
  Leyendo, Editando, Terminal, Web, Subagentes); vacía queda tenue y ocupada se enciende con el color de
  quien la usa (en ámbar y «Espera su respuesta» cuando un agente espera). El robot se para al costado
  del ícono en vez de taparlo.

## [0.31.0] - 2026-09-26

### Añadido
- **Atalaya Equipo: el ejecutable único** para Windows, macOS (Intel y Apple) y Linux (x64 y arm64). Un
  solo archivo con Node adentro (Node SEA) que se descomprime y se abre: extrae la aplicación en la caché
  del usuario, elige un puerto libre desde el 3950, abre el navegador en el asistente con el código ya
  puesto y escucha solo en 127.0.0.1. Muestra esa computadora, sus sesiones de Claude Code y los
  conectores de nube. En macOS y Windows las métricas salen del módulo `os` (sin `/proc`), y una sesión
  no se da por cerrada por no ver su proceso. Abrirlo dos veces abre la pantalla que ya corre.
- `node scripts/build-exe.js`: descarga el Node oficial de la misma versión (verificado por SHA-256),
  inyecta la aplicación, firma ad hoc los de macOS, quita la firma rota del `.exe` y deja paquetes con
  `LEEME.txt` y sus sumas en `dist/`.
- Sitio: la quinta forma de usarlo y la guía «Atalaya en su computadora».

## [0.30.3] - 2026-09-26

### Seguridad
- Atalaya Cloud: las fichas de los indicadores (`api/detail?kind=metric`) todavía leían `/proc` de la
  máquina que aloja (núcleos, particiones, interfaces de red y conexiones). El colector de métricas ya no
  corre en la nube; una prueba lo vigila.

## [0.30.1] - 2026-09-26

### Cambiado
- **El nombre es Atalaya Monitor Server.** Completo en títulos, buscadores, README, plugin de WordPress y
  la descripción del paquete; en el logo, «ATALAYA» con «MONITOR SERVER» como firma (acceso, asistente,
  sitio, portal y banner). En el texto corrido sigue siendo Atalaya.
- **El sitio del proyecto se mudó a [neracosu.com/atalaya](https://neracosu.com/atalaya/)** (y sus guías a
  `/atalaya/guias/`). La fuente vive en `site/` y se publica con `node scripts/export-site.js`, que suma
  fuentes, íconos pixel y capturas y sella cada archivo con `?v=<hash>` (neracosu.com los cachea un año).
  Los botones de contacto van a WhatsApp, como el resto de neracosu.com.
- `nube.neracosu.com` queda solo para Atalaya Cloud: entrar a una pantalla, crear una con invitación y un
  enlace al sitio. `/guias` redirige a neracosu.com.

## [0.30.0] - 2026-09-26

### Añadido
- **Atalaya Cloud**: una pantalla alojada para quien no tiene servidor, en `nube.neracosu.com/<cliente>`.
  Es la misma Atalaya en una edición `cloud` que no mira la máquina que la aloja: solo lo que el cliente
  conecta (Vercel, Supabase, GitHub, hostings por agente, sitios WordPress y laptops con Claude Code).
  Se entra **por invitación**; cada cliente tiene su propio proceso, su carpeta y sus límites.
- **Planes** `gratis`, `pro` y `equipo`, sin cobro por ahora: limitan conectores de nube, hostings o sitios
  WordPress y laptops. Al pasar el tope, el asistente lo dice en palabras simples.
- **Sitio del proyecto** en la portada del portal: qué es Atalaya, qué soluciona y para quién, una escena
  pixel en vivo (edificios por servicio, visitas, invasores contra el escudo, un robot de Claude Code que
  pide permiso), calculadora de lo que cuesta enterarse tarde, las fugas que nadie anota, un día con
  Atalaya, las cuatro formas de usarlo, galería de los diez temas, seguridad, planes y preguntas.
  Más una página de **guías paso a paso** (Cloud, la pantalla, Vercel, Supabase, GitHub, hostings,
  WordPress, laptops, VPS, Hosting, usuarios, temas y la leyenda).
- Asistente con pasos propios en la nube: bienvenida con los límites del plan, nombre y conexiones.

### Cambiado
- **Rutas relativas en toda la interfaz** (páginas, módulos, temas, redirecciones del servidor) y cookies
  con el prefijo de la pantalla, para que la misma Atalaya funcione en la raíz o bajo `/<cliente>/`.
  Los temas de la comunidad deben importar con `../../js/...` (la guía y las pruebas lo indican).
- El pixel art (robot, invasor, sobre, carteles, íconos) pasó a `web/js/pixeldata.js`, sin PixiJS: los
  íconos de la interfaz ya no cargan el motor 2D y el sitio del proyecto usa los mismos dibujos.

### Seguridad
- En la nube, los favicons y las sondas web no pueden alcanzar la red interna de la máquina (revisión en
  el `lookup` del socket, que también frena el cambio de DNS entre consulta y conexión). El «Project ref»
  de Supabase se valida para que no pueda desviar la conexión a otro servidor.
- Servicio `atalaya-cloud` con usuario propio sin privilegios: no ve `/home`, ni otros procesos, ni el
  estado de Atalaya VPS.

### Corregido
- En el diálogo de hostings se habían colado dos emojis: ahora son íconos pixel.

## [0.29.0] - 2026-09-26

### Cambiado
- **La salud es parte del servidor.** Al seleccionar el servidor (la Torre de control) su ficha abre con la
  salud completa arriba: cada revisión, sus cifras y cada hallazgo con su «cómo arreglarlo»; lo que está
  en orden va en una línea. Y en el mundo de cada tema, el servidor muestra su estado bajo su nombre, con
  color («Salud: 2 graves · 3 para revisar»): la torre, el castillo, la base, el Guardián, el filtro del
  acuario, la central, la sala de servidores, la torre del reloj y, en Terminal, como un chequeo de
  arranque. Los chips de la columna derecha quedan como vista rápida y abren la Torre de control.

## [0.28.0] - 2026-09-26

### Añadido
- **Salud del servidor**, en la columna derecha de todos los temas y en su propia ficha: lo que un
  sysadmin revisa cada día, en solo lectura y con su «cómo arreglarlo».
  - **Respaldos**: si están activos, cuándo fue el último, cuántas copias hay, si alguno dejó de hacerse
    y si solo existen en el mismo disco que los sitios (sin destino externo).
  - **Actualizaciones**: reinicio pendiente por núcleo nuevo, preferencias de actualización de cPanel y,
    con el botón «Revisar actualizaciones», cuántos paquetes hay pendientes y cuántos son de seguridad
    (consulta al gestor de paquetes sin salir a internet).
  - **Cola de correo**: mensajes esperando, congelados y el más viejo (spam saliente, destinos caídos).
  - **Tareas cron**: contraseñas o tokens escritos en el comando, registros dentro de `public_html` y
    tareas que apuntan a archivos que ya no existen.
  - **Puertos**: bases de datos o cachés escuchando hacia internet y apps que se saltan el proxy.
  - En modo público solo se ve el estado y cuántos hallazgos hay.

### Corregido
- La Torre de control (el detalle del servidor) se quedaba en «Cargando…» desde la 0.26.0. Además, si una
  ficha no se puede mostrar, ahora lo dice en vez de quedarse cargando.
- En Villa y Castillo, el cuadro de indicadores tapaba el comienzo de la columna derecha.
- La columna derecha siempre cabe: si no alcanza el alto, achica las gráficas, muestra menos procesos y
  proyectos y, como último recurso, achica un poco el texto.

## [0.27.1] - 2026-09-26

### Corregido
- La ficha de los sitios (PHP, HTML, WordPress) se quedaba en «Cargando…»: la etiqueta del sitio pisaba
  el tipo de ficha y el panel no sabía qué dibujar. Ahora abre con sus visitantes, páginas y datos.

## [0.27.0] - 2026-09-26

### Añadido
- **Castillo**, un tema nuevo en pixel art 2D: un castillo gótico de noche visto de costado. La torre del
  reloj es el servidor (sus agujas giran con la CPU; sus ventanas se ponen rojas si falla un servicio
  clave), cada cuenta es una sala con su estandarte y su placa, cada servicio un candelabro cuyas llamas
  crecen con la CPU (azul y débil si está a medias, apagado y humeando si cayó) y cada sitio un vitral
  que proyecta luz con las visitas. Las visitas son murciélagos que bajan de la luna, los intentos de
  acceso espectros que se quedan en el portón, los agentes de Claude Code cazadoras con su antorcha y el
  correo, cuervos.
- **Visitantes ahora, visitas y visitantes de hoy** en el detalle de cada sitio y servicio (personas, sin
  robots). Los contadores del día se guardan y sobreviven a un reinicio.

### Corregido
- **Los sitios PHP, HTML y WordPress no mostraban visitas en vivo en cPanel.** cPanel escribe el log de
  cada dominio por tandas (acumula las líneas hasta llenar un búfer), así que un sitio con poco tráfico
  podía pasar minutos sin registrar nada y verse apagado. Ahora las visitas se cuentan en vivo desde el
  registro de tráfico de cPanel, y el log de cada dominio aporta el detalle (página, código, navegador,
  origen) con su hora real, sin contar dos veces.
- Al arrancar, Atalaya relee la última hora de cada log: los paneles de detalle ya no empiezan vacíos
  después de un reinicio.
- En Oficina y Castillo, las placas de salas angostas ya no se enciman.

## [0.26.1] - 2026-09-26

### Cambiado
- README al día: los nueve temas (2D, 3D y texto), la versión para teléfono, los favicons, las teclas y
  gestos, la arquitectura (motor 3D, placas, favicons, kit) y los créditos de three.js y las fuentes de
  los temas. La guía de temas suma la tabla de los nueve temas, las piezas para temas 2D, los favicons
  (`fav:` en `icon`) y cómo se ven los temas en teléfonos y tablets. El README del kit, igual.

## [0.26.0] - 2026-09-26

### Añadido
- **Íconos reales de cada proyecto.** Atalaya descarga el favicon de cada sitio y de cada servicio
  publicado (lee los `<link rel="icon">` de su página de inicio o `/favicon.ico`), sin IA ni servicios de
  terceros: funciona en cualquier servidor. Se guardan en el disco del servidor, se renuevan cada 7 días
  y se ven en todos los temas (carteles, placas, detalle, Terminal) con un toque pixel.
  - Solo en **modo privado**: un favicon delata la marca del proyecto. En público se ve el cartel pixel.
  - Los proyectos sin favicon (o en público) reciben un **cartel pixel propio**, elegido al azar pero
    fijo para cada proyecto, en vez del mismo ícono genérico para todos. Los que Atalaya reconoce
    (base de datos, caché, tienda, WordPress en construcción…) conservan su ícono de categoría.
  - Seguro: solo imágenes verificadas por su firma, con límite de tamaño y de tiempo, y sin seguir enlaces
    a IPs internas.

## [0.25.0] - 2026-09-26

### Añadido
- **Versión para teléfonos y tablets**, en todos los temas. En pantallas de hasta 1100 px de ancho (o
  560 px de alto) el HUD se reacomoda: barra fina arriba, una tira de indicadores que se desliza de
  lado, el mundo en el centro a pantalla completa (se mueve con el dedo y se acerca pellizcando), la
  última novedad en una línea y una barra de pestañas (Mundo, Agentes, Métricas, Novedades) que abre
  cada panel como hoja desde abajo, con contadores. El detalle también sale como hoja. Con el teléfono
  acostado, las pestañas pasan a una barra vertical a la derecha para que el mundo gane alto. Cada tema
  conserva sus colores y su letra.

### Corregido
- En el teléfono el menú (⋮) se abría detrás de la tira de indicadores y tapaba las primeras opciones.
- Las capturas del README pasan a WebP (y el video a WebP animado): de 16 MB a 3 MB.
- En áreas verticales (teléfono parado) los temas 3D alejan la cámara para que entre todo; Ops oculta
  las fichas laterales cuando no hay lugar, y los títulos de Villa y Raid se achican para no encimarse.

## [0.24.2] - 2026-09-26

### Corregido
- Pantallas muy anchas (3440×1440): en Terminal las líneas se metían en la ventana vecina; ahora las
  columnas se ajustan y la letra se elige para que ninguna línea se salga. En Ops la mesa ya no queda
  bajo la barra de navegación.
- Si la columna derecha no cabe en el alto de la pantalla, las gráficas se achican lo justo para que se
  vea todo (antes se cortaban Defensa y Correo, por ejemplo en Villa).

## [0.24.1] - 2026-09-26

### Corregido
- Terminal: los títulos de las ventanas, el cursor de los agentes y las notas usaban caracteres que la
  fuente VT323 no tiene; se dibujaban con otra fuente más alta y se salían de su lugar. Ahora todo usa
  caracteres de la fuente y quedan alineados. La gráfica de visitas de cada línea usa escala
  logarítmica y queda separada de la barra de CPU.
- Las gráficas de la columna derecha cortaban la última hora del eje en el borde: ahora tienen margen.

## [0.24.0] - 2026-09-26

### Añadido
- **Terminal**, un tema nuevo: una consola de fósforo verde de los 80 con ventanas de texto como tmux.
  El servidor es `root@atalaya` con barras al estilo htop y sus servicios clave como un arranque de
  systemd (`[  OK  ]` / `[ FALLO ]`); cada cuenta es una ventana con una línea por servicio o sitio
  (barra de CPU, gráfica de visitas con caracteres y su estado); las visitas corren por un
  `tail -f access.log`, los intentos de acceso por `journalctl -fu sshd` y los agentes de Claude Code
  son procesos con cursor que preguntan `¿Permitir? [s/N]`. Todo es texto: cada proyecto se lee sin
  hacer clic, y la letra se ajusta sola para que todo quepa.

## [0.23.0] - 2026-09-26

### Cambiado
- **Oficina, rehecha en pixel art isométrico 2D**, al estilo de los hoteles virtuales de los 2000: cada
  cuenta es una sala flotando en el vacío, con piso de baldosas, paredes con ventanas y el remate de su
  color; muebles y personajitos en pixel art dibujados en código; los avisos salen en globos de
  diálogo. Conserva el directorio de cada sala y los nombres de cada puesto al acercarse.
- **Raid vuelve a su versión clásica** en pixel art 2D.

### Corregido
- El cuadro de novedades de Villa, Raid, Planta, Ops y Acuario cortaba los textos largos: ahora cada
  novedad hace salto de línea y se lee completa.

## [0.22.0] - 2026-09-26

### Añadido
- **Oficina**, un tema nuevo: un piso de oficina abierto en 3D. La sala de servidores es el servidor
  (racks con luces que titilan con la CPU), cada cuenta un departamento con sus mamparas de color y un
  directorio al frente que nombra todos sus puestos, cada servicio un escritorio con su empleado
  (teclea más rápido con más CPU; si cae, se va y el monitor queda en rojo) y cada sitio un puesto con
  laptop. Las visitas llegan como aviones de papel desde el ascensor, los errores terminan en la
  papelera, los intrusos se quedan en los torniquetes y los agentes de Claude Code son compañeros con
  laptop que levantan la mano cuando esperan su permiso.

### Cambiado
- **Ops** usa el motor 3D compartido y suma **fichas de sector** a ambos lados de la mesa, unidas a su
  sector con una línea guía, que nombran todos sus servicios y sitios (compactas si no caben).
- **Villa vuelve a su versión clásica** en pixel art 2D: gustaba más que el diorama 3D.

## [0.21.0] - 2026-09-26

### Cambiado
- **Todos los temas ya son 3D.** **Villa** es un reino en miniatura (castillo, pueblos amurallados,
  casas con humo y fuego, aldeanos que caminan por el camino, slimes contra la muralla y magos),
  **Raid** una arena de mazmorra (El Intruso en 3D lanzando bolas de fuego contra el escudo del
  Guardián, héroes en pixel art con vida y maná, números de combate) y **Planta** una fábrica
  (central con chimenea y silos, máquinas con engranajes, prensas, piezas por las cintas, drones y
  torreta). La Ciudad clásica sigue disponible en 2D.
- **Cada proyecto se ubica sin hacer clic en todos los temas 3D**: delante de cada cuenta hay una
  placa (tablón en Villa) con la lista de todos sus proyectos, cada uno con su dibujo pixel; un clic en
  un nombre lo abre. Al acercarse a una cuenta, cada proyecto lleva su nombre encima.
- Las placas se miden en pantalla y los grupos se reacomodan solos para que nunca se encimen. En
  pantallas chicas pasan a modo compacto (nombre, cuenta y cantidad) y la lista aparece al acercarse.

### Añadido
- Piezas comunes en el motor 3D para temas de la comunidad: agrupar por cuenta (`groupsOf`),
  repartir grupos en filas (`packRows`), placas con lista (`plaqueList`, `sizePlaques`,
  `refitPlaques`) y encuadre exacto en el área libre del HUD (`distToFit`).

## [0.20.0] - 2026-09-26

### Añadido
- **Ciudad 3D**, un tema nuevo: la ciudad de noche en tres dimensiones. Cada cuenta es una parcela con
  sus edificios (altura según la memoria, ventanas que se encienden con las visitas, techo que brilla
  con la CPU), la torre de control con su escudo en el centro, visitas que recorren las calles desde el
  portal «Internet», e invasores y robots de Claude Code en pixel art. La Ciudad de siempre sigue
  disponible como **Ciudad clásica**.
- Motor 3D compartido para temas (`web/js/stage3d.js`): cámara con director y navegación libre,
  encuadre dentro del área libre del HUD, etiquetas HTML nítidas que siguen a los objetos, clics y
  avisos, efectos y sprites en pixel art. La guía de temas lo documenta.
- Los nombres chicos del mundo 3D ya no se pisan: si dos chocan en pantalla, se ve el más cercano.

### Cambiado
- **Acuario, rehecho en 3D**: una pared de peceras como en una tienda. Cada cuenta es una **pecera
  independiente** en su estante, con una **placa** que nombra a todos sus peces, cada uno con su dibujo
  en pixel art y sus mismos colores; un clic en un nombre lo abre. Al acercarse a una pecera, cada pez
  lleva su nombre encima. El servidor es el primer tanque: su agua sube con el disco usado. Los
  estantes se reparten solos para que las peceras se vean lo más grandes posible.
- En Ciudad 3D, al acercarse a un distrito se ven los nombres de todos sus edificios (de lejos, los
  cinco con más visitas y los caídos).

## [0.19.0] - 2026-09-25

### Cambiado
- **Ops, rehecho en 3D con three.js**: una mesa táctica holográfica, nítida y a resolución completa
  (antes se veía borroso). Cada cuenta es un sector con su nombre y su cuenta; cada servicio una
  **columna** que sube con su CPU y cada sitio un **prisma** que sube con sus visitas, con su cartel en
  pixel art encima. El barrido las hace brillar al pasar, las visitas caen en arco, los intentos de
  acceso son **misiles** contra la cúpula de la base y los agentes de Claude Code son **drones**. La
  cámara orbita sola en modo director; se gira arrastrando.
- Los temas combinan formas limpias y textos nítidos con acentos en pixel art (en lugar de pixelar
  todo). Ops usa una fuente nítida para el texto y la pixel solo en títulos y números.

### Añadido
- three.js (MIT) en `web/vendor` para temas en 3D.

## [0.18.1] - 2026-09-25

### Corregido
- La columna derecha (gráficas, procesos, proyectos, defensa y correo) ya no se encima en ningún tema:
  las secciones no se aplastan, las gráficas se ajustan a la altura de la pantalla y, si no alcanza,
  la columna se desplaza. Ops y Planta muestran 5 procesos para que todo quepa.
- Todos los temas muestran debajo de cada cuenta lo mismo que la Ciudad: en privado, la cuenta de
  cPanel y su dominio principal; en público, cuántos servicios y sitios tiene (y qué es en las
  cuentas especiales). También en el aviso al pasar el mouse.

## [0.18.0] - 2026-09-25

### Añadido
- **Tema Raid**: una banda de MMO de fantasía en una arena de mazmorra. Cada cuenta es un grupo y
  cada servicio un **héroe** con barra de vida (estado) y de maná (CPU); su clase depende de qué es
  (guerrero PM2, paladín systemd, ingeniero contenedor, mago Vercel, sacerdote Supabase, arquero o
  pícaro para los sitios). Las visitas son **números de combate** (+N verde, -502 rojo), un servicio
  caído es un héroe muerto que resucita al reiniciarse, el servidor es **el Guardián** y los intentos
  de acceso son ataques de **El Intruso**, el jefe, que pierde vida con cada IP bloqueada. Los agentes
  de Claude Code son jugadores con barra de lanzamiento y la comprobación «?» cuando esperan permiso.
  HUD con barra de acción (teclas 1 a 8), registro de combate y medidor. Fuente Jersey 10 (SIL OFL).
- **Tema Acuario** (tendencia: juegos idle de escritorio y acuarios de 2025-2026): de costado, el agua
  sube con el disco usado; cada cuenta es una pecera y cada servicio un **pez único** (tamaño =
  memoria, velocidad = CPU, panza arriba si cae). Las visitas son comida, los errores nubes rojas, los
  ataques medusas contra la tapa y los agentes de Claude Code **buzos**. HUD en una franja inferior.
- **Tema Planta** (tendencia: juegos de automatización y fábricas), con la paleta de PICO-8: la
  central (CPU, memoria y disco), naves con **máquinas** y prensas, **piezas** que viajan por las
  cintas hasta su máquina, errores que terminan en la **chatarra**, drones derribados por una torreta
  y **robots obreros** que se detienen en una barrera cuando piden permiso. HUD de sala de control
  con pantallas LCD y tickets impresos.

### Corregido
- La revisión de temas explica qué falta si una carpeta de `web/themes` no tiene `theme.json`.

## [0.17.0] - 2026-09-25

### Añadido
- **Kit de temas** (repositorio aparte `atalaya-temas`): para diseñar temas **sin un servidor**. Trae
  la interfaz de Atalaya, la guía y un **simulador** que reproduce en bucle unos minutos grabados de
  un servidor real **en modo público** (sin nombres, dominios ni IPs), con los paneles de detalle
  grabados y una página de **escenarios** para provocar lo que casi nunca pasa: una caída, un ataque,
  un agente que pide permiso, un despliegue, un pico de visitas, correo o un cambio de dominio.
  `npm start` y listo; `npm run check` revisa el tema.
- `scripts/export-kit.js` regenera el kit desde Atalaya (conserva los temas de la comunidad) y
  `scripts/record-sim.js` / `scripts/record-details.js` graban los datos del simulador, siempre en
  modo público.

### Corregido
- Villa: los aldeanos entran por un camino propio desde el sur en lugar de atravesar pueblos.

## [0.16.0] - 2026-09-25

### Añadido
- **Tema Villa**: un RPG de casillas visto desde arriba, con todo el arte dibujado en código. El
  servidor es un **castillo** y cada cuenta un **pueblo amurallado** con su estandarte; los caminos
  se trazan solos esquivando murallas y se unen entre sí. Cada servicio es una **casa de piedra**
  (su chimenea echa más humo con más CPU, sus ventanas se encienden con las visitas y **arde** si se
  cae) y cada sitio una **cabaña de paja**, con el cartel de lo que es. Las visitas son **aldeanos**
  que caminan del borde al castillo y de ahí a la casa (los robots son pájaros), los intentos de
  acceso son **slimes** que golpean la muralla (un guardia los derrota si la IP cae) y las sesiones
  de Claude Code son **magos** en la plaza con sus aprendices. HUD de madera: barras de estado a la
  derecha y registro del reino como un chat. Fuentes Pixelify Sans y Jacquard 24 (SIL OFL 1.1).
- Los temas pueden declarar en CSS el área exacta del mundo (`#worldArea`).

## [0.15.0] - 2026-09-25

### Añadido
- **Sistema de temas.** Cada tema es una carpeta `web/themes/<id>/` con su manifiesto
  (`theme.json`), su mundo (`world.js`, PixiJS) y su HUD (`theme.css`): cambia **el mundo y la
  distribución del HUD**, no solo los colores. Se cambia **en caliente**, sin recargar.
- **Tema Ops**: un radar táctico en pixel art. El servidor es la base, cada cuenta un sector, cada
  servicio un contacto amigo que el barrido ilumina, cada visita una traza que entra desde el
  borde, cada ataque un contacto hostil que choca contra el escudo y cada sesión de Claude Code una
  escuadra. El HUD pasa a lecturas sin tarjetas, esquinas de mira y la cinta de novedades como un
  parte de operaciones en columna. Fuente VT323 (SIL OFL 1.1).
- **Selector de temas** (menú › Tema, con vista previa de cada uno): para esta pantalla o, como
  dueño, para todas (las demás cambian solas). Tecla **T** para pasar al siguiente y `?theme=<id>`
  en la dirección.
- Cada tema trae su propia **leyenda** (tecla `?`) y sus colores para las gráficas.
- **Guía para crear temas** (`docs/TEMAS.md`): estructura, manifiesto, interfaz del mundo, formato
  del estado y de los eventos, cómo rediseñar el HUD y las reglas (pixel art, sin emojis,
  inspirado y no copiado, licencias claras, sin red externa). `npm test` valida cada tema.

### Cambiado
- La ciudad isométrica pasa a ser el tema **Ciudad**, sin cambios visibles.
- El mundo se encuadra midiendo dónde quedó cada panel del HUD, sea cual sea el tema.

### Corregido
- El paquete de instalación remota ya no incluye `docs/` (capturas y GIF del README, ~11 MB).

## [0.14.0] - 2026-09-25

### Cambiado
- **Nada de emojis: íconos en pixel art.** Todos los íconos de la interfaz (panel lateral, cinta de
  novedades, hallazgos, proyectos, asistente, leyenda y el widget del plugin de WordPress) ahora son
  pixel art del mismo estilo que los carteles de la ciudad (`web/js/pixicons.js`). Los países se
  muestran con una etiqueta pixel con su código (VE, US…) en lugar de banderas emoji.
- **README nuevo**: banner animado en pixel art, demostración en GIF de la pantalla real (en modo
  público), galería de capturas, tarjetas con íconos pixel, diagrama de cómo se conecta todo,
  instalación por pasos plegables y hoja de ruta.

### Añadido
- `scripts/readme-assets.js`: regenera el banner, los íconos y las capturas del README (siempre en
  modo público). `scripts/release.js` actualiza sola la insignia de versión del README.

### Eliminado
- La fuente de banderas emoji (Twemoji Country Flags) y su licencia: ya no se usa.

## [0.13.0] - 2026-09-25

### Añadido
- **Plugin de WordPress «Atalaya · Agente»**: conecta un sitio WordPress con Atalaya **sin terminal
  ni cron**. Desde el menú ⋮ › *Conectar un hosting compartido* › **Descargar plugin** se baja un
  `.zip` ya configurado (con la dirección y un código de un solo uso): se sube en wp-admin ›
  Plugins › Añadir nuevo, se activa y se conecta solo. También hay un plugin genérico
  (`/install/atalaya-wp.zip`) para pegar el código en Ajustes › Atalaya.
- Cada sitio es un distrito **«WordPress · …»** con lo que solo se sabe desde adentro: versión de
  WordPress y si hay una nueva, plugins y temas (activos, inactivos y por actualizar), versión de
  PHP y cuándo pierde soporte, tamaño de la base y peso de las opciones que se cargan en cada
  visita, usuarios y administradores, WooCommerce, errores de `debug.log`/`error_log` y visitas si
  el hosting deja leer sus logs. «Analizar ahora» muestra qué ocupa `wp-content`.
- **Hallazgos de WordPress** con su «cómo arreglarlo»: núcleo, plugins o temas desactualizados,
  plugins desactivados que conviene borrar, PHP sin soporte o por perderlo, `WP_DEBUG` mostrando
  errores a los visitantes, `debug.log` descargable, sitio sin HTTPS, usuario «admin», registro
  abierto con rol peligroso, editor de archivos activo, WP-Cron atrasado, opciones autoload pesadas
  y XML-RPC activo.
- El plugin **solo envía**: no registra rutas REST, acciones AJAX públicas ni shortcodes; solo el
  administrador ve su página; nunca envía contraseñas ni valores de `wp-config.php`; al
  desinstalarlo no deja nada.

## [0.12.0] - 2026-09-25

### Añadido
- **Mapa de proyectos** (panel «Proyectos» a la derecha, y en la torre): una ficha por proyecto que
  une solas las piezas dispersas: el repo de GitHub, el proyecto de Vercel, la app o el sitio del
  VPS, el sitio de un hosting compartido y la base de Supabase. Se unen por repositorio (el remoto
  `git` de cada carpeta, incluidos los alias SSH de las *deploy keys*, y el repo vinculado en
  Vercel) y, como sugerencia, por nombre parecido. Desde la ficha se puede unir, separar,
  renombrar u ocultar.
- **Puntaje de buenas prácticas** (0–100) por proyecto, con el «cómo arreglarlo» de cada punto:
  código sin repositorio o en un repo público, archivos con secretos subidos al repo, `.gitignore`
  que no excluye los `.env`, dependencias con alertas de seguridad, falta de lockfile o de CI,
  despliegue fallido o servicio caído, certificados SSL inválidos o por vencer, sitios que no
  responden o lentos, dominios por vencer (RDAP) y proyectos sin cambios hace meses pero todavía
  publicados.
- **Analizar ahora / Analizar todos**: las revisiones que salen a Internet (certificado, respuesta,
  vencimiento del dominio y API de GitHub) corren solo a pedido, por la cola de tareas pesadas.
- **Conector de GitHub** (asistente › Extras o `node cli.js connector add github`) con un token
  *fine-grained* de solo lectura.
- En modo público, los proyectos aparecen con alias y sin repos, dominios ni consejos concretos.

### Cambiado
- README reescrito: por qué Atalaya, las dos ediciones, mapa de proyectos, agentes, seguridad y hoja
  de ruta.

## [0.11.0] - 2026-09-25

### Añadido
- **Dos ediciones: Atalaya VPS y Atalaya Hosting.** El menú ⋮ › *Instalar* ahora tiene dos
  pestañas: **Servidor VPS** (con root, como hasta ahora) y **Hosting compartido** (cPanel,
  Hostinger, GoDaddy, Namecheap… sin root).
- **Agente para hosting compartido**: un script pequeño que corre por **cron cada minuto** en la
  cuenta del hosting, **lee solo esa cuenta** y envía los datos a su Atalaya. No deja nada en
  `public_html`, no usa base de datos y no abre puertos. Envía visitas en vivo (de
  `~/access-logs`), errores de PHP (`error_log`) y, cada 10 minutos, dominios y subdominios,
  cuota de disco, bases de datos, certificados SSL, buzones de correo, uso de recursos y tareas
  cron (con `uapi` de cPanel si existe). Cada hosting aparece como un **distrito** con sus sitios
  como edificios.
- Se conecta con un **código de un solo uso** (24 h) desde el menú ⋮ › *Conectar un hosting
  compartido*: se pega un comando en el Terminal de cPanel o, si el plan no trae terminal, una
  línea en *Trabajos de cron* que se instala y se borra sola. El código se canjea por un token
  propio que vive en `~/.atalaya/curl.conf` (600), nunca en la línea de comandos.
- **Hallazgos por hosting**: agente sin señal, certificados por vencer o vencidos, cuota casi
  llena, error_log que crece rápido, tareas cron con tokens escritos en la línea y tareas cron que
  guardan su salida dentro de `public_html`. Los secretos del cron se tapan antes de guardarse.
- **¿Qué ocupa el espacio?** de un hosting a pedido (*Analizar ahora*): el pedido viaja en la
  respuesta del próximo envío y el agente solo acepta palabras de una lista cerrada.
- **Atalaya Hosting**: la pantalla completa corriendo como app Node dentro de la cuenta
  (cPanel › *Setup Node.js App*, archivo de inicio `app.js`), con sus datos en `~/.atalaya-data`.
  Se instala con `curl … /get | sh -s -- --hosting --token=…`; en CloudLinux intenta crear la app
  sola. El asistente cambia el paso *Publicar* por **Conectar esta cuenta**, que instala el agente
  con un clic. Puede recibir además otros hostings del mismo cliente.

### Corregido
- Sin permiso para leer la carpeta de MySQL, la auditoría de bases se desactiva en lugar de fallar.

## [0.10.0] - 2026-09-25

### Añadido
- **Tareas pesadas solo a pedido**: los análisis costosos ya no corren solos. Se lanzan con el
  botón **Analizar ahora** (solo dueños), pasan por una cola que ejecuta **uno a la vez** y
  corren con la prioridad más baja de disco y CPU, para no saturar el servidor.
- **Mapa del disco** (panel del indicador de disco): qué ocupa el espacio por tipo (respaldos,
  correo, bases de datos, logs, papeleras, dependencias y cachés, Docker, journal), con un
  consejo para cada uno; un explorador navegable de carpetas y archivos de 50 MB o más; lo que
  creció o se achicó desde el análisis anterior, y los archivos más grandes. En modo público
  solo se ven los totales por tipo.
- **Bases de datos** (torre de control, cada distrito y el mapa del disco): lista de bases
  MySQL/MariaDB con tamaño, tablas, última escritura y cuenta dueña, leída de los archivos del
  servidor **sin conectarse ni ejecutar consultas** (no necesita contraseñas).
- **Auditoría de una base**: al entrar a una base, **Analizar ahora** muestra sus tablas por
  tamaño y motor, **quién la usa** (busca el nombre en los archivos de configuración de la
  cuenta: `wp-config.php`, `.env`, `~/.config/<proyecto>/`… sin mostrar su contenido), qué
  creció desde la auditoría anterior y hallazgos: tablas que suelen inflarse (logs de
  WooCommerce, sesiones, cachés), tablas MyISAM, datos sin tocar hace más de un año, bases
  *shadow* de Prisma y bases que **podrían** estar huérfanas (siempre como sospecha a revisar,
  nunca como certeza). En modo público las bases aparecen con un alias y sin tablas.
- La carpeta de datos de MySQL se detecta de `my.cnf`; se puede fijar con `mysql.datadir`.

## [0.9.0] - 2026-09-25

### Añadido
- **Asistente web de configuración**: en una instalación nueva, la primera visita abre un
  asistente guiado (detección del servidor, usuario dueño y PIN, nombre y dirección, publicación,
  países, hooks de Claude, Vercel, Supabase y laptops). Se entra con un **código de un solo uso**
  que muestra el instalador (nadie puede "reclamar" la instalación sin acceso al servidor).
  Mientras se configura, también responde en un puerto temporal (3951) que se cierra solo al
  terminar. Los dueños pueden volver a abrirlo desde el menú.
- **Ayudante con permisos limitados** (`atalaya-helper.path`): ejecuta solo acciones de una lista
  cerrada que pide el asistente (instalar o quitar hooks; en cPanel, crear el subdominio con SSL y
  dejarlo apuntando a Atalaya). El panel web sigue sin permisos de root.
- **Instalar en otro servidor** (menú, solo dueños): genera un comando de una línea con un token
  de descarga que vence en 24 h (5 usos). Se pega en **WHM › Terminal** o por SSH; instala Node.js
  si falta, descarga el paquete desde esta Atalaya, verifica su huella SHA-256 y termina mostrando
  la dirección y el código del asistente. En cPanel, `--domain=su-dominio.com` publica el
  subdominio en el mismo paso. El paquete nunca incluye su `config.json`.
- **Cada indicador de la barra superior abre su propio panel**: CPU (por modo y por núcleo),
  Memoria (desglose y swap), Disco (particiones, inodos, lectura y escritura), Carga (contra los
  núcleos y procesos en espera), Red (interfaces y conexiones TCP), Visitas (qué sitios, quién y
  desde dónde) y Errores 5xx (qué sitio falla y en qué página).
- **La cinta de novedades rota sola** entre las últimas 10, se puede deslizar, y "Ver todo" abre
  el historial con filtros (agentes, seguridad, servicios, sitios, correo).
- Configuración en capas: los ajustes del asistente van a `/var/lib/atalaya/settings.json` y se
  aplican en caliente; `config.json` pasa a ser opcional.

### Corregido
- Al volver a modo público, la cinta se vacía: antes podía seguir mostrando textos del modo
  privado.
- El porcentaje de disco sigue el mismo criterio que `df` en el indicador y en su panel.

## [0.8.0] - 2026-09-25

### Añadido
- **Conectores de nube** para quien no tiene servidor propio (Vercel + Supabase):
  - **Vercel**: cada proyecto es un edificio; los despliegues se ven en vivo (desplegando, listo,
    falló, cancelado) en el mapa y en la cinta, con su historial, commit, rama y dominios en el
    panel. Con un **Drain** (plan Pro de Vercel) las visitas llegan en vivo con país, página,
    navegador, referer, región y caché, igual que las de un servidor.
  - **Supabase**: cada proyecto es una torre de base de datos con CPU, memoria, disco, conexiones
    del pooler y reinicios de Postgres (Metrics API); con el token de gestión, además, si está
    pausado o iniciando.
  - Estado de cada conector en el panel de la Torre de control.
- **Claude Code remoto**: los agentes que corren en la laptop de un programador aparecen en su
  propio distrito ("Equipo …"), por hooks HTTPS con un token por equipo.
  `node cli.js remote add <equipo>` imprime el comando de instalación para esa computadora; se
  quita con `--uninstall` y se revoca con `node cli.js remote del <equipo>`.
- CLI: `node cli.js connector add vercel|supabase`, `connector list`, `connector del`. Los
  secretos se piden ocultos y se guardan en `/var/lib/atalaya/connectors.json` (600); nunca en
  `config.json` ni en el navegador.
- `config.json > publicUrl`: la dirección pública de Atalaya (la usa el CLI para armar las URLs
  de Drains e instalación remota; el instalador la pregunta).
- Pruebas: `node test/cloud.test.js` (APIs de Vercel y Supabase simuladas, Drains firmados y hooks
  remotos).

### Seguridad
- El receptor de Drains verifica la firma HMAC-SHA1 (`x-vercel-signature`) en tiempo constante;
  el de hooks remotos exige el token del equipo (solo se guarda su sha256).

## [0.7.1] - 2026-09-25

### Añadido
- La **versión aparece junto al nombre** de Atalaya; al tocarla se abren las **Novedades** de
  cada versión (este mismo registro). Después de una actualización se muestran solas una vez.

### Corregido
- Las pantallas que quedan abiertas (por ejemplo en un TV) se **actualizan solas**: cuando el
  servidor arranca con otra versión, avisan y se recargan. Antes seguían mostrando la versión
  vieja hasta recargar a mano.
- Los archivos de la interfaz se sirven con `ETag`: el navegador nunca usa una copia vieja.
- Las librerías y fuentes ya no se marcan como inmutables, para que una actualización de ellas
  también llegue.

## [0.7.0] - 2026-09-25

### Añadido
- **Servicios de systemd** como edificios: las unidades de aplicación creadas por el
  administrador (Node, Python, PHP, Java, Go… o programas en `/opt`, `/home`, `/srv`, `/var/www`)
  van a la cuenta de su `User=` o al distrito "Servicios del sistema". CPU y memoria desde el
  cgroup de la unidad (todos sus procesos), reinicios y caídas. `config.json > services.include`
  y `services.exclude` ajustan qué unidades se muestran.
- **Contenedores Docker o Podman** como edificios del distrito "Contenedores": imagen, estado,
  proyecto y servicio de compose, puertos publicados, CPU y memoria del cgroup, reinicios y
  caídas. Un sitio cuyo proxy apunta al puerto de un contenedor queda asociado a él.
- **Servicios clave** del servidor (servidor web, base de datos, Redis, correo, SSH, cron,
  fail2ban, paneles, DNS…) en la Torre de control: tablero de estado en su panel, la leyenda bajo
  la torre sale de lo que realmente corre, y si uno **falla** la torre parpadea en rojo y lo
  anuncia en la cinta.
- Clasificación automática por imagen o nombre: base de datos, caché, proxy web, monitoreo,
  almacenamiento, colas; íconos nuevos de base de datos, caché y contenedor.
- Pruebas: `node test/sources.test.js` (systemd y una API de Docker simulada).

## [0.6.0] - 2026-09-25

### Añadido
- **Instalable en cualquier servidor**: detección automática de cPanel/WHM, Plesk, DirectAdmin,
  CyberPanel o servidores sin panel (sitios leídos de la configuración de Nginx y Apache). Cada
  plataforma aporta sus cuentas, sitios, dominios, carpetas y logs de visitas.
- Seguridad y correo según lo que haya: `auth.log` o `secure`, cPHulk, fail2ban, CSF/LFD, Exim o
  Postfix.
- Base de países: la de Imunify360, una GeoLite2 local o DB-IP Lite descargada por el instalador.
- **Instalador** `sudo ./install.sh`: detecta, genera `config.json`, crea el servicio, ofrece
  hooks, crea el primer usuario y muestra cómo publicarlo; se puede volver a ejecutar para
  actualizar. Ejemplos de proxy para Nginx, Apache, cPanel, Plesk, DirectAdmin y OpenLiteSpeed.
- Diagnóstico: `node server/platform`.
- Pruebas: `node test/platforms.test.js` (servidores simulados) y `node test/parsers.test.js`.

### Cambiado
- Las rutas de logs (`logs.*` en `config.json`) ya no son necesarias: se detectan. Siguen
  sirviendo para forzar una ruta. `platform.panel` permite forzar el panel.

## [0.5.1] - 2026-09-25

### Corregido
- Rediseño del diálogo de modo privado: títulos "Su PIN" y "Duración", duraciones en una
  línea ("Sin límite" en vez de "Hasta bloquear"), sin hueco vacío, botón en el color ámbar
  del modo privado e ícono de candado propio.
- El acceso desde el celular ya no se sale de la pantalla: las casillas del PIN se adaptan a
  cualquier ancho.
- Los mensajes de error ya no reservan espacio cuando no hay error.

## [0.5.0] - 2026-09-25

### Añadido
- **Cuentas autodetectadas**: se leen de cPanel (o, sin panel, de los usuarios con PM2, Claude
  o `public_html`). Cada cuenta nueva recibe nombre público y color que quedan guardados en
  `/var/lib/atalaya/accounts.json`; `config.json > accounts` pasa a ser solo un ajuste opcional.
- **Detección de cambios en caliente**: cada 15 s se revisa si cambió algo en cPanel; los
  dominios y subdominios nuevos, eliminados o que cambian de tipo (ej. de "en construcción" a
  WordPress) y las cuentas nuevas o eliminadas aparecen como avisos en la cinta y en el mapa, y
  quedan en "Cambios recientes" del distrito.
- Sitios en el mapa: los que Apache sirve directo (WordPress, PHP, estáticos, proxies) son
  edificios bajos con el ícono de su tipo y reciben sus visitas.
- Bajo cada distrito, la cuenta cPanel y su dominio principal (modo privado).
- Número de versión visible en el menú.
- Fuente de banderas para que los países se vean también en Windows.
- Catálogo de sitios por cuenta: cada carpeta publicada (docroot) con sus dominios y alias,
  clasificada como app de PM2, proxy, WordPress (con versión), PHP, estático o en construcción.
- Dominio principal y cuenta cPanel de cada distrito (modo privado).
- País de cada visita (con bandera) usando la base GeoLite2 que mantiene Imunify360 (lector MMDB propio, sin
  dependencias), navegador, sistema operativo, bots por familia (buscadores, IA, SEO, redes,
  monitores, scripts) y referer.
- Estadísticas de la última hora por servicio y sitio: países, navegadores, bots, páginas,
  referers, dominios y códigos de respuesta.
- País del atacante en los eventos de seguridad.

### Corregido
- Una app de PM2 que corre desde el home de la cuenta (ej. n8n) ya no absorbe todos los
  dominios de esa cuenta.

## [0.4.0] - 2026-09-25

### Seguridad
- El límite de intentos de acceso por IP usa el último salto de `X-Forwarded-For` (el que
  agrega el proxy); antes se podía falsear. La verificación del PIN es asíncrona.
- Hooks autenticados con un token por cuenta (`~/.claude/atalaya-hook.header`, permisos 600);
  una cuenta solo puede reportar sus propias sesiones.
- Los transcripts solo se leen si son archivos normales del dueño correcto (sin seguir
  enlaces simbólicos).
- `sessions revoke` funciona en caliente; cambiar el PIN cierra las sesiones abiertas; el rol
  se relee siempre (bajar a viewer quita el modo privado al instante).
- En modo público el detalle solo acepta alias: no se pueden sondear nombres de cuenta.
- Nombres de usuario reservados (`__proto__`, `constructor`…) rechazados.

### Añadido
- `node cli.js user role <nombre> owner|viewer`.

### Corregido
- Sesiones retiradas por inactividad y subagentes terminados ya no reaparecen.
- El correo saliente por `dkim_remote_smtp` se cuenta como enviado.
- Un intento SSH contra un usuario inexistente ya no se cuenta dos veces.

### Requiere acción
- Reinstalar los hooks (`node hooks/install.js`) para generar los tokens por cuenta.
- Las sesiones abiertas antes de esta versión deben volver a entrar.

## [0.3.0] - 2026-09-25

### Añadido
- Mapa navegable: arrastrar, zoom con rueda o pellizco, doble clic para la vista general;
  el director se pausa mientras se navega.
- Panel de detalle al hacer clic en servicios, agentes, distritos, la torre, la defensa, el
  correo y los eventos de la cinta (`/api/detail`, filtrado por modo).
- Historial por entidad: CPU y memoria, visitas, últimas peticiones, reinicios y línea de
  tiempo de cada agente.
- Fichas flotantes que explican cada elemento y leyenda completa (tecla `?`).
- README, configuración de ejemplo, unidad de systemd y licencias de terceros.

### Corregido
- Los clics sobre objetos del mapa no llegaban por la configuración de eventos de PixiJS 8.
- En modo público también viajan como alias los identificadores de cuenta.

## [0.2.1] - 2026-09-25

### Corregido
- Un hook atrasado ya no resucita una sesión cerrada.
- Las esperas de permiso se asocian a su herramienta; terminar otra no las borra.
- Detección de Bash aprobado por el comando en ejecución; `PermissionDenied` libera la espera.
- Una sesión que espera al usuario no pasa a "En pausa".
- Si el puerto de hooks falla, el tablero sigue funcionando.

## [0.2.0] - 2026-09-25

### Añadido
- Hooks de Claude Code: permisos pendientes, preguntas, inicio y cierre de sesión y
  subagentes al instante; instalador que fusiona la configuración con respaldo.
- Catálogo de servicios con etiqueta e ícono por app, visible en modo público.
- Modo director: la cámara recorre los distritos y enfoca al agente que pide permiso.

## [0.1.0] - 2026-09-25

### Añadido
- Primera versión: recolector de solo lectura (sistema, PM2, Claude Code, Apache, SSH,
  cPHulk, Exim), mundo isométrico en PixiJS, HUD con uPlot y anime.js, acceso con usuario y
  PIN de 6 dígitos y modo público/privado aplicado en el servidor.

[Sin publicar]: https://github.com/neracosu/atalaya-monitor/compare/v0.84.0...HEAD
[0.84.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.83.1...v0.84.0
[0.83.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.83.0...v0.83.1
[0.83.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.82.0...v0.83.0
[0.82.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.81.4...v0.82.0
[0.81.4]: https://github.com/neracosu/atalaya-monitor/compare/v0.81.3...v0.81.4
[0.81.3]: https://github.com/neracosu/atalaya-monitor/compare/v0.81.2...v0.81.3
[0.81.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.81.1...v0.81.2
[0.81.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.81.0...v0.81.1
[0.81.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.80.2...v0.81.0
[0.80.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.80.1...v0.80.2
[0.80.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.80.0...v0.80.1
[0.80.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.79.1...v0.80.0
[0.79.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.79.0...v0.79.1
[0.79.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.78.0...v0.79.0
[0.78.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.77.1...v0.78.0
[0.77.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.77.0...v0.77.1
[0.77.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.76.0...v0.77.0
[0.76.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.75.0...v0.76.0
[0.75.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.74.0...v0.75.0
[0.74.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.73.0...v0.74.0
[0.73.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.72.0...v0.73.0
[0.72.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.71.0...v0.72.0
[0.71.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.70.0...v0.71.0
[0.70.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.69.0...v0.70.0
[0.69.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.68.0...v0.69.0
[0.68.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.67.0...v0.68.0
[0.67.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.66.0...v0.67.0
[0.66.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.65.1...v0.66.0
[0.65.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.65.0...v0.65.1
[0.65.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.64.1...v0.65.0
[0.64.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.64.0...v0.64.1
[0.64.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.63.1...v0.64.0
[0.63.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.63.0...v0.63.1
[0.63.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.62.1...v0.63.0
[0.62.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.62.0...v0.62.1
[0.62.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.61.1...v0.62.0
[0.61.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.61.0...v0.61.1
[0.61.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.60.0...v0.61.0
[0.60.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.59.1...v0.60.0
[0.59.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.59.0...v0.59.1
[0.59.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.58.1...v0.59.0
[0.58.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.58.0...v0.58.1
[0.58.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.57.0...v0.58.0
[0.57.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.56.0...v0.57.0
[0.56.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.55.0...v0.56.0
[0.55.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.54.0...v0.55.0
[0.54.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.53.0...v0.54.0
[0.53.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.52.0...v0.53.0
[0.52.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.51.0...v0.52.0
[0.51.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.50.0...v0.51.0
[0.50.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.49.1...v0.50.0
[0.49.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.49.0...v0.49.1
[0.49.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.48.0...v0.49.0
[0.48.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.47.3...v0.48.0
[0.47.3]: https://github.com/neracosu/atalaya-monitor/compare/v0.47.2...v0.47.3
[0.47.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.47.1...v0.47.2
[0.47.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.47.0...v0.47.1
[0.47.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.45.1...v0.46.0
[0.45.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.45.0...v0.45.1
[0.45.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.42.1...v0.43.0
[0.42.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.42.0...v0.42.1
[0.42.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.39.0...v0.40.0
[0.39.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.37.1...v0.38.0
[0.37.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.37.0...v0.37.1
[0.37.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.36.2...v0.37.0
[0.36.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.36.1...v0.36.2
[0.36.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.36.0...v0.36.1
[0.36.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.35.0...v0.36.0
[0.35.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.34.2...v0.35.0
[0.34.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.34.1...v0.34.2
[0.34.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.34.0...v0.34.1
[0.34.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.32.2...v0.33.0
[0.32.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.32.1...v0.32.2
[0.32.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.32.0...v0.32.1
[0.32.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.30.3...v0.31.0
[0.30.3]: https://github.com/neracosu/atalaya-monitor/compare/v0.30.2...v0.30.3
[0.30.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.30.1...v0.30.2
[0.30.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.30.0...v0.30.1
[0.30.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.27.1...v0.28.0
[0.27.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.27.0...v0.27.1
[0.27.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.26.1...v0.27.0
[0.26.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.26.0...v0.26.1
[0.26.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.24.2...v0.25.0
[0.24.2]: https://github.com/neracosu/atalaya-monitor/compare/v0.24.1...v0.24.2
[0.24.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/neracosu/atalaya-monitor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/neracosu/atalaya-monitor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/neracosu/atalaya-monitor/releases/tag/v0.1.0
