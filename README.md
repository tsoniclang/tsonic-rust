# `@tsonic/target-rust`

Rust target pack for Tsonic. This package owns Rust target analysis, ownership
and lifetime contracts, compiler-backed rustdoc providers, Rust AST planning
and printing, generated Cargo artifacts, and Cargo toolchain handoff.

Canonical product documentation lives in the Tsonic repository:

- [Rust manual](https://github.com/tsoniclang/tsonic/tree/main/docs/manual/targets/rust)
- [Rust reference](https://github.com/tsoniclang/tsonic/tree/main/docs/reference/targets/rust)
- [Target-pack architecture](https://github.com/tsoniclang/tsonic/blob/main/docs/architecture/target-pack-contract.md)

## Package entry points

| Export | Purpose |
| --- | --- |
| `@tsonic/target-rust` | Target plugin |
| `@tsonic/target-rust/provider` | Rust provider-authoring contract |

Runtime crates remain owned by `@tsonic/rust-runtime`,
`@tsonic/rust-js`, and installed capability packages such as
`@tsonic/rust-nodejs`.

## Development

The sibling Tsonic packages and Rust runtime repositories must be available
through the workspace dependencies.

```sh
npm install
npm run build
npm test
```

`npm test` runs every target and generated-Cargo proof under the repository's
bounded memory, task, timeout, and log guards.
