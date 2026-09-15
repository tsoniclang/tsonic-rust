import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustJsErrorTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { planThrowStatement } from "../../../dist/backend/planner/statements/errors.js";

for (const surfaces of [[], ["js"]]) {
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
