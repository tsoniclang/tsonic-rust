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
argument modes, async/await with await-only future discipline, a
deterministic snake_case naming policy with collision diagnostics, and the
error model: throwing functions lower to TsonicResult with transitive
fallibility, `throw new Error(message)` becomes an Err return, try/catch
lowers to a Result closure boundary, and fallible calls propagate with `?`
(closures are fallibility boundaries).

JS surface (selected surface or compat mode): dense `Vec<T>` and sparse
`JsArray<T>` lanes with callback iteration (map/filter/reduce/some/every as
Rust closures), string operations, Map/Set with SameValueZero runtime
semantics, Date (UTC carrier), JSON parse/stringify through fallible rows,
and `T | undefined` Option lanes.

Provider packages: identity-keyed operation rows over virtual declarations
(calls, constructors, properties, indexers, operators via std::ops
metadata, async rows), cargo dependency contribution, and fail-closed
diagnostics for unsupported members. Node.js ships as a provider package
(`node:path`, `node:os`, and `node:fs` readFileSync mapped — fallible rows
ride the error model; the remaining `node:fs`/`process`/`url`/`buffer`/
`crypto`/`util` members are declared and classified as unsupported rows).

## Explicitly unsupported (fail-closed, classified)

Each unsupported lane requires a contract that does not exist: the string
owned/borrowed ABI policy (strings are owned `String`), discriminated
object unions (narrowing facts), fixed-size `[T; N]` arrays (length
facts), and RegExp (unclaimed: the supported runtime subset does not match
the shared Node/V8 oracle contract). Every unsupported lane diagnoses
deterministically; see `test/capability-ledger.test.mjs`.

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
