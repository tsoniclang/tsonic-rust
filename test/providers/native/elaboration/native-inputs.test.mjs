import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { validateRustNativeEvidenceInputs } from "../../../../dist/providers/native/elaboration/freshness.js";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";

const root = createTestWorkspace("native-source-inputs");
const cacheRoot = join(root, "cache");
const limits = defaultRustNativeSourceLimits;
const tool = createRustNativeSourceTool({ cacheRoot });

function writeSource(directory, name, source) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, source);
  return path;
}

function emptyEvidence() {
  return { phase: "declarations", inputs: [], probes: [], types: [], constants: [],
    definitions: [], scopes: [], expansions: [] };
}

function input(path, contents) {
  return { path, byteLength: Buffer.byteLength(contents), digest: createHash("sha256").update(contents).digest("hex") };
}

for (const phase of ["declarations", "check"]) {
  test(`native ${phase} records positive and negative source-module lookups`, () => {
    const directory = join(root, phase);
    const child = writeSource(directory, "child.rs", "pub fn value() -> u32 { 7 }\n");
    const source = writeSource(directory, "root.rs", "mod child; pub fn value() -> u32 { child::value() }\n");
    const evidence = tool[phase](["--edition=2024", "--crate-type=lib", source]);
    assert.ok(evidence.probes.some(probe => probe.path === child && probe.exists));
    const alternative = join(directory, "child", "mod.rs");
    assert.ok(evidence.probes.some(probe => probe.path === alternative && !probe.exists));
    validateRustNativeEvidenceInputs(evidence);
    writeSource(join(directory, "child"), "mod.rs", "pub fn value() -> u32 { 9 }\n");
    assert.throws(() => validateRustNativeEvidenceInputs(evidence), /source lookup changed/u);
    assert.throws(() => tool[phase](["--edition=2024", "--crate-type=lib", source]), /found at both/u);
  });
}

test("native input validation checks disappearance, byte content, length and directory lookup identity", () => {
  const directory = join(root, "validation");
  const source = writeSource(directory, "input.rs", "abcd");
  const evidence = { ...emptyEvidence(), inputs: [input(source, "abcd")],
    probes: [{ path: directory, exists: true }, { path: source, exists: true }] };
  validateRustNativeEvidenceInputs(decodeNativeEvidence(evidence, limits));
  writeFileSync(source, "abce");
  assert.throws(() => validateRustNativeEvidenceInputs(evidence), /input changed/u);
  writeFileSync(source, "abcde");
  assert.throws(() => validateRustNativeEvidenceInputs(evidence), /input changed/u);
  writeFileSync(source, "abcd");
  renameSync(source, join(directory, "moved.rs"));
  assert.throws(() => validateRustNativeEvidenceInputs(evidence), /lookup changed/u);
  const missing = join(directory, "absent");
  const probeOnly = { ...emptyEvidence(), probes: [{ path: missing, exists: false }] };
  validateRustNativeEvidenceInputs(probeOnly);
  mkdirSync(missing);
  assert.throws(() => validateRustNativeEvidenceInputs(probeOnly), /lookup changed/u);
});

test("native input decoding rejects missing, duplicate, contradictory and malformed lookup records", () => {
  const path = join(root, "decoded.rs");
  const valid = { ...emptyEvidence(), inputs: [input(path, "source")], probes: [
    { path, exists: true }, { path: join(root, "absent.rs"), exists: false },
  ] };
  const decoded = decodeNativeEvidence(valid, limits);
  assert.ok(Object.isFrozen(decoded.probes));
  assert.ok(Object.isFrozen(decoded.probes[0]));
  for (const mutate of [
    value => { delete value.probes; },
    value => { value.probes.push(value.probes[0]); },
    value => { value.probes[0].exists = false; },
    value => { value.probes[0].exists = "true"; },
    value => { value.probes[0].ignored = true; },
    value => { value.inputs[0].ignored = true; },
    value => { value.probes[0].path = "relative.rs"; },
    value => { value.inputs[0].path = "relative.rs"; },
    value => { value.probes[0].path = `${path}\0`; },
    value => { value.inputs[0].digest = "0"; },
  ]) {
    const corrupted = structuredClone(valid);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, limits), /Native Rust/u);
  }
  assert.throws(() => decodeNativeEvidence(valid, { ...limits, maximumRows: 2 }), /row limit/u);
  assert.equal(decodeNativeEvidence(valid, { ...limits, maximumRows: 3 }).probes.length, 2);
});

test("one native source tool retains its selected environment without mutating caller options", () => {
  const environment = { ...process.env, TSONIC_NATIVE_INPUT_TEST: "selected" };
  const selected = createRustNativeSourceTool({ cacheRoot, environment });
  environment.TSONIC_NATIVE_INPUT_TEST = "changed";
  const source = writeSource(join(root, "environment"), "root.rs", `
const _: () = assert!(env!("TSONIC_NATIVE_INPUT_TEST").as_bytes()[0] == b's');
pub fn value() -> &'static str { env!("TSONIC_NATIVE_INPUT_TEST") }
`);
  assert.equal(selected.check(["--edition=2024", "--crate-type=lib", source]).phase, "checked");
  const changed = createRustNativeSourceTool({ cacheRoot, environment });
  assert.throws(() => changed.check(["--edition=2024", "--crate-type=lib", source]), /evaluation.*failed|assertion failed/us);
  assert.equal(environment.TSONIC_NATIVE_INPUT_TEST, "changed");
  assert.equal(selected.check(["--edition=2024", "--crate-type=lib", source]).phase, "checked");
});

test("native tracked inputs reject in-compilation changes without fabricating filesystem results", () => {
  const binary = join(root, process.platform === "win32" ? "inputs-test.exe" : "inputs-test");
  const source = fileURLToPath(new URL("../../../../tools/rust-source-provider/test/inputs.rs", import.meta.url));
  const variable = process.platform === "win32" ? "PATH" : process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  const environment = { ...process.env, RUSTC_BOOTSTRAP: "1",
    TSONIC_NATIVE_INPUT_TEST_ROOT: join(root, "native-unit"),
    [variable]: [join(tool.sysroot, "lib"), process.env[variable]].filter(Boolean).join(delimiter) };
  const command = (executable, arguments_) => runRustNativeCommand({ executable, arguments: arguments_,
    environment, directory: root, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 4 * 1024 * 1024 });
  command(process.env.RUSTC ?? "rustc", ["--sysroot", tool.sysroot, "--edition=2024", "--test", "-D", "warnings",
    "-L", `native=${join(tool.sysroot, "lib")}`, "-C", "prefer-dynamic", "-C", "codegen-units=1", source, "-o", binary]);
  assert.match(command(binary, []), /6 passed; 0 failed/u);
});
