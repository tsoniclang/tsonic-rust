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
fail-closed diagnostics for unsupported members. Node.js ships as a broad
provider package: `node:path` (join/resolve/normalize/dirname/basename/
extname/isAbsolute), `node:os` (platform/arch/eol/hostname/tmpdir/homedir),
`node:fs` (existsSync, readFileSync, writeFileSync, readdirSync, statSync
with a Stats carrier, mkdirSync, rmSync, unlinkSync, copyFileSync,
renameSync, realpathSync), `node:fs/promises` (readFile, writeFile,
readdir, stat, mkdir, rm, unlink, copyFile, rename — awaited fallible rows
lower to `.await?`; the runtime backing is async signatures over
synchronous file operations, a behavior proof rather than an I/O
scheduler), `node:process` (cwd() plus Node-shaped value exports platform,
arch, argv, pid, ppid, and env with index reads preserving absence as
null Option carriers; exit(code) maps to std::process::exit; env writes
and execPath fail closed), `node:buffer`
(Buffer from/alloc/byteLength/concat/toString/readUInt8/writeUInt8/equals/
compare/length, isBuffer), `node:url` (URL with property rows,
URLSearchParams, pathToFileURL, fileURLToPath), `node:crypto` (randomUUID, randomBytes
to Buffer, createHash with Hash update/digest), and `node:util` (closed
string helpers). Absent values are never silently defaulted: nullable reads
(env indexing, URLSearchParams.get, os.homedir) carry Option and lower
`??`/null checks explicitly. Declared members without rows (fs.watch,
streams, process.execPath, util.inspect/format, legacy url.parse/format,
btoa/atob, createHmac) each diagnose deterministically and name the
contract they require.

## Explicitly unsupported (fail-closed, classified)

Each unsupported lane requires a contract that does not exist: discriminated
object unions (narrowing facts — see the exact repro pinned in
`test/r8-completion.test.mjs`), and RegExp (unclaimed: the supported runtime subset does not match
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
