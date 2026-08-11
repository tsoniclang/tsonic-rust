#!/usr/bin/env bash
set -euo pipefail

test_concurrency="$1"
shift

npm run build
node -e "import('./test/helpers/rust-session.mjs').then(m => m.buildInstalledLayout())"
exec node \
  --test \
  --test-concurrency="${test_concurrency}" \
  "$@"
