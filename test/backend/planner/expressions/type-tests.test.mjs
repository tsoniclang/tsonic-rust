import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustClosedTypeTestMatches } from "../../../../dist/analysis/facts/operations/type-tests.js";
import { planRustClosedTypeTest } from "../../../../dist/backend/planner/expressions/type-tests.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

for (const kind of ["nominal", "array", "error"]) test(`closed ${kind} tests reject missing, forged and reordered test evidence`, () => {
  const operation = kind === "array" ? "Array.isArray(value)" : kind === "error" ? "value instanceof TypeError" : "value instanceof RegExp";
  const type = kind === "error" ? "string | Error | readonly string[] | undefined" : "string | RegExp | readonly string[] | undefined";
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts":
    `export function test(value: ${type}): boolean { return ${operation}; }` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "closed-type-test") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.equal(fact.test.kind, "option");
  assert.equal(fact.test.test.kind, "union");
  const arms = fact.test.test.arms;
  assert.ok(Object.isFrozen(fact.test) && Object.isFrozen(arms) && arms.every(Object.isFrozen));
  const context = { input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
  assert.equal(rustClosedTypeTestMatches(fact, program.projectTypes, program.typeDefinitions), true);
  assert.ok(planRustClosedTypeTest(node, fact, context), JSON.stringify(context.diagnostics));
  const mutatedArms = [[], new Array(arms.length), [null, ...arms.slice(1)], [...arms].reverse(),
    arms.map(arm => ({ ...arm, test: { kind: "constant", value: true } })),
    [{ ...arms[0], variant: { ...arms[0].variant, name: "Forged" } }, ...arms.slice(1)],
  ];
  const cyclic = { kind: "option", element: fact.test.element };
  cyclic.test = cyclic;
  for (const changes of [
    { kind: "builtin-error-type-test" },
    { operationId: "changed" }, { resultCarrier: rustSourcePrimitiveTargetType("int32") },
    { sourceCarrier: fact.predicate.targetCarrier }, { predicate: { kind: "nominal", targetCarrier: rustSourcePrimitiveTargetType("int32") } },
    { predicate: undefined }, { predicate: null }, { predicate: { kind: "unknown" } },
    { predicate: { kind: "error", errorKind: "Unknown" } }, { predicate: { kind: "error", errorKind: "RangeError" } },
    { predicate: { ...fact.predicate, unexpected: true } }, { sourceCarrier: null },
    { test: undefined }, { test: null }, { test: cyclic }, { test: { kind: "constant", value: true } },
    ...mutatedArms.map(selected => ({ test: { ...fact.test, test: { ...fact.test.test, arms: selected } } })),
  ]) {
    const altered = { ...fact, ...changes };
    assert.equal(rustClosedTypeTestMatches(altered, program.projectTypes, program.typeDefinitions), false);
    const selected = { ...context, diagnostics: [] };
    assert.equal(planRustClosedTypeTest(node, altered, selected), undefined);
    assert.ok(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
  }
});
