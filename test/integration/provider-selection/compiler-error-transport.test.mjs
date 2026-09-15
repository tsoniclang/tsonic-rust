import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { planThrowStatement } from "../../../dist/backend/planner/statements/errors.js";
import { caughtErrorProofFiles } from "../../../../tsonic/test/fixtures/caught-errors.mjs";
import { broadValueNarrowingSource } from "../../../../tsonic/test/fixtures/broad-value-narrowing.mjs";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../dist/backend/planner/expressions/flow-reads.js";

for (const surfaces of [[], ["js"]]) {
  test(`non-nullish unknown retains its value and identity in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "broad_value_narrowing" } },
      files: { "index.ts": `${broadValueNarrowingSource}
export function main(): void { if (!run()) throw new Error("broad value narrowing"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`broad-value-narrowing-${surfaces.length}`, result.artifacts, { run: true }).status, 0);
  });
  test(`caught builtin Errors retain identity and stack in the ${surfaces.length === 0 ? "native" : "JS"} profile`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "caught_errors" } },
      files: { ...caughtErrorProofFiles, "index.ts": `${caughtErrorProofFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("caught Error transport"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
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
`,
      },
    });
    assert.deepEqual(result.diagnostics, []);
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
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("caught-error-variants", result.artifacts, { run: true }).status, 0);
});

test("inherited mutable Error storage cannot be silently reconstructed during catch narrowing", () => {
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
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_BUILTIN_ERROR_INHERITED_STORAGE"),
    JSON.stringify(result.diagnostics));
  assert.equal(result.artifacts.length, 0);
});

test("builtin catch projections require the sealed availability and exact selected carrier", () => {
  const sourceCarrier = rustProgramErrorTargetType();
  const selectedCarrier = rustJsErrorTargetType();
  const policy = { builtinErrorProjectionAvailable: true, definitionForCarrier: () => undefined };
  const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, policy);
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "builtin-error");
  for (const available of [false, undefined]) {
    assert.equal(selectRustFlowReadProjection(sourceCarrier, selectedCarrier,
      { ...policy, builtinErrorProjectionAvailable: available }).kind, "incompatible");
    const diagnostics = [];
    const node = {};
    assert.equal(planRustFlowReadProjection(node, { kind: "path", path: "caught" }, selected.fact, {
      input: { program: { facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
        projectTypes: { ...policy, builtinErrorProjectionAvailable: available },
        source: { ast: { getFileName: () => "", getSourceText: () => "", pos: () => -1,
          end: () => -1, kindName: () => "KindIdentifier" } } } },
      diagnostics,
    }), undefined);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0].message, /contradictory native carriers/u);
  }
});

test("runtime throw facts bind the exact operand and native Error carrier", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function fail(error: Error): void { throw error; }
` } });
  const { ast } = program.source;
  const declarations = program.source.sourceFiles.flatMap(file => ast.statements(file));
  const declaration = declarations.find(node => ast.text(ast.name(node)) === "fail");
  assert.ok(declaration);
  const statement = ast.statements(ast.body(declaration))[0];
  const fact = program.facts.getFact(statement, rustTargetOperationFactKey);
  assert.equal(fact.kind, "throw-op");
  assert.equal(fact.error.kind, "runtime");
  assert.equal(fact.error.expression, Node_Expression(ast, statement));
  assert.deepEqual(fact.error.carrier, rustJsErrorTargetType());
  assert.ok(Object.isFrozen(fact));
  for (const error of [
    { ...fact.error, expression: declaration },
    { ...fact.error, carrier: rustStringTargetType() },
  ]) {
    const diagnostics = [];
    const facts = {
      ...program.facts,
      getFact: (subject, key) => subject === statement && key === rustTargetOperationFactKey
        ? { ...fact, error } : program.facts.getFact(subject, key),
    };
    assert.equal(planThrowStatement(statement, {
      input: { program: { ...program, facts } },
      sourceFile: ast.getSourceFile(statement), diagnostics,
      fallibleBoundary: { componentId: "source", errorDomain: "runtime", errorTypePath: "rt::TsonicError" },
    }), undefined);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0].message, /exact source operand or native Error carrier/u);
  }
});
