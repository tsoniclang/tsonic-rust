# tsonic-rust
Rust backend for Tsonic

## Naming convention

- Workspace crate package names intentionally use underscore identifiers (`tsonic_runtime`, `tsonic_js`, `tsonic_node`) so
  package names align with the architecture spec and avoid hidden `package =` alias mapping in manifests.

## Stage 1 surface contract

- `tests/capabilities/stage1_inventory.tsv` is the committed JS/Node surface ledger.
- The ledger classifies every tracked surface row as `implemented` or `hard-reject`; no deferred rows are allowed.
- `tests/capability_ledger_tests.rs` gates API evidence, dead nested tests, dependency policy, and explicit unsupported classifications.
