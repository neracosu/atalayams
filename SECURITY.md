# Seguridad

Atalaya lee servidores con permisos altos, así que un fallo de seguridad importa más que en otros
proyectos. Si encuentra uno, **no lo publique en un issue**.

## Cómo reportarlo

- En GitHub: pestaña **Security › Report a vulnerability** de este repositorio (queda privado).
- O por el contacto de [neracosu.com](https://neracosu.com).

Incluya qué versión usa, cómo reproducirlo y qué podría hacer alguien con la falla. Respondemos en unos
días; cuando esté corregido, lo anotamos en el CHANGELOG y le damos el crédito si lo desea.

## Qué nos interesa especialmente

- Cualquier forma de que Atalaya **cambie** algo en el servidor (debería ser imposible).
- Datos que salen en **modo público** y no deberían (nombres, dominios, rutas, IPs, comandos).
- Acceso sin PIN, sesiones que no se cierran, o saltarse el modo privado.
- En Atalaya Cloud: que una pantalla vea algo de otra o de la máquina que las aloja.
- Definiciones: aceptar un paquete sin firma válida.
