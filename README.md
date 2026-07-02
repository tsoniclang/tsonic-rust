# tsonic-rust

Rust target pack for Tsonic (`@tsonic/target-rust`).

This package owns the TypeScript-side Rust target implementation: target
descriptor, Rust target options, target-semantics extension (carrier and
operator facts), generic provider-package infrastructure, backend
planning/printing, Cargo project generation, and Cargo toolchain integration.
The backend is fail-closed: constructs without finalized lowering facts
produce deterministic diagnostics, never guessed Rust source.

Current capability (slice R2): static-native spine — primitive carriers from
source-core facts, functions, locals, constants, returns, if/else, while and
classic for loops, fact-backed arithmetic/comparison/boolean/string-concat
operators, module imports/exports, and fake `@acme/*` provider packages
(calls, constructors, static/instance properties, indexers) proven end to end
through generated Cargo projects that build and run under
`cargo fmt/check/test/run`.

Runtime crates are intentionally split into sibling repositories, matching the
C# package layout:

- `rust-runtime` / `tsonic_rust_runtime`
- `rust-js` / `tsonic_rust_js`
- `rust-nodejs` / `tsonic_rust_node`

This repository must not own JS/Node runtime surface implementations.

## Build and test

```sh
npm install
npm test
```

The build requires the sibling `tsonic` repository's packages to be prebuilt
(`@tsonic/target-api`, `@tsonic/tsts`); it never builds or writes into the
`tsonic` repository itself.
