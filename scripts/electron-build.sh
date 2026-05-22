#!/usr/bin/env bash
set -euo pipefail

npm run build

electron-packager . Leyline \
  --out release \
  --overwrite \
  --prune=true \
  --icon assets/icon \
  --asar.unpack='**/{*.node,spawn-helper}' \
  --ignore='^/(screenshots|src|scripts)(/|$)' \
  --ignore='^/vite.config.js$'
