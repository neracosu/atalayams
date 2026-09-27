# Cómo contribuir a Atalaya Monitor Server

Gracias por querer sumar. Atalaya es un monitor **de solo lectura**: esa promesa manda sobre cualquier
función nueva.

## Antes de escribir código

- Abra un *issue* contando qué quiere resolver y por qué. Así evitamos trabajo que no pueda entrar.
- Los temas nuevos son bienvenidos sin avisar: vea [docs/TEMAS.md](docs/TEMAS.md) y el kit de temas.

## Reglas del proyecto

1. **Solo lectura.** Atalaya no reinicia, no borra, no escribe en los sitios ni se conecta a las bases de
   datos. Lo pesado corre solo cuando la persona lo pide. Si una idea necesita cambiar algo en el
   servidor, no va en Atalaya.
2. **Privacidad en el servidor.** Todo dato nuevo pasa por `server/privacy.js`: en modo público no salen
   nombres, dominios, rutas, IPs, comandos ni textos de los agentes.
3. **Sin dependencias en el servidor.** Node 20+ y sus módulos propios. En el navegador, lo que ya está en
   `web/vendor`.
4. **Nada depende de una IA** para funcionar.
5. **Sin emojis** en la interfaz ni en la documentación: íconos en pixel art (`web/js/pixeldata.js`).
6. **Rutas relativas** en la interfaz y en los temas (`../../js/...`): Atalaya también vive bajo un prefijo.
7. **Español** en la interfaz, en tono de «usted». Comentarios de código sin acentos.
8. **Pruebas.** `npm test` tiene que pasar. Cada corrección trae la prueba que la habría detectado.

## Detecciones y guías

Lo que Atalaya reconoce (familias de sondeos web, motivos de rebote) y el texto de «cómo arreglarlo»
viven en `defs/definiciones.json`. Si encuentra un patrón nuevo o un arreglo mejor, proponga el cambio ahí
con un ejemplo real (sin datos de nadie). Las definiciones publicadas se firman y llegan solas a todas las
instalaciones.

## Enviar el cambio

1. Una rama por cambio, commits en español que digan qué cambia y por qué.
2. `npm test` en verde.
3. Una entrada en `CHANGELOG.md`, sección «Sin publicar».

Al contribuir, acepta que su aporte se publique bajo la licencia del proyecto (AGPL-3.0).
