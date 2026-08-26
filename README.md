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
unit-variant enums, discriminated object unions as payload enums with
TSTS-selected narrowing, tuples with constant indexing, `readonly T[]` as `&[T]`
and mutable array parameters as `&mut [T]`, null-only unions as `Option<T>`
with `??` coalescing, passthrough generic functions, neutral
`sharedBorrow`/`mutableBorrow`/`move` flow markers validated against finalized
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

The flow markers are owned by `@tsonic/core/lang.js`. Rust's
`@tsonic/rust/lang.js` instead owns the exact native-reference operations
`ref`, `mut`, `load`, and `store`; its `@tsonic/rust/types.js` module owns the
corresponding explicit lifetime and reference types. Safe typed-location facts
are converted once at the
Rust-owned policy boundary and lower to the runtime-owned `Location<T>`
carrier. Local, parameter, member, and index projections preserve stable
alias identity; unsupported escape, root, and overlapping mutable-borrow
shapes fail closed. The backend never reads neutral pointer facts or marker
spellings.

Generated source files participate in the shared target-artifact contract
graph through Rust-owned public-surface and implementation facets. If Rust
planning strengthens a callable contract—for example, `allocatePointer<T>`
adds `T: Clone + 'static`—every exact source-call dependent is reconstructed
to a fixed point before any Cargo project is published.

JS surface (selected explicitly with `surfaces: ["js"]`): dense `Vec<T>` and sparse
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
generic capability authoring helpers from `@tsonic/target-rust/provider`
(`createRustProviderPackage` with
creation-time identity validation, alias-import and carrier-path
contribution, and `composeRustCapabilities` for fail-closed local
composition). Capability crates enter the generated Cargo manifest only
on activation: an installed but unused capability contributes no
dependencies. The `@acme/rust-superbunapi` fixture proves the mechanism
is name-blind — no code in this package names any capability.

Rust standard-library declarations are available through target-owned virtual
modules. For example:

```ts
import type { int32 } from "@tsonic/core/types.js";
import { HashMap } from "@tsonic/rust/std/collections.js";

const values = new HashMap<string, int32>();
values.insert("answer", 42);
```

TSTS selects the exact virtual `HashMap.insert` declaration. Rust semantic
analysis then consumes that selected identity and its closed generic carriers;
the backend emits `std::collections::HashMap` operations without matching the
source spelling.

Third-party Cargo libraries use a user-owned `Cargo.toml`. Set the Rust target
option `projectFile` to that manifest and import a direct dependency by its
Cargo alias:

```toml
[dependencies]
widget_alias = { package = "acme-widget", version = "1.2.3" }
```

```ts
import type { int32 } from "@tsonic/core/types.js";
import { Widget } from "@tsonic/rust/crates/widget_alias/index.js";

const widget = new Widget<int32>(42);
```

The isolated compiler-provider worker snapshots the resolved Cargo graph,
materializes rustdoc JSON once for the selected dependency, and projects only
requested public exports into provider declarations. The same exact provider
identities and target carriers flow into Rust operation selection. Unsupported
Rust signatures fail at the virtual import boundary. In `projectFile` mode,
Tsonic emits source artifacts only and never creates or mutates `Cargo.toml`;
the user-owned Cargo project controls dependencies, features, profiles, and
the inclusion of generated source. Compiler-source packages are linked the
same way: each package is generated as its own Rust library, while the
consumer's user-owned manifest declares the corresponding path or registry
dependency. A generated library exposes its authored facade plus a stable
`#[doc(hidden)]` implementation ABI so separately generated subclasses and
exact inherited method bodies can link without widening the TypeScript API.

## Explicitly unsupported (fail-closed, classified)

Every unsupported lane requires a contract that does not exist and diagnoses
deterministically; see `test/architecture/capability-ledger.test.mjs`. RegExp
is no longer such a lane: constant and dynamic construction use the complete
runtime ECMAScript engine, including lookaround, named groups, indices, and
replacement callbacks. The exact supported JS/Node inventory is maintained in
`docs/parity-inventory.md`.

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

Each runtime npm package owns one canonical Cargo source tree:
`@tsonic/rust-runtime/crates/tsonic_rust_runtime`,
`@tsonic/rust-js/crates/tsonic_rust_js`, and capability-owned crate paths
such as `@tsonic/rust-nodejs/rust/crates/tsonic_rust_node`. Target packages
never copy runtime sources. Runtime contributions carry absolute installed
crate paths, so npm packages may be hoisted or nested independently. A crate
that intentionally replaces the same exact crate from crates.io declares that
registry-source relationship explicitly; generated Cargo manifests patch only
those declared crates and never infer replacements from package or crate names.

## Authoring provider packages

Use `createRustProviderPackage`: declare virtual modules
(`ProviderExportDeclaration` models), identity-keyed operation rows
(`exportId`/`memberId`/`signatureId` plus a Rust operation
form), and cargo crate contributions. Concrete names live only in row data;
the generic matcher contains no per-name branching. See
`src/public/provider.ts` and the `@acme/*` fixtures under
`test/helpers/rust-session.mjs`.

Provider-backed interfaces accept contextual object literals only when their
type row opts into `objectLiteralConstruction: { kind: "struct-default" }`.
Each authored property must resolve through exact readable and writable
provider member rows to one native field carrier. Those paired field rows are
the provider's complete native construction inventory. The planner emits a
plain struct when every field is supplied and uses `Default::default()` only
to complete omitted fields:

```ts
declare function configure(options: Options): void;
configure({ enabled: true });
```

```rust
configure(Options {
    enabled: Some(true),
    ..Default::default()
})?;
```

Provider evaluation is observable by default. A provider may add
`evaluation: "pure"` only when repeating the selected operation with stable
inputs has no observable difference. This lets Rust analysis safely select
representations such as evaluating an immutable collection bound once:

```ts
for (let index = 0; index < values.size; index++) {
  consume(index);
}
```

Purity is independent of fallibility and safety, and cannot be combined with
a constructor, source callback, setter, or any target input declared writable.
The provider contract is retained in the finalized operation ABI; planners
consume that ABI rather than inferring purity from a member name or emitted
Rust path.
