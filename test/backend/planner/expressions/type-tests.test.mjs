import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { rustClosedTypeTestMatches } from "../../../../dist/analysis/operations/type-tests.js";
import { planRustClosedTypeTest } from "../../../../dist/backend/planner/expressions/type-tests.js";
import { planRustFlowReadProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustClosedTypeTests } from "../../../../dist/analysis/operations/type-test-emission.js";
import { createRustClosedTypeTestProducer } from "../../../../dist/analysis/program/records/type-tests.js";
import { localProtectedIntrinsicSource } from "../../../../../tsonic/test/fixtures/local-protected-error-regions.mjs";
import { nativeErrorCatchSource } from "../../../../../tsonic/test/fixtures/native-error-catch.mjs";
import { bigintTruncationSource } from "../../../../../tsonic/test/fixtures/bigint-truncation.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustJsErrorTargetType } from "../../../../dist/target-model/types/index.js";

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
  const context = { input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
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
  const missing = { ...program, records: { ...program.records, catchBinding: { get: () => undefined } } };
  assert.throws(() => analyzeRustClosedTypeTests(missing, [node], producer),
    /requires its completed protected error region/u, "a missing actual binding region never falls back to a logical Error recipe");
});

test("caught generic error observations publish one admitted native input conversion", () => {
  const { program } = analyzeRust({ files: { "index.ts": nativeErrorCatchSource } });
  const ast = program.source.ast;
  const catches = [];
  const visit = node => {
    if (ast.is.IsCatchClause(node)) catches.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(catches.length, 1, "the actual callback fixture owns exactly one catch");
  const selected = program.records.catchBinding.get(catches[0]);
  assert.equal(selected?.inputCarrier.kind, "associated-type", "the callback error retains its actual associated input");
  assert.equal(selected?.conversion !== undefined && rustTargetTypeRefEquals(selected.readCarrier, selected.conversion.target), true,
    "all observations share the one admitted caught destination rather than converting individual reads");
  assert.equal(selected.readCarrier.errorOwner?.kind === "physical" && selected.readCarrier.errorOwner.domain === "runtime", true,
    "the existing native input Into bound supplies its exact physical runtime error owner");
});

test("unused and rethrown native input errors retain their original physical channel", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function ignored(callback: () => void): void {
      try { callback(); } catch (error) { void error; }
    }
    export function rethrown(callback: () => void): void {
      try { callback(); } catch (error) { throw error; }
    }
  ` } });
  const ast = program.source.ast;
  let count = 0;
  const visit = node => {
    if (ast.is.IsCatchClause(node)) {
      count += 1;
      const selected = program.records.catchBinding.get(node);
      assert.equal(selected?.inputCarrier.kind, "associated-type", "the original input keeps its exact native error");
      assert.equal(selected.conversion, undefined, "discarding or rethrowing alone introduces no conversion");
      assert.equal(rustTargetTypeRefEquals(selected.inputCarrier, selected.readCarrier), true,
        "the catch's source and read stay identical without an observation demand");
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(count, 2, "both native input catch controls are present");
});

test("concrete native Error catch projections preserve their exact payload carrier", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": bigintTruncationSource.replace(
    "rejected = error instanceof RangeError;", "rejected = error instanceof Error && error.message.length > 0;") } });
  const ast = program.source.ast;
  let catches = 0;
  let projections = 0;
  const visit = node => {
    if (ast.is.IsCatchClause(node)) {
      catches += 1;
      const selected = program.records.catchBinding.get(node);
      assert.equal(selected?.conversion, undefined, "native ErrorObject observation needs no program-error conversion");
      assert.equal(rustTargetTypeRefEquals(selected.readCarrier, rustJsErrorTargetType()), true,
        "the actual protected intrinsic's JsError remains its native read payload");
    }
    const projection = program.records.flowReadProjection.get(node);
    if (projection?.kind === "builtin-error") {
      projections += 1;
      assert.equal(program.records.flowReadEmission.get(projection)?.kind, "identity",
        "narrowing an already-native Error keeps the payload rather than invoking a package projection");
      const ownership = program.records.readOwnership.get(node);
      assert.equal(ownership?.value.kind, "borrow", "the physical native Error observation already owns an exact sealed borrow");
      const expression = { kind: "path", path: "caught" };
      const context = { input: { program }, diagnostics: [] };
      assert.equal(planRustFlowReadProjection(node, expression, projection, context) === expression, true,
        "the renderer consumes the existing borrow without cloning its native Error payload");
      for (const kind of ["move", "clone", "copy"]) {
        const selected = { ...program, records: { ...program.records, readOwnership: {
          get: candidate => candidate === node ? { ...ownership, value: { kind } } : program.records.readOwnership.get(candidate),
        } } };
        const rendered = planRustFlowReadProjection(node, expression, projection, { ...context, input: { program: selected } });
        if (kind === "move") assert.equal(rendered === expression, true, "an existing move is still direct");
        else {
          assert.equal(rendered.kind, "method-call", `${kind}: the pre-existing non-borrow rendering is unchanged`);
          assert.equal(rendered.method, "clone", `${kind}: this fix does not redesign non-borrow read semantics`);
          assert.equal(rendered.receiver === expression, true, `${kind}: the exact source is retained`);
          assert.equal(rendered.args.length, 0, `${kind}: no adapter arguments are introduced`);
        }
      }
      const withoutOwnership = { ...program, records: { ...program.records, readOwnership: {
        get: () => assert.fail("explicit borrowing and overrides do not demand a read-ownership record"),
      } } };
      const explicit = { ...context, input: { program: withoutOwnership } };
      assert.equal(planRustFlowReadProjection(node, expression, projection, explicit, true) === expression, true,
        "explicit borrowing retains its original lookup short circuit");
      const override = { kind: "path", path: "selected_catch" };
      assert.equal(planRustFlowReadProjection(node, expression, projection, { ...explicit, flowReadOverrides: new Map([
        [node, { sourceCarrier: projection.sourceCarrier, selectedCarrier: projection.selectedCarrier, expression: override }],
      ]) }) === override, true, "the exact branch-local override remains the first fast path");
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(catches, 1, "the exact intrinsic fixture contains its original catch");
  assert.equal(projections, 1, "the actual checked Error member access uses its sole admitted payload projection");
});
