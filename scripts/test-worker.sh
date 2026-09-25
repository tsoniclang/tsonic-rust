#!/usr/bin/env bash
set -euo pipefail

if (( $# == 0 )); then
  mapfile -d '' -t test_arguments < <(node "${TSONIC_ROOT:-../tsonic}/test/scripts/node-test-files.mjs" test)
else
  test_arguments=("$@")
fi
if (( ${#test_arguments[@]} == 0 )); then
  printf 'No Rust test files were discovered.\n' >&2
  exit 2
fi

npm run build
loader_registration="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/register-tsonic-root-loader.mjs"
node --import "$loader_registration" \
  -e "import('./test/helpers/rust-session.mjs').then(m => m.buildInstalledLayout())"
exec node "${TSONIC_ROOT:-../tsonic}/scripts/certification/capture-tests.mjs" node node \
  --import "$loader_registration" \
  --test \
  --test-reporter=tap \
  --test-concurrency="${TSONIC_TEST_WORKERS}" \
  "${test_arguments[@]}"
