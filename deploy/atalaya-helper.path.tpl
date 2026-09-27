[Unit]
Description=Atalaya - ayudante: vigila pedidos del asistente web

[Path]
PathExistsGlob={{STATE}}/requests/*.json
Unit=atalaya-helper.service

[Install]
WantedBy=multi-user.target
