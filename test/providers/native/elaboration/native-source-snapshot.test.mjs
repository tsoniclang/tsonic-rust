import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { maximumRustNativeRequestBytes, snapshotRustNativeSourceRequest } from "../../../../dist/providers/native/elaboration/input.js";
import { validateRustNativeEvidenceInputs } from "../../../../dist/providers/native/elaboration/freshness.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-source-snapshot-");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });
const limits = defaultRustNativeSourceLimits;

function request(name, text) {
  const path = join(root, `${name}.rs`);
  return { arguments: ["--edition=2024", "--crate-type=lib", path], sources: [{ path, text }] };
}

test("native source request snapshots exact immutable arguments and source text", () => {
  const input = request("snapshot", "pub fn café() -> u32 { 7 }\n");
  const selected = snapshotRustNativeSourceRequest(input, limits);
  input.arguments[0] = "--invalid-option";
  input.sources[0].text = "wrong";
  input.sources.push({ path: join(root, "other.rs"), text: "wrong" });
  assert.equal(selected.arguments[0], "--edition=2024");
  assert.equal(selected.sources.length, 1);
  assert.equal(selected.sources[0].text, "pub fn café() -> u32 { 7 }\n");
  for (const value of [selected, selected.arguments, selected.sources, selected.sources[0]]) assert.ok(Object.isFrozen(value));
});

test("native source requests reject malformed selections instead of retaining an old argument-list API", () => {
  const valid = request("malformed", "pub fn value() {}\n");
  for (const input of [
    valid.arguments, { arguments: valid.arguments }, { ...valid, extra: true }, { ...valid, arguments: [] },
    { ...valid, arguments: [null] }, { ...valid, arguments: ["bad\0argument"] },
    { ...valid, arguments: ["bad\ud800argument"] }, { ...valid, arguments: new Array(1) },
    { ...valid, sources: new Array(1) }, { ...valid, sources: [null] },
    { ...valid, sources: [{ ...valid.sources[0], extra: true }] },
    { ...valid, sources: [{ path: "relative.rs", text: "" }] },
    { ...valid, sources: [{ path: `${root}/bad\0path`, text: "" }] },
    { ...valid, sources: [{ path: `${root}/bad\ud800path`, text: "" }] },
    { ...valid, sources: [{ path: valid.sources[0].path, text: "\ud800" }] },
    { ...valid, sources: [{ path: valid.sources[0].path, text: 4 }] },
    { ...valid, sources: [valid.sources[0], valid.sources[0]] },
    { ...valid, sources: [Object.create(valid.sources[0])] },
    Object.defineProperty({ sources: [] }, "arguments", { enumerable: true, get() { assert.fail("No getter execution."); } }),
  ]) assert.throws(() => snapshotRustNativeSourceRequest(input, limits), /Native Rust/u);
  assert.throws(() => snapshotRustNativeSourceRequest(valid, { ...limits, maximumRows: 3 }), /row limit/u);
  assert.deepEqual(snapshotRustNativeSourceRequest(valid, { ...limits, maximumRows: 4 }), valid);
  assert.throws(() => tool.check(valid.arguments), /exact arguments/u);
});

test("native source selections retain finite byte budgets before invoking the compiler", () => {
  const input = request("bounded", "x".repeat(maximumRustNativeRequestBytes + 1));
  assert.throws(() => snapshotRustNativeSourceRequest(input, limits), /byte limit/u);
  assert.throws(() => tool.check(input), /byte limit/u);
  input.sources[0].text = "\0".repeat(Math.ceil(maximumRustNativeRequestBytes / 6));
  assert.throws(() => tool.check(input), /byte limit/u);
  assert.equal(existsSync(input.sources[0].path), false);
});

for (const phase of ["declarations", "typing", "check"]) {
  test(`native ${phase} reads candidate modules and includes without publishing files`, () => {
    const input = request(`candidate_${phase}`, `mod child;
pub fn value() -> u32 { child::value() }
pub const SOURCE: &str = file!();
`);
    const child = { path: join(root, "child.rs"), text: 'pub fn value() -> u32 { include_str!("message.txt").len() as u32 }\n' };
    const included = { path: join(root, "message.txt"), text: "exact 🦀 bytes\n" };
    input.sources.push(child, included);
    const evidence = tool[phase](input);
    for (const source of input.sources) {
      const observed = evidence.inputs.find(file => file.path === source.path);
      assert.ok(observed, source.path);
      assert.equal(observed.byteLength, Buffer.byteLength(source.text));
      assert.equal(observed.digest, createHash("sha256").update(source.text).digest("hex"));
      assert.equal(existsSync(source.path), false);
    }
    assert.ok(evidence.definitions.some(definition => definition.name === "value" && definition.source?.file === child.path));
    validateRustNativeEvidenceInputs(evidence, input.sources);
    const changed = input.sources.map(source => source === child ? { ...source, text: "pub fn value() -> u32 { 8 }" } : source);
    assert.throws(() => validateRustNativeEvidenceInputs(evidence, changed), /checked input changed/u);
    assert.throws(() => validateRustNativeEvidenceInputs(evidence, []));
  });
}

test("candidate source overrides only its exact file while real dependencies remain freshness-checked", () => {
  const input = request("candidate_with_dependency", "mod disk; pub fn value() -> u32 { disk::value() }\n");
  const path = input.sources[0].path;
  const original = 'compile_error!("must not compile the previous published file");\n';
  writeFileSync(path, original);
  const dependency = join(root, "disk.rs");
  writeFileSync(dependency, "pub fn value() -> u32 { 42 }\n");
  const evidence = tool.check(input);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.ok(evidence.inputs.some(file => file.path === dependency));
  validateRustNativeEvidenceInputs(evidence, input.sources);
  writeFileSync(dependency, "pub fn value() -> u32 { 43 }\n");
  assert.throws(() => validateRustNativeEvidenceInputs(evidence, input.sources), /checked input changed/u);
});

test("candidate bodies are checked, not replaced by signatures or temporary output", () => {
  const input = request("invalid_body", "pub fn value() -> u32 { true }\n");
  assert.throws(() => tool.check(input), /mismatched types/u);
  assert.equal(existsSync(input.sources[0].path), false);
  input.sources[0].text = "pub fn value() -> u32 { 8 }\n";
  assert.equal(tool.check(input).phase, "checked");
  assert.equal(existsSync(input.sources[0].path), false);
});
