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
naming policy that preserves every user-authored identifier verbatim with
scoped lint allowances (snake_case exists only for compiler-generated
temporaries; provider and library identity is always row metadata emitted
verbatim), and the
error model: throwing functions lower to TsonicResult with transitive
fallibility, `throw new Error(message)` becomes an Err return, try/catch
lowers to a Result closure boundary, and fallible calls propagate with `?`
(closures are fallibility boundaries). The string ABI: parameters whose
every use is a ref-mode provider argument or member-access receiver take
`&str` (literal call sites pass bare `&str` literals); ownership-requiring
uses keep owned `String`. Homogeneous primitive tuple annotations carry
compile-time-proven length and lower to `[T; N]` with literal construction
and constant in-range indexing; dynamic indexing fails closed.

JS surface (selected surface or compat mode): dense `Vec<T>` and sparse
`JsArray<T>` lanes with callback iteration (map/filter/reduce/some/every as
Rust closures), string operations, Map/Set with SameValueZero runtime
semantics, Date (UTC carrier), JSON parse/stringify through fallible rows,
and `T | undefined` Option lanes.

Provider packages: identity-keyed operation rows over virtual declarations
(calls, constructors, properties, indexers, operators via std::ops
metadata, async and fallible rows), cargo dependency contribution, and
fail-closed diagnostics for unsupported members. Node.js support is not part of this
package: it ships as the separately installed `@tsonic/rust-nodejs`
capability plugin, which owns `node:*` module declarations, operation
rows, and the `tsonic_rust_node` runtime crate contribution. This target
package exposes the standard `createTsonicPlugin()` entrypoint and the
generic capability authoring helpers (`createRustProviderPackage` with
creation-time identity validation, alias-import and carrier-path
contribution, and `composeRustCapabilities` for fail-closed local
composition). Capability crates enter the generated Cargo manifest only
on activation: an installed but unused capability contributes no
dependencies. The `@acme/rust-superbunapi` fixture proves the mechanism
is name-blind — no code in this package names any capability.

## Explicitly unsupported (fail-closed, classified)

Each unsupported lane requires a contract that does not exist: discriminated
object unions (narrowing facts — see the exact repro pinned in
`test/r8-completion.test.mjs`), and RegExp constructs outside the
oracle-proven subset (constant patterns with classes, quantifiers,
anchors, alternation, and groups under flags i/g/m are implemented
against 146 committed Node oracle vectors — see the rust-js
JS parity inventory (docs/js-parity.md); lazy quantifiers, backreferences, lookaround,
named groups, word boundaries, and dynamic patterns reject
deterministically). Every unsupported lane diagnoses
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

## Runtime artifact rule

Packaged runtime crates ship inside their npm package under
`runtimes/crates/`, with lib-only manifests (no repo-relative test
targets), a `[workspace]` opt-out so consumer workspaces never capture
them, and complete dependency closure: target-owned crates reference
their in-package siblings by relative path, and capability crates
reference target-owned crates through the flat node_modules peer layout
(`../../../../target-rust/runtimes/crates/<crate>`). Generated Cargo
manifests reference only installed package paths.

## Authoring provider packages

Use `createRustProviderPackage`: declare virtual modules
(`ProviderExportDeclaration` models), identity-keyed operation rows
(`exportId`/`memberId`/`signatureId`/`receiverTypeId` plus a Rust operation
form), and cargo crate contributions. Concrete names live only in row data;
the generic matcher contains no per-name branching. See
`src/source/provider-packages/nodejs.ts` and the `@acme/*` fixtures under
`test/helpers/rust-session.mjs`.
