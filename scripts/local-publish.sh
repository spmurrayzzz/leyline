#!/bin/bash
npm run electron:build
rsync -a ./release/Leyline-darwin-arm64/Leyline.app /Applications/
