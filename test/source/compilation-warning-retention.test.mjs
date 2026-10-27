import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the real compilation boundary retains a contract-injected analysis warning on formatter failure", () => {
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const moduleUrl = pathToFileURL(resolve("dist/analysis/program/target-program.js")).href;
const sessionUrl = pathToFileURL(resolve("dist/compilation/session.js")).href;
const state = { hooks: 0, sessionHooks: 0, compilations: 0, warnings: 0,
  warning: undefined, node: undefined, boundary: undefined };
globalThis[Symbol.for("tsonic.formatter-warning-contract")] = state;
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url === sessionUrl) {
    state.sessionHooks++;
    const text = String(loaded.source);
    const signature = "export function createRustCompilationSession(";
    assert.equal(text.split(signature).length - 1, 1, "the actual session export is found exactly once");
    return { ...loaded, source: text.replace(signature, "function createRustCompilationSessionBeforeObservation(") + \`
export function createRustCompilationSession(...args) {
  const session = createRustCompilationSessionBeforeObservation(...args);
  return Object.freeze({ ...session, compile(input) {
    const result = session.compile(input);
    const state = globalThis[Symbol.for("tsonic.formatter-warning-contract")];
    state.compilations++;
    state.boundary = result;
    return result;
  } });
}
\` };
  }
  if (url !== moduleUrl) return loaded;
  state.hooks++;
  const text = String(loaded.source);
  const signature = "export function analyzeRustTargetProgram(";
  assert.equal(text.split(signature).length - 1, 1, "the actual analysis export is found exactly once");
  return { ...loaded, source: text.replace(signature, "function analyzeRustTargetProgramBeforeWarning(") + \`
import { rustPolicyTargetDiagnostic } from "../../policy/operations/contracts.js";
export function analyzeRustTargetProgram(request) {
  const result = analyzeRustTargetProgramBeforeWarning(request);
  if (result.kind !== "resolved") return result;
  const state = globalThis[Symbol.for("tsonic.formatter-warning-contract")];
  const node = result.value.sourceFiles[0];
  if (node === undefined) throw new Error("The checked compilation supplied no source file.");
  const warning = rustPolicyTargetDiagnostic({
    extensionId: "tsonic.formatter-warning-contract", extensionCode: "FORMAT_CONTRACT_WARNING",
    numericCode: 99901, category: "warning", message: "A contract-injected analysis warning.",
    nodeOrSpan: node, evidence: [{ message: "test.contract=formatter-warning-retention" }],
  });
  state.warnings++;
  state.warning = warning;
  state.node = node;
  return resolvedTargetStage(result.value, [...result.diagnostics, warning]);
}
\` };
} });
process.env.RUSTFMT = "/definitely/missing/tsonic-contract-formatter";
const { compileRust } = await import(pathToFileURL(resolve("test/helpers/rust-session.mjs")).href);
const { result } = compileRust({
  files: { "index.ts": "export function value(): number { return 1; }" },
});
assert.equal(state.hooks, 1, "the real analysis module is intercepted exactly once");
assert.equal(state.sessionHooks, 1, "the real session factory is observed exactly once");
assert.equal(state.compilations, 1, "one actual compilation result is observed without transformation");
assert.equal(state.warnings, 1, "one successful real analysis receives one contract warning");
assert.equal(state.warning?.category, "warning", "the actual contract adapter creates the warning");
assert.equal(state.warning.sourceNode === state.node, true, "the adapter retains the checked source node");
assert.equal(result.artifacts.length, 0, "formatting failure returns no partial artifacts");
assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code),
  ["FORMAT_CONTRACT_WARNING", "RUST_SOURCE_FORMATTING_FAILED"]);
assert.equal(state.boundary.diagnostics[0] === state.warning, true,
  "the genuine session result retains the original warning before bounded test-helper inspection");
assert.equal(result.diagnostics[0].sourceNode === state.node, true, "bounded inspection preserves the checked source identity");
assert.equal(result.diagnostics[1].source, "tsonic-rust");
assert.equal(result.diagnostics[1].category, "error");
assert.match(result.diagnostics[1].message, /Unable to execute Rust formatter/u);
assert.deepEqual(result.diagnostics[1].evidence, ["target.capability=rust.toolchain.rustfmt"]);
console.log(JSON.stringify({ hooks: state.hooks, sessionHooks: state.sessionHooks,
  compilations: state.compilations, warnings: state.warnings,
  diagnostics: result.diagnostics.map(diagnostic => diagnostic.code) }));
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8",
    timeout: 60_000, maxBuffer: 1_048_576,
  });
  assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
  const proof = JSON.parse(result.stdout.trim());
  assert.equal(proof.hooks, 1);
  assert.equal(proof.sessionHooks, 1);
  assert.equal(proof.compilations, 1);
  assert.equal(proof.warnings, 1);
  assert.deepEqual(proof.diagnostics, ["FORMAT_CONTRACT_WARNING", "RUST_SOURCE_FORMATTING_FAILED"]);
});
