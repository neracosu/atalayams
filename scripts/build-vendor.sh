#!/bin/sh
# Reconstruye web/vendor desde npm (PixiJS con el shim de unsafe-eval para CSP estricta).
set -e
cd "$(dirname "$0")/../vendor-src"
npm install --no-audit --no-fund
npx esbuild pixi-entry.mjs --bundle --format=esm --minify --outfile=../web/vendor/pixi.csp.mjs
cp node_modules/animejs/dist/bundles/anime.esm.min.js ../web/vendor/
cp node_modules/uplot/dist/uPlot.esm.js node_modules/uplot/dist/uPlot.min.css ../web/vendor/
echo "web/vendor actualizado"
