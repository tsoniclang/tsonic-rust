import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { snapshotRustNativeSourceRequest } from "../../../../dist/providers/native/elaboration/input.js";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";
import { nativeDefinitionKey, nativeStableDefinitionKey } from "../../../../dist/providers/native/elaboration/evidence.js";

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
  const sourcePath = join(directory, "authored.rs");
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
  const sourceText = `
#[cfg(not(native_proof_selected))]
compile_error!("the build-script configuration was lost");
const _: () = assert!(env!("NATIVE_PROOF_VALUE").as_bytes()[0] == b'c');
const _: () = assert!(env!("CARGO_PKG_NAME").len() == ${name.length});
include!(concat!(env!("OUT_DIR"), "/proof.rs"));
#[annotations::supply]
pub struct Value;
pub fn answer() -> u64 { renamed::chosen() + generated() + BUILD_VALUE }
${binary ? 'fn main() { assert_eq!(answer(), 49); }' : ''}
`;
  if (!missingSource) write("authored.rs", sourceText);
  runRustNativeCommand({ executable: "cargo", arguments: ["generate-lockfile", "--offline", "--manifest-path", manifestPath],
    directory, environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 });
  const retained = [manifestPath, ...(missingSource ? [] : [sourcePath]), join(directory, "Cargo.lock")]
    .map(path => [path, readFileSync(path, "utf8")]);
  const metadata = JSON.parse(runRustNativeCommand({ executable: "cargo",
    arguments: ["metadata", "--locked", "--offline", "--no-deps", "--format-version=1", "--manifest-path", manifestPath],
    directory, environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 }));
  const packageId = metadata.packages.find(candidate => candidate.manifest_path === manifestPath).id;
  const input = { compilation: { kind: "cargo", manifestPath, packageId, target } };
  return { directory, dependency, sourcePath, input, preserved() {
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
  const macro = first.definitions.find(row => row.kind === "macro" && row.name === "supply" && row.id.krate !== 0);
  assert.ok(macro);
  assert.ok(first.expansions.some(row => row.kind === "attribute" && row.definition !== null &&
    nativeDefinitionKey(row.definition) === nativeDefinitionKey(macro.id)));
  assert.ok(first.inputs.some(row => row.path.endsWith("proof.rs")));
  const repeated = tool.check(fixture.input);
  assert.deepEqual(first.definitions.map(row => nativeStableDefinitionKey(row.stable)),
    repeated.definitions.map(row => nativeStableDefinitionKey(row.stable)));
  fixture.preserved();
});

test("Cargo rejects absent real source without installing an empty root or publishing it", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_absent", false, true);
  assert.throws(() => tool.check(fixture.input), /couldn't read|could not read|No such file|cannot find|can't find lib/u);
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

function workspaceProject(name, { virtual, binary, memberManifest }) {
  const directory = join(root, name);
  const retainedPaths = [];
  const write = (path, text) => {
    const file = join(directory, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
    retainedPaths.push(file);
    return file;
  };
  const workspaceManifest = write("Cargo.toml", `
${virtual ? "" : `[package]\nname = "${name}_root"\nversion = "0.1.0"\nedition = "2024"`}
[workspace]
members = ["member", "decoy"]
default-members = ["decoy"]
resolver = "3"
`);
  if (!virtual) write("src/lib.rs", 'compile_error!("the workspace root was not selected");\n');
  write("decoy/Cargo.toml", `
[package]
name = "${name}_decoy"
version = "0.1.0"
edition = "2024"
`);
  write("decoy/src/lib.rs", 'compile_error!("the default member was not selected");\n');
  const selectedManifest = write("member/Cargo.toml", `
[package]
name = "${name}-selected"
version = "0.1.0"
edition = "2024"
[lib]
name = "different_native_name"
path = "src/native.rs"
${binary ? '[[bin]]\nname = "different-driver"\npath = "src/driver.rs"' : ""}
`);
  const libraryPath = write("member/src/native.rs", binary
    ? "pub fn from_library() -> u64 { 47 }\n"
    : "pub fn selected_member() -> u64 { 47 }\n");
  const sourcePath = binary ? write("member/src/driver.rs",
    "fn main() { assert_eq!(different_native_name::from_library(), 47); }\n") : libraryPath;
  runRustNativeCommand({ executable: "cargo", arguments: ["generate-lockfile", "--offline", "--manifest-path", workspaceManifest],
    directory, environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 });
  retainedPaths.push(join(directory, "Cargo.lock"));
  const retained = retainedPaths.map(path => [path, readFileSync(path, "utf8")]);
  const metadata = JSON.parse(runRustNativeCommand({ executable: "cargo",
    arguments: ["metadata", "--locked", "--offline", "--no-deps", "--format-version=1", "--manifest-path", workspaceManifest],
    directory, environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 }));
  const packageId = metadata.packages.find(candidate => candidate.manifest_path === selectedManifest).id;
  return {
    sourcePath,
    input: {
      compilation: { kind: "cargo", manifestPath: memberManifest ? selectedManifest : workspaceManifest, packageId,
        target: binary ? { kind: "binary", name: "different-driver" } : { kind: "library" } },
    },
    preserved() {
      for (const [path, text] of retained) assert.equal(readFileSync(path, "utf8"), text, path);
      assert.equal(existsSync(join(directory, "target")), false);
      assert.equal(existsSync(join(directory, "member/target")), false);
      assert.equal(existsSync(join(cacheRoot, "cargo/tsonic-source-evidence.rmeta")), false);
    },
  };
}

for (const [name, options] of [
  ["virtual_library", { virtual: true, binary: false, memberManifest: false }],
  ["package_library", { virtual: false, binary: false, memberManifest: false }],
  ["member_library", { virtual: true, binary: false, memberManifest: true }],
  ["virtual_binary", { virtual: true, binary: true, memberManifest: false }],
]) test(`Cargo retains its selected workspace target for ${name}`, { timeout: 300_000 }, () => {
  const fixture = workspaceProject(`cargo_native_${name}`, options);
  const evidence = tool.check(fixture.input);
  assert.equal(evidence.phase, "checked");
  assert.ok(evidence.definitions.some(row => row.id.krate === 0 && row.name === (options.binary ? "main" : "selected_member")));
  assert.ok(evidence.inputs.some(row => row.path === fixture.sourcePath));
  if (options.binary) assert.ok(evidence.definitions.some(row => row.id.krate !== 0 && row.name === "from_library"));
  fixture.preserved();
});

test("Cargo root errors and dependency failures cannot publish successful evidence", { timeout: 300_000 }, () => {
  const fixture = project("cargo_native_rejected");
  const source = readFileSync(fixture.sourcePath, "utf8");
  const invalid = "pub fn invalid() -> u32 { missing() }";
  writeFileSync(fixture.sourcePath, invalid);
  assert.throws(() => tool.check(fixture.input), /cannot find function/u);
  assert.equal(readFileSync(fixture.sourcePath, "utf8"), invalid);
  const wrongType = 'pub fn invalid() -> u32 { "wrong" }';
  writeFileSync(fixture.sourcePath, wrongType);
  assert.throws(() => tool.typing(fixture.input), /mismatched types/u);
  assert.equal(readFileSync(fixture.sourcePath, "utf8"), wrongType);
  writeFileSync(fixture.sourcePath, source);
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
    target: { kind: "binary", name: "authored" } } };
  const selected = snapshotRustNativeSourceRequest(valid, defaultRustNativeSourceLimits);
  valid.compilation.target.name = "changed";
  assert.equal(selected.compilation.target.name, "authored");
  for (const value of [selected, selected.compilation, selected.compilation.target]) assert.ok(Object.isFrozen(value));
  assert.throws(() => snapshotRustNativeSourceRequest({ ...valid, sources: [] }, defaultRustNativeSourceLimits), /exact compilation/u);
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
