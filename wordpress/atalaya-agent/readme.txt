=== Atalaya Monitor Server · Agente ===
Contributors: neracosu
Tags: monitor, seguridad, actualizaciones, estado, atalaya
Requires at least: 5.6
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.1.0
License: Propietaria

Envía a su pantalla de Atalaya el estado de este WordPress. Solo lee y envía.

== Description ==

Atalaya es un monitor visual en tiempo real para servidores, hostings y proyectos. Este plugin
conecta un sitio WordPress con su pantalla de Atalaya, sin terminal ni cron.

Qué envía (cada minuto lo nuevo, cada 10 minutos el resumen):

* Versión de WordPress y si hay una nueva; plugins y temas (activos, inactivos y con actualización pendiente).
* Versión de PHP y de la base de datos, tamaño de la base y peso de las opciones que se cargan en cada visita.
* Seguridad básica: errores visibles a los visitantes (WP_DEBUG_DISPLAY), debug.log descargable,
  editor de archivos activo, usuario "admin", registro abierto y su rol, XML-RPC, HTTPS.
* WP-Cron atrasado.
* Líneas nuevas de debug.log y error_log (los secretos evidentes se tapan en Atalaya).
* Visitas del sitio si el hosting deja leer sus logs (cPanel: ~/access-logs).

Qué NO hace:

* No agrega rutas REST, ni acciones AJAX públicas, ni shortcodes: no suma nada que se pueda atacar desde afuera.
* No cambia ni borra nada del sitio. Nunca envía contraseñas ni valores de wp-config.php.

== Installation ==

1. En su Atalaya: menú ⋮ › Conectar un hosting compartido › pestaña WordPress › Descargar plugin.
2. En WordPress: Plugins › Añadir nuevo › Subir plugin, elija el .zip y actívelo. Se conecta solo.

Sin el .zip personalizado: instale el plugin, vaya a Ajustes › Atalaya y pegue la dirección y el código.

== Changelog ==

= 1.1.0 =
* El formulario de Ajustes › Atalaya ya trae la dirección de su Atalaya, y el código si el .zip vino configurado.
* Si no logra conectarse solo al activarse, dice por qué.
* Instrucciones corregidas para encontrar el código.

= 1.0.0 =
* Primera versión.
