#!/bin/zsh
# Fast strict type-check of the named files (the full gate is `npm run check`).
cd /Volumes/OBOSLab/worktrees/aqi-new-cities
taskpolicy -b npx tsc --ignoreConfig --noEmit --strict --allowImportingTsExtensions --skipLibCheck --target es2023 --lib es2023,dom --module esnext --moduleResolution bundler --types node "$@"
