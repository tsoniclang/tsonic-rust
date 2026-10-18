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

loader_registration="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/register-tsonic-root-loader.mjs"
selection=()
for file in "${test_arguments[@]}"; do
  selection+=(--file "$file")
done
exec node \
  --import "$loader_registration" \
  "${TSONIC_ROOT:-../tsonic}/test/scripts/run-parallel.mjs" \
  --scope tsonic-rust \
  --repository-root "$PWD" \
  --with-preruns \
  "${selection[@]}"
