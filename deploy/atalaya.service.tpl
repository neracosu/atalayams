[Unit]
Description=Atalaya - monitor visual del servidor (solo lectura)
After=network.target

[Service]
Type=simple
ExecStart={{NODE}} {{DIR}}/server/index.js
WorkingDirectory={{DIR}}
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Nice=10
MemoryMax=512M
# Solo lectura del sistema: unica capacidad = leer cualquier archivo
CapabilityBoundingSet=CAP_DAC_READ_SEARCH
AmbientCapabilities=CAP_DAC_READ_SEARCH
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={{STATE}}
StateDirectory=atalaya
StateDirectoryMode=0700
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
