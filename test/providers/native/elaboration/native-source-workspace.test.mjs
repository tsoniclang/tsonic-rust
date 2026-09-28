import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { maximumRustNativeRequestBytes, snapshotRustNativeSourceRequest } from "../../../../dist/providers/native/elaboration/input.js";
import { validateRustNativeEvidenceInputs } from "../../../../dist/providers/native/elaboration/freshness.js";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-source-workspace-");
const cacheRoot = join(root, "cache");
const tool = createRustNativeSourceTool({ cacheRoot });
const limits = defaultRustNativeSourceLimits;

function request(directory, name) {
  return { compilation: { kind: "compiler", directory,
    arguments: ["--edition=2024", "--crate-type=lib", `${name}.rs`] } };
}

test("native source request snapshots its exact immutable compilation context", () => {
  const input = request(root, "snapshot");
  const selected = snapshotRustNativeSourceRequest(input, limits);
  input.compilation.arguments[0] = "--invalid-option";
  input.compilation.arguments.push("wrong");
  input.compilation.directory = join(root, "changed");
  assert.equal(selected.compilation.arguments[0], "--edition=2024");
  assert.equal(selected.compilation.arguments.length, 3);
  assert.equal(selected.compilation.directory, root);
  for (const value of [selected, selected.compilation, selected.compilation.arguments]) assert.ok(Object.isFrozen(value));
});

test("native source requests reject removed overlays and malformed compilation selections", () => {
  const valid = request(root, "malformed");
  for (const input of [
    valid.compilation.arguments, { arguments: valid.compilation.arguments }, { ...valid, extra: true },
    { ...valid, sources: [] }, { ...valid, sources: [{ path: join(root, "malformed.rs"), text: "pub struct Ignored;" }] },
    ...[[], [null], ["bad\0argument"], ["bad\ud800argument"], new Array(1)].map(arguments_ =>
      ({ ...valid, compilation: { ...valid.compilation, arguments: arguments_ } })),
    ...[undefined, "", "relative", "bad\0directory", `${root}/bad\ud800directory`, 1].map(directory =>
      ({ ...valid, compilation: { ...valid.compilation, directory } })),
    ...[null, {}, { kind: "compiler", arguments: valid.compilation.arguments }, { ...valid.compilation, extra: true },
      Object.create(valid.compilation), Object.defineProperty({}, "kind", {
        enumerable: true, get() { assert.fail("No getter execution."); },
      })].map(compilation => ({ ...valid, compilation })),
    Object.defineProperty({}, "compilation", { enumerable: true, get() { assert.fail("No getter execution."); } }),
  ]) assert.throws(() => snapshotRustNativeSourceRequest(input, limits), /Native Rust/u);
  assert.throws(() => snapshotRustNativeSourceRequest(valid, { ...limits, maximumRows: 3 }), /row limit/u);
  assert.deepEqual(snapshotRustNativeSourceRequest(valid, { ...limits, maximumRows: 4 }), valid);
  assert.throws(() => tool.check(valid.compilation.arguments), /exact compilation/u);
  assert.throws(() => tool.check({ ...valid, sources: [] }), /exact compilation/u);
});

test("native source selections retain raw and encoded byte limits before invoking the compiler", () => {
  const input = request(root, "bounded");
  input.compilation.arguments.push("x".repeat(maximumRustNativeRequestBytes + 1));
  assert.throws(() => snapshotRustNativeSourceRequest(input, limits), /byte limit/u);
  assert.throws(() => tool.check(input), /byte limit/u);
  input.compilation.arguments.pop();
  input.compilation.arguments.push("\u0001".repeat(Math.ceil(maximumRustNativeRequestBytes / 6)));
  assert.throws(() => tool.check(input), /byte limit/u);
  assert.equal(existsSync(join(root, "bounded.rs")), false);
});

for (const phase of ["declarations", "typing", "check"]) {
  test(`native ${phase} checks real modules and includes without publishing native output`, () => {
    const directory = join(root, phase);
    mkdirSync(directory);
    const input = request(directory, "candidate");
    const output = join(directory, "unpublished.rlib");
    input.compilation.arguments.push("-o", output);
    const sources = [
      { path: join(directory, "candidate.rs"), text: "mod child;\npub fn value() -> u32 { child::value() }\npub const SOURCE: &str = file!();\n" },
      { path: join(directory, "child.rs"), text: 'pub fn value() -> u32 { include_str!("message.txt").len() as u32 }\n' },
      { path: join(directory, "message.txt"), text: "exact 🦀 bytes\n" },
    ];
    for (const source of sources) writeFileSync(source.path, source.text);
    const evidence = tool[phase](input);
    for (const source of sources) {
      const observed = evidence.inputs.find(file => file.path === source.path);
      assert.ok(observed, source.path);
      assert.equal(observed.byteLength, Buffer.byteLength(source.text));
      assert.equal(observed.digest, createHash("sha256").update(source.text).digest("hex"));
      assert.equal(readFileSync(source.path, "utf8"), source.text);
    }
    assert.ok(evidence.definitions.some(definition => definition.name === "value" && definition.source?.file.endsWith("child.rs")));
    validateRustNativeEvidenceInputs(evidence);
    writeFileSync(sources[1].path, "pub fn value() -> u32 { 8 }\n");
    assert.throws(() => validateRustNativeEvidenceInputs(evidence), /checked input changed/u);
    assert.equal(existsSync(output), false);
  });
}

test("real source bodies are checked and failure never writes native output", () => {
  const path = join(root, "invalid_body.rs");
  const output = join(root, "invalid_body.rlib");
  const input = request(root, "invalid_body");
  input.compilation.arguments.push("-o", output);
  const invalid = "pub fn value() -> u32 { true }\n";
  writeFileSync(path, invalid);
  assert.throws(() => tool.check(input), /mismatched types/u);
  assert.equal(readFileSync(path, "utf8"), invalid);
  assert.equal(existsSync(output), false);
  writeFileSync(path, "pub fn value() -> u32 { 8 }\n");
  assert.equal(tool.check(input).phase, "checked");
  assert.equal(existsSync(output), false);
});

test("native compilation rejects missing real inputs instead of fabricating source files", () => {
  assert.throws(() => tool.check(request(root, "absent")), /couldn't read|No such file|cannot find/u);
  assert.throws(() => tool.check(request(join(root, "absent-directory"), "absent")), /No such file|cannot find/u);
  assert.equal(existsSync(join(root, "absent.rs")), false);
  assert.equal(existsSync(join(root, "absent-directory")), false);
});

test("procedural macros and subprocesses read the actual source in the selected working directory", { timeout: 120_000 }, () => {
  const directory = join(root, "observed");
  mkdirSync(directory);
  const macroPath = join(directory, "observer.rs");
  const extension = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
  const library = join(directory, `libobserver.${extension}`);
  const reader = join(directory, process.platform === "win32" ? "reader.exe" : "reader");
  const readerPath = join(directory, "reader.rs");
  writeFileSync(readerPath, 'fn main() { print!("{}", std::fs::read_to_string("candidate.rs").unwrap()); }\n');
  writeFileSync(macroPath, `
extern crate proc_macro;
use proc_macro::TokenStream;
#[proc_macro_attribute]
pub fn observe(_: TokenStream, item: TokenStream) -> TokenStream {
    assert!(item.to_string().contains("Candidate"));
    let source = std::fs::read_to_string("candidate.rs").unwrap();
    assert!(source.contains("struct Candidate;"));
    assert!(!source.contains("struct Original;"));
    let child = std::process::Command::new(std::env::var_os("NATIVE_SOURCE_READER").unwrap()).output().unwrap();
    assert!(child.status.success());
    assert_eq!(child.stdout, source.as_bytes());
    "pub struct Seen { pub value: bool }".parse().unwrap()
}
`);
  const compiler = process.env.RUSTC ?? "rustc";
  for (const arguments_ of [
    ["--edition=2024", "--crate-type=proc-macro", "--crate-name=observer", macroPath, "-o", library],
    ["--edition=2024", "--crate-name=reader", readerPath, "-o", reader],
  ]) runRustNativeCommand({ executable: compiler, arguments: arguments_, directory,
    environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 });
  const source = "#[observer::observe]\npub struct Candidate;\n";
  writeFileSync(join(directory, "candidate.rs"), source);
  const original = join(root, "candidate.rs");
  writeFileSync(original, "pub struct Original;\n");
  const observed = createRustNativeSourceTool({ cacheRoot,
    environment: { ...process.env, NATIVE_SOURCE_READER: reader } });
  const input = request(directory, "candidate");
  input.compilation.arguments.push("--extern", `observer=${library}`);
  for (const phase of ["declarations", "typing", "check"]) {
    const evidence = observed[phase](input);
    const field = evidence.definitions.find(definition => definition.kind === "field" && definition.name === "value");
    assert.ok(field);
    assert.deepEqual(evidence.types.find(type => type.id === field.type)?.value, { kind: "primitive", name: "bool" });
    assert.ok(evidence.inputs.some(file => file.path === join(directory, "candidate.rs")));
    assert.equal(readFileSync(original, "utf8"), "pub struct Original;\n");
    assert.equal(readFileSync(join(directory, "candidate.rs"), "utf8"), source);
  }
});
