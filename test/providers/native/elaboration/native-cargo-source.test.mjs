import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { snapshotRustNativeSourceRequest } from "../../../../dist/providers/native/elaboration/input.js";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";
import { nativeStableDefinitionKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-cargo-source-");
const cacheRoot = join(root, "cache");
const tool = createRustNativeSourceTool({ cacheRoot });

function project(name, binary = false, missingSource = false) {
  const directory = join(root, name);
  const write = (path, text) => {
    const target = join(directory, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
    return target;
  };
  const sourcePath = missingSource ? join(directory, "authored.rs")
    : write("authored.rs", 'compile_error!("previously published source must not be checked");\n');
  const target = binary ? { kind: "binary", name: "chosen-driver" } : { kind: "library" };
  const manifestPath = write("Cargo.toml", `
[package]
name = "${name}"
version = "0.1.0"
edition = "2024"
${binary ? '[[bin]]\nname = "chosen-driver"' : '[lib]'}
path = "authored.rs"
[workspace]
members = ["ordinary", "attributes"]
[dependencies]
renamed = { package = "native_value", path = "ordinary", features = ["selected"], default-features = false }
annotations = { package = "native_annotations", path = "attributes" }
`);
  write("ordinary/Cargo.toml", `
[package]
name = "native_value"
version = "0.1.0"
edition = "2024"
[features]
default = ["wrong"]
wrong = []
selected = []
`);
  const dependency = write("ordinary/src/lib.rs", `
#[cfg(any(feature = "wrong", not(feature = "selected")))]
compile_error!("the selected dependency features were lost");
pub fn chosen() -> u64 { 13 }
`);
  write("attributes/Cargo.toml", `
[package]
name = "native_annotations"
version = "0.1.0"
edition = "2024"
[lib]
proc-macro = true
`);
  write("attributes/src/lib.rs", `
extern crate proc_macro;
use proc_macro::TokenStream;
#[proc_macro_attribute]
pub fn supply(_input: TokenStream, item: TokenStream) -> TokenStream {
    format!("{item} pub fn generated() -> u64 {{ 29 }}").parse().unwrap()
}
`);
  write(".cargo/config.toml", '[env]\nNATIVE_PROOF_VALUE = "checked"\n');
  write("build.rs", `
fn main() {
    println!("cargo::rustc-check-cfg=cfg(native_proof_selected)");
    println!("cargo::rustc-cfg=native_proof_selected");
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(output.join("proof.rs"), "pub const BUILD_VALUE: u64 = 7;").unwrap();
}
`);
  runRustNativeCommand({ executable: "cargo", arguments: ["generate-lockfile", "--offline", "--manifest-path", manifestPath],
    directory, environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 });
  const retained = [manifestPath, ...(missingSource ? [] : [sourcePath]), join(directory, "Cargo.lock")]
    .map(path => [path, readFileSync(path, "utf8")]);
  const metadata = JSON.parse(runRustNativeCommand({ executable: "cargo",
    arguments: ["metadata", "--locked", "--offline", "--no-deps", "--format-version=1", "--manifest-path", manifestPath],
    directory, environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 }));
  const packageId = metadata.packages.find(candidate => candidate.manifest_path === manifestPath).id;
  const input = { compilation: { kind: "cargo", manifestPath, packageId, target }, sources: [{ path: sourcePath, text: `
#[cfg(not(native_proof_selected))]
compile_error!("the build-script configuration was lost");
const _: () = assert!(env!("NATIVE_PROOF_VALUE").as_bytes()[0] == b'c');
const _: () = assert!(env!("CARGO_PKG_NAME").len() == ${name.length});
include!(concat!(env!("OUT_DIR"), "/proof.rs"));
#[annotations::supply]
pub struct Value;
pub fn answer() -> u64 { renamed::chosen() + generated() + BUILD_VALUE }
${binary ? 'fn main() { assert_eq!(answer(), 49); }' : ''}
` }] };
  return { directory, dependency, input, preserved() {
    for (const [path, text] of retained) assert.equal(readFileSync(path, "utf8"), text, path);
    assert.equal(existsSync(sourcePath), !missingSource);
    assert.equal(existsSync(join(directory, "target")), false);
    assert.equal(existsSync(join(cacheRoot, "cargo/tsonic-source-evidence.rmeta")), false);
  } };
}

test("Cargo supplies exact aliases, procedural artifacts, features, build configuration and environment", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_library");
  const first = tool.check(fixture.input);
  assert.equal(first.phase, "checked");
  assert.ok(first.definitions.some(row => row.name === "generated" && row.id.krate === 0));
  assert.ok(first.definitions.some(row => row.name === "chosen" && row.id.krate !== 0));
  assert.ok(first.expansions.some(row => row.kind === "attribute" && row.name.endsWith("supply")));
  assert.ok(first.inputs.some(row => row.path.endsWith("proof.rs")));
  const repeated = tool.check(fixture.input);
  assert.deepEqual(first.definitions.map(row => nativeStableDefinitionKey(row.stable)),
    repeated.definitions.map(row => nativeStableDefinitionKey(row.stable)));
  fixture.preserved();
});

test("Cargo can check a prospective source without installing an empty root or publishing it", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_prospective", false, true);
  const evidence = tool.check(fixture.input);
  assert.equal(evidence.phase, "checked");
  assert.ok(evidence.inputs.some(row => row.path === fixture.input.sources[0].path));
  fixture.preserved();
});

test("Cargo selects the requested binary and uses the same declared and typed evidence owners", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_binary", true);
  for (const [method, phase] of [["declarations", "declarations"], ["typing", "typed"], ["check", "checked"]]) {
    const evidence = tool[method](fixture.input);
    assert.equal(evidence.phase, phase);
    assert.ok(evidence.definitions.some(row => row.name === "main" && row.id.krate === 0));
    assert.ok(evidence.definitions.some(row => row.name === "generated" && row.id.krate === 0));
    fixture.preserved();
  }
  assert.throws(() => tool.check({ ...fixture.input, compilation: { ...fixture.input.compilation,
    target: { kind: "binary", name: "not-selected" } } }), /no bin target|no binary target/u);
  fixture.preserved();
});

test("Cargo root errors and dependency failures cannot publish successful evidence", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_rejected");
  assert.throws(() => tool.check({ ...fixture.input, sources: [{ ...fixture.input.sources[0],
    text: "pub fn invalid() -> u32 { missing() }" }] }), /cannot find function/u);
  assert.throws(() => tool.typing({ ...fixture.input, sources: [{ ...fixture.input.sources[0],
    text: 'pub fn invalid() -> u32 { "wrong" }' }] }), /mismatched types/u);
  writeFileSync(fixture.dependency, 'compile_error!("dependency rejected");\n');
  assert.throws(() => tool.check(fixture.input), /dependency rejected/u);
  fixture.preserved();
});

test("Cargo context refuses to erase a configured native workspace wrapper", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_wrapper");
  writeFileSync(join(fixture.directory, ".cargo/config.toml"), '[build]\nrustc-workspace-wrapper = "user-owned-wrapper"\n');
  assert.throws(() => tool.check(fixture.input), /cannot replace configured build.rustc-workspace-wrapper/u);
  const selected = createRustNativeSourceTool({ cacheRoot,
    environment: { ...process.env, RUSTC_WORKSPACE_WRAPPER: "user-owned-wrapper" } });
  assert.throws(() => selected.check(fixture.input), /cannot replace an existing RUSTC_WORKSPACE_WRAPPER/u);
  fixture.preserved();
});

test("Cargo evidence retains independent row and output limits", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_limits");
  for (const limits of [
    { ...defaultRustNativeSourceLimits, maximumRows: 16 },
    { ...defaultRustNativeSourceLimits, maximumOutputBytes: 64 },
  ]) {
    const bounded = createRustNativeSourceTool({ cacheRoot, limits });
    assert.throws(() => bounded.check(fixture.input), /limit/u);
  }
  fixture.preserved();
});

test("Cargo request selection is exact, immutable, bounded and never guesses a target", () => {
  const valid = { compilation: { kind: "cargo", manifestPath: join(root, "Cargo.toml"), packageId: "package-identity",
    target: { kind: "binary", name: "authored" } }, sources: [] };
  const selected = snapshotRustNativeSourceRequest(valid, defaultRustNativeSourceLimits);
  valid.compilation.target.name = "changed";
  assert.equal(selected.compilation.target.name, "authored");
  for (const value of [selected, selected.compilation, selected.compilation.target, selected.sources]) assert.ok(Object.isFrozen(value));
  for (const compilation of [
    { ...valid.compilation, extra: 1 }, { ...valid.compilation, manifestPath: "relative.toml" },
    { ...valid.compilation, manifestPath: `${root}/bad\0path` }, { ...valid.compilation, manifestPath: `${root}/bad\ud800path` },
    ...[undefined, "", 1, "bad\0identity", "bad\ud800identity"].map(packageId => ({ ...valid.compilation, packageId })),
    ...[null, {}, { kind: "library", name: "wrong" }, { kind: "binary" }, { kind: "binary", name: "" },
      { kind: "binary", name: "bad\0name" }, { kind: "binary", name: "bad\ud800name" }, { kind: "library", extra: true },
      Object.defineProperty({}, "kind", { enumerable: true, get() { assert.fail("No getter execution."); } }),
    ].map(target => ({ ...valid.compilation, target })),
  ]) assert.throws(() => snapshotRustNativeSourceRequest({ ...valid, compilation }, defaultRustNativeSourceLimits), /Native Rust/u);
  assert.throws(() => snapshotRustNativeSourceRequest(valid, { ...defaultRustNativeSourceLimits, maximumRows: 2 }), /row limit/u);
});
