# `@tsonic/target-rust`

Rust target pack for Tsonic. This package owns Rust target analysis, ownership
and lifetime contracts, compiler-backed rustdoc providers, Rust AST planning
and syntax printing, canonical `rustfmt` formatting, generated Cargo artifacts,
and Cargo toolchain handoff.

Canonical product documentation lives in the Tsonic repository:

- [Rust manual](https://github.com/tsoniclang/tsonic/tree/main/docs/manual/targets/rust)
- [Rust reference](https://github.com/tsoniclang/tsonic/tree/main/docs/reference/targets/rust)
- [Target-pack architecture](https://github.com/tsoniclang/tsonic/blob/main/docs/architecture/target-pack-contract.md)

## Use in a project

Install Node.js 22.18 or newer. Install Rust through rustup with Cargo,
rustc, rustdoc, and rustfmt, then install the CLI and target in the project
that contains `tsonic.json`:

```sh
npm install --save-dev @tsonic/cli@^0.1.0 @tsonic/target-rust@^0.1.0
npx --no-install tsonic targets --project tsonic.json
npx --no-install tsonic build --project tsonic.json
```

The [first Rust project guide](https://github.com/tsoniclang/tsonic/blob/main/docs/manual/get-started.md#build-a-rust-application)
contains a complete source file, project configuration, native build, and run.

## Package entry points

| Export | Purpose |
| --- | --- |
| `@tsonic/target-rust` | Target plugin |
| `@tsonic/target-rust/provider` | Rust provider-authoring contract |

Runtime crates remain owned by `@tsonic/rust-runtime`,
`@tsonic/rust-js`, and installed capability packages such as
`@tsonic/rust-nodejs`.

## Develop this target pack

The sibling Tsonic packages and Rust runtime repositories must be available
through the workspace dependencies. The selected Rust toolchain must include
`rustfmt`; generated Rust is formatted before Tsonic publishes it.

```sh
npm install
npm run build
npm test
```

`npm test` runs every target and generated-Cargo proof under the repository's
bounded memory, task, timeout, and log guards.
