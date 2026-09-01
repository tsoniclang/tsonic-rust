#!/usr/bin/env bash
set -euo pipefail

test_concurrency="$1"
shift

npm run build
loader_registration="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/register-tsonic-root-loader.mjs"
node --import "$loader_registration" \
  -e "import('./test/helpers/rust-session.mjs').then(m => m.buildInstalledLayout())"
exec node \
  --import "$loader_registration" \
  --test \
  --test-concurrency="${test_concurrency}" \
  "$@"
