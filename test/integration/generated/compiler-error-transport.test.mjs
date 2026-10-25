import { createRustRecordFixture } from "../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

import { rustJsErrorTargetType, rustProgramErrorTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { planThrowStatement } from "../../../dist/backend/planner/statements/statement-try.js";
import { caughtErrorProofFiles } from "../../../../tsonic/test/fixtures/caught-errors.mjs";
import { selectRustFlowReadProjection } from "../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { rustFlowReadProjectionMatches } from "../../../dist/analysis/control-flow/flow-read-projections.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { admitRustThrowCompletion } from "../../../dist/analysis/errors/throw-admission.js";
import { rustProgramErrorConversionMatches, rustProgramErrorRuntimeRouteMatches } from "../../../dist/policy/conversions/program-error.js";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import { planRustErrorRegion } from "../../../dist/backend/planner/program/error-regions.js";

for (const surfaces of [[], ["js"]]) {
  test(`caught builtin Errors retain identity and stack in the ${surfaces.length === 0 ? "native" : "JS"} profile`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "caught_errors" } },
      files: { ...caughtErrorProofFiles, "index.ts": (`${caughtErrorProofFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("caught Error transport"); }` + "\nmain();\n") },
    });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.equal(validateGeneratedProject(`caught-errors-${surfaces.length}`, result.artifacts, { run: true }).status, 0);
  });
  test(`stored Error values cross native throw boundaries in the ${surfaces.length === 0 ? "native" : "JS"} profile`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "error_transport" } },
      files: {
        "failures.ts": `
export function fail(error: Error): void { throw error; }
export function create(): Error { return new Error("returned"); }
`,
        "index.ts": `
import { check } from "@acme/testing";
import { create, fail } from "./failures.js";
export function main(): void {
  const original = new Error("stored");
  const alias = original;
  const before = original.stack;
  let caught = 0;
  let cleaned = 0;
  try { throw original; } catch { caught += 1; }
  try { throw (alias); } catch { caught += 1; }
  try { fail(alias); } catch { caught += 1; }
  try { throw create(); } catch { caught += 1; }
  try {
    try { fail(original); } catch (error) { throw error; }
    finally { cleaned += 1; }
  } catch { caught += 1; }
  try { throw new Error("direct"); } catch { caught += 1; }
  ${surfaces.length === 0 ? "" : `try { const subtype = new RangeError("bounds"); fail(subtype); } catch { caught += 1; }`}
  check(caught === ${surfaces.length === 0 ? 6 : 7} && cleaned === 1);
  check(original === alias && original.message === "stored" && original.stack === before);
}
main();
`,
      },
    });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.equal(validateGeneratedProject(`error-transport-${surfaces.length}`, result.artifacts, { run: true }).status, 0);
  });
}

test("closed program errors distinguish native subtypes from ordinary thrown objects", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "caught_error_variants" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class PanicValue {
  code: number;
  constructor(code: number) { this.code = code; }
}
function panic(): void { throw new PanicValue(7); }
export function main(): void {
  const original = new RangeError("bounds");
  const stack = original.stack;
  let matches = 0;
  try { throw original; }
  catch (failure) {
    check(!(failure instanceof TypeError));
    check(failure instanceof Error);
    if (failure instanceof RangeError) {
      check(failure === original && failure.stack === stack && failure.message === "bounds");
      matches += 1;
    }
  }
  try { panic(); }
  catch (failure) {
    check(!(failure instanceof Error));
    if (failure instanceof PanicValue) { check(failure.code === 7); matches += 1; }
  }
  check(matches === 2);
}
main();
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(validateGeneratedProject("caught-error-variants", result.artifacts, { run: true }).status, 0);
});

test("inherited mutable Error storage retains its original owner during catch narrowing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ files: { "index.ts": `
class NamedError extends Error {
  constructor() { super("original"); this.message = "changed"; }
}
export function run(): string {
  try { throw new NamedError(); }
  catch (failure) { if (failure instanceof Error) return failure.message; }
  return "other";
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("inherited-error-storage", result.artifacts);
});

test("builtin catch projections require the exact sealed selected carrier", () => {
  const sourceCarrier = rustProgramErrorTargetType();
  const selectedCarrier = rustSourceErrorTargetType();
  const policy = { sourceErrorCarrier: () => selectedCarrier, sourceErrorDefinitions: [], sourceCreatedErrorOrigins: [], definitionForCarrier: () => undefined };
  const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, policy);
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "builtin-error");
  for (const unavailableCarrier of [rustStringTargetType(), undefined]) {
    assert.equal(selectRustFlowReadProjection(sourceCarrier, selectedCarrier,
      { ...policy, sourceErrorCarrier: () => unavailableCarrier }).kind, "incompatible");
    // The sealed projection is re-validated by the flow-read emission analysis (its refusal is "Value projection
    // conflicts with its exact sealed native carrier relation."); the planner only renders admitted projections.
    assert.equal(rustFlowReadProjectionMatches(selected.fact, { ...policy, sourceErrorCarrier: () => unavailableCarrier },
      emptyRustTypeDefinitions), false);
  }
  assert.equal(rustFlowReadProjectionMatches(selected.fact, policy, emptyRustTypeDefinitions), true);
});

test("runtime throw facts bind the exact operand and native Error carrier", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function fail(error: Error): void { throw error; }
` } });
  const { ast } = program.source;
  const declarations = program.source.sourceFiles.flatMap(file => ast.statements(file));
  const declaration = declarations.find(node => ast.text(ast.name(node)) === "fail");
  assert.equal(declaration !== undefined, true, "selected source function declaration exists");
  const statement = ast.statements(ast.body(declaration))[0];
  const fact = program.records.targetOperation.get(statement);
  assert.equal(fact.kind, "throw-op");
  assert.equal(fact.error.kind, "conversion");
  assert.deepEqual(fact.error.conversion.route, { kind: "runtime", boundary: "target-runtime" });
  assert.equal(fact.error.expression === Node_Expression(ast, statement), true,
    "throw facts retain the exact original source expression");
  assert.deepEqual(fact.error.conversion.source, rustJsErrorTargetType());
  assert.ok(Object.isFrozen(fact));
  const completion = program.records.throwCompletion.get(statement);
  const region = program.errorRegions.get(declaration);
  assert.equal(completion?.operation === fact, true, "the completed throw retains its original selected source fact");
  const selected = rustSourceFilePlanContext(program, statement);
  const renderedRegion = planRustErrorRegion(declaration, selected);
  assert.equal(renderedRegion !== undefined, true, "the checked throw has its actual sealed native error region");
  const rendered = planThrowStatement(statement, { ...selected, callableDeclaration: declaration,
    fallibleBoundary: renderedRegion.boundary });
  assert.equal(rendered.length, 1, "one admitted throw produces one native throw");
  assert.equal(rendered[0].kind, "throw");
  assertNoTargetDiagnostics(selected.diagnostics);
  const invariant = message => failure => failure?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
    message.test(failure.diagnostic.message);
  for (const [label, error, message] of [
    ["wrong source operand", { ...fact.error, expression: declaration }, /exact selected source operation/u],
    ["wrong native carrier", { ...fact.error, conversion: { ...fact.error.conversion, source: rustStringTargetType() } },
      /exact selected native operand carrier/u],
    ["wrong native error domain", { ...fact.error, conversion: { ...fact.error.conversion,
      route: { kind: "runtime", boundary: "provider-native" } } }, undefined],
  ]) {
    const records = createRustRecordFixture({
targetOperation: { get: (subject) => subject === statement
    ? { ...fact, error } : program.records.targetOperation.get(subject) }}, program.records);
    if (message !== undefined) {
      let admitted;
      assert.throws(() => {
        admitted = admitRustThrowCompletion({ ast, records, region,
          componentId: selected.sourcePackageComponentId }, statement);
      }, invariant(message), label);
      assert.equal(admitted === undefined, true, label + ": no malformed completion is returned for publication");
    } else {
      assert.equal(rustProgramErrorConversionMatches(error.conversion, fact.error.conversion.source,
        fact.error.conversion.target, program.typeDefinitions), false, label);
      assert.equal(rustProgramErrorRuntimeRouteMatches(error.conversion.route, error.conversion.source,
        program.providerErrorCarriers), false, label + ": a builtin Error cannot impersonate a provider-native failure");
    }
    assert.equal(program.records.targetOperation.get(statement) === fact, true, label + ": original operation is unchanged");
    assert.equal(program.records.throwCompletion.get(statement) === completion, true, label + ": invalid evidence cannot replace the admitted completion");
  }
});
