#!/usr/bin/env bash
set -euo pipefail

# The tsonic repository is read-only from Rust target work. This build never
# writes into it: it requires the @tsonic packages to be prebuilt and points
# type resolution at their existing dist declaration outputs.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
configured_tsonic_root="${TSONIC_ROOT:-$REPO_ROOT/../tsonic}"
if [[ "$configured_tsonic_root" != /* ]]; then
  configured_tsonic_root="$REPO_ROOT/$configured_tsonic_root"
fi
if [[ ! -d "$configured_tsonic_root" ]]; then
  echo "FAIL: TSONIC_ROOT is not a directory: $configured_tsonic_root" >&2
  exit 2
fi
TSONIC_ROOT="$(cd "$configured_tsonic_root" && pwd -P)"
export TSONIC_ROOT

required_dist_outputs=(
  "packages/source-core/dist/public/index.d.ts"
  "packages/source-core/dist/public/extension.d.ts"
  "packages/source-core/dist/public/facts.d.ts"
  "packages/js-source-profile/dist/index.d.ts"
  "packages/target-api/dist/public/index.d.ts"
  "packages/target-api/dist/public/artifacts.d.ts"
  "packages/target-api/dist/public/provider.d.ts"
  "packages/target-api/dist/public/source.d.ts"
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
node "$REPO_ROOT/scripts/clean-dist.mjs"
CANONICAL_TSCONFIG="$REPO_ROOT/.temp/build/tsconfig.canonical-tsonic.json"
cat > "$CANONICAL_TSCONFIG" <<EOF
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "typeRoots": ["$TSONIC_ROOT/node_modules/@types"],
    "paths": {
      "@tsonic/tsts": ["$TSONIC_ROOT/packages/tsts/dist/src/index.d.ts"],
      "@tsonic/js-source-profile": ["$TSONIC_ROOT/packages/js-source-profile/dist/index.d.ts"],
      "@tsonic/target-api": ["$TSONIC_ROOT/packages/target-api/dist/public/index.d.ts"],
      "@tsonic/target-api/*": ["$TSONIC_ROOT/packages/target-api/dist/public/*.d.ts"],
      "@tsonic/source-core": ["$TSONIC_ROOT/packages/source-core/dist/public/index.d.ts"],
      "@tsonic/source-core/*": ["$TSONIC_ROOT/packages/source-core/dist/public/*.d.ts"]
    }
  }
}
EOF

"$TSONIC_ROOT/scripts/build/tsgo-project.sh" "$CANONICAL_TSCONFIG" --pretty false
