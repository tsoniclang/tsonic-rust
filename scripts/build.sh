#!/usr/bin/env bash
set -euo pipefail

# The tsonic repository is read-only from Rust target work. This build never
# writes into it: it requires the @tsonic packages to be prebuilt and points
# type resolution at their existing dist declaration outputs.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSONIC_ROOT="$(cd "$REPO_ROOT/../tsonic" && pwd -P)"

required_dist_outputs=(
  "packages/target-api/dist/index.d.ts"
  "packages/tsts/dist/src/index.d.ts"
)

for output in "${required_dist_outputs[@]}"; do
  if [[ ! -f "$TSONIC_ROOT/$output" ]]; then
    echo "FAIL: missing prebuilt output $TSONIC_ROOT/$output" >&2
    echo "Build the tsonic packages first (tsonic is not built from tsonic-rust)." >&2
    exit 1
  fi
done

mkdir -p "$REPO_ROOT/.temp/build"
CANONICAL_TSCONFIG="$REPO_ROOT/.temp/build/tsconfig.canonical-tsonic.json"
cat > "$CANONICAL_TSCONFIG" <<EOF
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@tsonic/tsts": ["$TSONIC_ROOT/packages/tsts/dist/src/index.d.ts"],
      "@tsonic/target-api": ["$TSONIC_ROOT/packages/target-api/dist/index.d.ts"]
    }
  }
}
EOF

"$TSONIC_ROOT/scripts/build/tsgo-project.sh" "$CANONICAL_TSCONFIG" --pretty false
