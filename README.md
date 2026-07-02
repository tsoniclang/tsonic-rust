# tsonic-rust

Rust target pack for Tsonic (`@tsonic/target-rust`).

This package owns the TypeScript-side Rust target implementation: target
descriptor, Rust target options, target-semantics extension (carrier,
operator, ownership, and provider facts), generic provider-package
infrastructure, backend planning/printing, Cargo project generation, and
Cargo toolchain integration. The backend is fail-closed: constructs without
finalized lowering facts produce deterministic diagnostics, never guessed
Rust source.

Runtime crates are intentionally split into sibling repositories, matching
the C# package layout:

- `rust-runtime` / `tsonic_rust_runtime`
- `rust-js` / `tsonic_rust_js`
- `rust-nodejs` / `tsonic_rust_node`

This repository must not own JS/Node runtime surface implementations.

## Supported lanes

Static-native spine: source-core primitive carriers, functions, locals,
constants (UPPER_SNAKE), returns, blocks, if/else, while and classic for
loops, fact-backed arithmetic/comparison/boolean/string-concat operators,
compound assignments, module imports/exports.

Native semantics: classes to struct + impl (constructor lane, methods with
fact-selected `&self`/`&mut self`, static methods as associated functions),
enums with TSTS-evaluated discriminants, interfaces as record structs with
contextual object literals, closed string-literal union aliases as
unit-variant enums, tuples with constant indexing, `readonly T[]` as `&[T]`
and mutable array parameters as `&mut [T]`, null-only unions as `Option<T>`
with `??` coalescing, passthrough generic functions, source-core
`borrow`/`borrowMut`/`move` flow markers validated against finalized
argument modes, async/await with await-only future discipline, and a
deterministic snake_case naming policy with collision diagnostics.

JS surface (selected surface or compat mode): dense `Vec<T>` and sparse
`JsArray<T>` lanes, string operations, Map/Set with SameValueZero runtime
semantics, Date (UTC carrier), and `T | undefined` Option lanes.

Provider packages: identity-keyed operation rows over virtual declarations
(calls, constructors, properties, indexers, operators via std::ops
metadata, async rows), cargo dependency contribution, and fail-closed
diagnostics for unsupported members. Node.js ships as a provider package
(`node:path`, `node:os` mapped; `node:fs`/`process`/`url`/`buffer`/
`crypto`/`util` declared and classified as unsupported pending the shared
error model).

## Explicitly unsupported (fail-closed, classified)

Deferred pending shared cross-target contracts: the error model
(throw/try-catch/Result, fallible runtime APIs such as `fs` and JSON), the
string owned/borrowed ABI policy (strings are owned `String` today),
discriminated object unions (narrowing facts), callback iteration (function
pointer lanes), fixed-size `[T; N]` arrays (length facts), and RegExp
(unclaimed until the supported subset matches the shared Node/V8 oracle
contract). Every deferred lane diagnoses deterministically; see
`test/capability-ledger.test.mjs`.

## Build and test

```sh
npm install
npm test
```

The build requires the sibling `tsonic` repository's packages to be
prebuilt (`@tsonic/target-api`, `@tsonic/tsts`, `@tsonic/source-core`); it
never builds or writes into the `tsonic` repository itself. Tests include
generated Cargo projects under `.temp/generated/` validated with
`cargo fmt --check`, `check --locked`, `clippy -D warnings`, `test`, and
`run` for binaries.

## Authoring provider packages

Use `createRustProviderPackage`: declare virtual modules
(`ProviderExportDeclaration` models), identity-keyed operation rows
(`exportId`/`memberId`/`signatureId`/`receiverTypeId` plus a Rust operation
form), and cargo crate contributions. Concrete names live only in row data;
the generic matcher contains no per-name branching. See
`src/source/provider-packages/nodejs.ts` and the `@acme/*` fixtures under
`test/helpers/rust-session.mjs`.
