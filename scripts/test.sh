#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if (( $# == 0 )); then
  mapfile -d '' -t test_arguments < <(find test -type f -name '*.test.mjs' -print0 | sort -z)
else
  test_arguments=("$@")
fi
if (( ${#test_arguments[@]} == 0 )); then
  printf 'No Rust test files were discovered.\n' >&2
  exit 2
fi
exec bash "${TSONIC_ROOT:-../tsonic}/test/scripts/bounded-run.sh" rust bash scripts/test-worker.sh "${test_arguments[@]}"
