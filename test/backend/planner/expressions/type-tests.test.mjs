import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { rustClosedTypeTestMatches } from "../../../../dist/analysis/operations/type-tests.js";
import { planRustClosedTypeTest } from "../../../../dist/backend/planner/expressions/type-tests.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustClosedTypeTests } from "../../../../dist/analysis/operations/type-test-emission.js";
import { createRustClosedTypeTestProducer } from "../../../../dist/analysis/program/records/type-tests.js";
import { localProtectedIntrinsicSource } from "../../../../../tsonic/test/fixtures/local-protected-error-regions.mjs";

for (const kind of ["nominal", "array", "error"]) test(`closed ${kind} tests reject missing, forged and reordered test evidence`, () => {
  const operation = kind === "array" ? "Array.isArray(value)" : kind === "error" ? "value instanceof TypeError" : "value instanceof RegExp";
  const type = kind === "error" ? "string | Error | readonly string[] | undefined" : "string | RegExp | readonly string[] | undefined";
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts":
    `export function test(value: ${type}): boolean { return ${operation}; }` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "closed-type-test") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
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
    // A forged operation record never reaches the planner (RULINGS 2026-10-22): the analysis owner either stops at its
    // invariant or seals no emission plan, and the planner then stops at its own invariant.
    const forged = { ...program, records: { ...program.records,
      targetOperation: { get: selected => selected === node ? altered : program.records.targetOperation.get(selected) } } };
    const producer = createRustClosedTypeTestProducer(() => undefined);
    let rejected = false;
    try { analyzeRustClosedTypeTests(forged, [node], producer); }
    catch (error) {
      assert.match(String(error.message), /Type predicate requires its exact selected operation, carrier and retained test plan/u);
      rejected = true;
    }
    if (!rejected) {
      assert.equal(producer.records.closedTypeTestEmission.get(node), undefined, "no emission plan is sealed for a forged record");
      const sealed = { ...program, records: { ...program.records, closedTypeTestEmission: producer.records.closedTypeTestEmission } };
      assert.throws(() => planRustClosedTypeTest(node, altered, { ...context, input: { program: sealed }, diagnostics: [] }),
        /An admitted type predicate requires its native emission plan/u);
    }
  }
});

for (const transparent of [false, true]) test(`caught native error predicates use their completed physical channel (${transparent ? "transparent" : "direct"})`, () => {
  const source = transparent ? localProtectedIntrinsicSource.replace("error instanceof TypeError", "(((error))) instanceof TypeError")
    : localProtectedIntrinsicSource;
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  const ast = program.source.ast;
  const selected = [];
  const visit = node => {
    if (program.records.targetOperation.get(node)?.kind === "closed-type-test") selected.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(selected.length, 1, "the original source has one exact builtin Error-kind predicate");
  const node = selected[0];
  const emission = program.records.closedTypeTestEmission.get(node);
  assert.equal(emission.test.kind === "error" && emission.test.lowering === "native-error" && emission.test.errorKind === "TypeError",
    true, "the native JsError binding is observed through its existing ErrorObject contract, not a package-only method");
  const producer = createRustClosedTypeTestProducer(() => undefined);
  const missing = { ...program, errorRegions: { ...program.errorRegions, get: () => undefined } };
  assert.throws(() => analyzeRustClosedTypeTests(missing, [node], producer),
    /requires its completed protected error region/u, "a missing actual binding region never falls back to a logical Error recipe");
});
