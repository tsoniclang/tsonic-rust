#!/usr/bin/env bash
# Packages the target-owned runtime crates into runtimes/crates/ as the
# committed artifacts shipped with the @tsonic/target-rust npm package.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

package_crate() {
  local source_dir="$1"
  local packaged_dir="$2"
  mkdir -p "$packaged_dir"
  rsync -a --delete --exclude "target/" --exclude ".temp/" "$source_dir/" "$packaged_dir/"
  # Lib-only dependency: strip repo-relative [[test]] target sections.
  awk '
    /^\[\[test\]\]$/ { skip = 1; next }
    /^\[/ && !/^\[\[test\]\]$/ { skip = 0 }
    !skip { print }
  ' "$packaged_dir/Cargo.toml" | cat -s > "$packaged_dir/Cargo.toml.tmp"
  mv "$packaged_dir/Cargo.toml.tmp" "$packaged_dir/Cargo.toml"
  # Standalone package: opt out of any enclosing consumer workspace.
  if ! grep -q "^\[workspace\]" "$packaged_dir/Cargo.toml"; then
    printf "\n[workspace]\n" >> "$packaged_dir/Cargo.toml"
  fi
}

package_crate "$repo_root/../rust-runtime/crates/tsonic_rust_runtime" "$repo_root/runtimes/crates/tsonic_rust_runtime"
package_crate "$repo_root/../rust-js/crates/tsonic_rust_js" "$repo_root/runtimes/crates/tsonic_rust_js"

# Intra-package closure: the packaged js crate depends on the packaged
# runtime crate next to it.
sed -i 's#tsonic_rust_runtime = { path = "../../../rust-runtime/crates/tsonic_rust_runtime" }#tsonic_rust_runtime = { path = "../tsonic_rust_runtime" }#' \
  "$repo_root/runtimes/crates/tsonic_rust_js/Cargo.toml"
