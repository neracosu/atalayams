[Unit]
Description=Atalaya - ayudante (acciones permitidas del asistente: hooks y publicacion en cPanel)

[Service]
Type=oneshot
ExecStart={{NODE}} {{DIR}}/server/helper.js
WorkingDirectory={{DIR}}
TimeoutStartSec=300
NoNewPrivileges=yes
PrivateTmp=yes
