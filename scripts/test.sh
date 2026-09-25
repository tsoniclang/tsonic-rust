#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if (( $# == 0 )); then
  exec node "${TSONIC_ROOT:-../tsonic}/scripts/certification/run.mjs" tsonic-rust
fi
exec bash "${TSONIC_ROOT:-../tsonic}/test/scripts/bounded-run.sh" rust bash scripts/test-worker.sh "$@"
