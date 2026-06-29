# tsonic-rust
Rust backend/provider shell for Tsonic.

Runtime crates are intentionally split into sibling repositories, matching the
C# package layout:

- `rust-runtime` / `tsonic_rust_runtime`
- `rust-js` / `tsonic_rust_js`
- `rust-nodejs` / `tsonic_rust_node`

This repository should not own JS/Node runtime surface implementations.
