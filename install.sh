#!/bin/sh
# Instala o actualiza Atalaya en este servidor. Uso: sudo ./install.sh [--yes] [--no-hooks] [--no-geo] [--user=<nombre>]
set -e
cd "$(dirname "$0")"

if [ "$(id -u)" != "0" ]; then echo "Ejecute como root: sudo ./install.sh"; exit 1; fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Atalaya necesita Node.js 20 o superior y no se encontró 'node'."
  echo "  Debian/Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
  echo "  Alma/Rocky/RHEL: curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && dnf install -y nodejs"
  exit 1
fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then echo "Node.js $("$NODE" -v) es muy viejo: se necesita 20 o superior."; exit 1; fi
if ! command -v systemctl >/dev/null 2>&1; then echo "Se necesita systemd."; exit 1; fi

ATALAYA_NODE="$NODE" exec "$NODE" scripts/setup.js "$@"
