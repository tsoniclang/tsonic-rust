import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustPlanningContext } from "../../../../dist/backend/planner/context.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustPackageFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { planRustSourcePackageErrors } from "../../../../dist/backend/planner/program/source-package-errors.js";
import { rustCurrentErrorBoundary } from "../../../../dist/backend/planner/program/plan-context.js";
import { planThrowStatement, planTryStatement } from "../../../../dist/backend/planner/statements/errors.js";
import { planForInStatement, planForOfStatement, planRuntimeSetStatement } from "../../../../dist/backend/planner/statements/iteration.js";
import { planResourceManagedBody, resourceDisposalReceiverMode, resourceFactForPlanning } from "../../../../dist/backend/planner/statements/resources.js";
import { planRustDirectOperatorCallAssignment, planRustSourceAccessorAssignment } from "../../../../dist/backend/planner/statements/assignments.js";
import { planRustAssignmentWrite } from "../../../../dist/backend/planner/statements/expression-statements.js";
import { validateRustFinalizedOperationAbi } from "../../../../dist/analysis/operations/finalized-operation/validation.js";

const source = `
import type { int32 } from "@tsonic/core/types.js";
class Mutable {
  value: number = 0;
  get count(): number { return this.value; }
  set count(next: number) { this.value = next; }
}
export function throwing(): void { throw new Error("failure"); }
export function trying(): void { try {} finally {} }
export function forOf(values: number[]): void { for (const value of values) {} }
export function forIn(values: number[]): void { for (const key in values) {} }
export function setting(values: number[], value: number): void { values[0] = value; }
export function field(value: Mutable): void { value.value = 1; }
export function access(value: Mutable): void { value.count = 1; }
export function append(value: string): string { value += value; return value; }
export function shifted(value: int32, step: int32): int32 { value >>= step; return value; }
`;

let fixture;
function programFixture() {
  fixture ??= analyzeRust({ surfaces: ["js"], files: { "index.ts": source } }).program;
  return fixture;
}

function nodeIn(program, owner, predicate) {
  const { ast } = program.source;
  let found;
  const visit = (node, currentOwner) => {
    if (ast.is.IsFunctionDeclaration(node)) currentOwner = ast.text(ast.name(node));
    if (currentOwner === owner && predicate(ast, node)) found ??= node;
    for (const child of ast.children(node)) visit(child, currentOwner);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(found !== undefined, true, owner + ": checked construct exists");
  return found;
}

function planContext(program, node, names = true) {
  const { ast } = program.source;
  const input = createRustPlanningContext(program);
  const components = program.sourcePackageComponents.components.map(component => ({
    ...component, sourceFileNames: new Set(component.sourceFileNames), programModuleName: "program",
  }));
  const errors = planRustSourcePackageErrors(input, components);
  assert.equal(errors.diagnostics.length, 0, "the checked package has its actual error plan");
  const context = {
    input, sourceFile: ast.getSourceFile(node), diagnostics: [], usedAliases: new Set(),
    sourcePackageErrors: errors.plan,
    sourcePackageComponentId: program.sourcePackageComponents.rootComponentId,
    ...(names ? { syntheticNames: createRustSyntheticNameState(ast, node, []) } : {}),
    controlFlow: { nextLoopId: 0 }, functionReturnType: { kind: "unit" },
    moduleName: "index", programModuleName: "program", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(),
  };
  context.fallibleBoundary = rustPackageFallibleBoundary(rustCurrentErrorBoundary(context));
  return context;
}

function hideFields(program, subject, view, fields) {
  const { ast } = program.source;
  const selectedView = ast.as[view];
  const changed = { ...ast, as: { ...ast.as, [view]: node => {
    const selected = selectedView(node);
    return node !== subject || selected === undefined ? selected
      : { ...selected, ...Object.fromEntries(fields.map(field => [field, undefined])) };
  } } };
  return { ...program, source: { ...program.source, ast: changed } };
}

function assertInvariant(run, context, message, subject) {
  let returned = false;
  let failure;
  try {
    run();
    returned = true;
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT", "typed invariant transport");
  assert.equal(failure.diagnostic.category, "error");
  assert.equal(failure.diagnostic.source, "tsonic-rust");
  assert.equal(failure.diagnostic.message, message, "the exact original message");
  assert.equal(failure.diagnostic.sourceNode === subject, true, "the exact source identity");
  assert.equal(returned, false, "no result or partial statement is returned");
  assert.equal(context.diagnostics.length, 0, "no source rejection is appended");
}

test("checked throw, try and iteration selections plan with complete backend state", () => {
  const program = programFixture();
  for (const [owner, kind, plan] of [
    ["throwing", "IsThrowStatement", planThrowStatement],
    ["trying", "IsTryStatement", planTryStatement],
    ["forOf", "IsForOfStatement", planForOfStatement],
    ["forIn", "IsForInStatement", planForInStatement],
  ]) {
    const node = nodeIn(program, owner, (ast, candidate) => ast.is[kind](candidate));
    const context = planContext(program, node);
    const planned = plan(node, context);
    assert.equal(planned !== undefined && planned.length > 0, true, owner + ": planned result");
    assert.equal(context.diagnostics.length, 0, owner + ": no diagnostics");
  }
});

test("an admitted throw cannot lose its mandatory source expression", () => {
  const program = programFixture();
  const node = nodeIn(program, "throwing", (ast, candidate) => ast.is.IsThrowStatement(candidate));
  const context = planContext(hideFields(program, node, "AsThrowStatement", ["Expression"]), node);
  assertInvariant(() => planThrowStatement(node, context), context,
    "Finalized throw fact has no exact source expression.", node);
});

test("checked try syntax cannot lose its body or all cleanup clauses", () => {
  const program = programFixture();
  const node = nodeIn(program, "trying", (ast, candidate) => ast.is.IsTryStatement(candidate));
  for (const fields of [["TryBlock"], ["FinallyBlock", "CatchClause"]]) {
    const context = planContext(hideFields(program, node, "AsTryStatement", fields), node);
    assertInvariant(() => planTryStatement(node, context), context,
      "try statements require a finalized body and either catch or finally clause.", node);
  }
});

test("try lowering requires the backend's own name scope", () => {
  const program = programFixture();
  const node = nodeIn(program, "trying", (ast, candidate) => ast.is.IsTryStatement(candidate));
  const context = planContext(program, node, false);
  assertInvariant(() => planTryStatement(node, context), context,
    "Try statement lowering requires a finalized hygienic-name scope.", node);
});

test("runtime setter selection retains exact operand nodes and prior ABI admission", () => {
  const program = programFixture();
  const node = nodeIn(program, "setting", (_ast, candidate) => program.records.targetOperation.get(candidate)?.kind === "runtime-set");
  const fact = program.records.targetOperation.get(node);
  const accepted = planContext(program, node);
  assert.equal(validateRustFinalizedOperationAbi(fact.abi, program.typeDefinitions), true);
  assert.equal(planRuntimeSetStatement(node, fact, accepted)?.length > 0, true);
  assert.equal(accepted.diagnostics.length, 0);
  for (const field of ["Left", "Right"]) {
    const context = planContext(hideFields(program, node, "AsBinaryExpression", [field]), node);
    assertInvariant(() => planRuntimeSetStatement(node, fact, context), context,
      "Runtime setter fact requires concrete assignment target and value nodes.", node);
  }
  const malformed = { ...fact, abi: { ...fact.abi,
    target: { form: "call", path: "fixture::set", chain: [{ kind: "copy-selected-carrier" }] } } };
  assert.equal(validateRustFinalizedOperationAbi(malformed.abi, program.typeDefinitions), false);
  const rejected = planContext(program, node);
  assert.equal(planRuntimeSetStatement(node, malformed, rejected) === undefined, true);
  assert.equal(rejected.diagnostics.length, 1);
  assert.equal(rejected.diagnostics[0].evidence.includes("target.capability=rust.backend.runtime-set-abi"), true,
    "the existing ABI owner rejects an invalid chain before the removed redundant consumer guard");
});

test("admitted iteration cannot lose mandatory body and binding syntax", () => {
  const program = programFixture();
  for (const [owner, kind, view, field, plan, message] of [
    ["forOf", "IsForOfStatement", "AsForOfStatement", "Statement", planForOfStatement,
      "for-of statements require a concrete source body."],
    ["forIn", "IsForInStatement", "AsForInStatement", "Initializer", planForInStatement,
      "for-in requires one exact binding initializer."],
  ]) {
    const node = nodeIn(program, owner, (ast, candidate) => ast.is[kind](candidate));
    const context = planContext(hideFields(program, node, view, [field]), node);
    assertInvariant(() => plan(node, context), context, message, node);
  }
});

test("assignment name scopes are backend state, not new source restrictions", () => {
  const program = programFixture();
  for (const [owner, message, call] of [
    ["shifted", "Fallible compound assignment requires a finalized hygienic-name scope.",
      (node, left, right, fact, context) => planRustDirectOperatorCallAssignment(left,
        { kind: "path", path: "value" }, { kind: "path", path: "step" }, fact, context)],
    ["access", "Project accessor assignment requires a finalized hygienic-name scope.",
      (_node, left, right, fact, context) => planRustSourceAccessorAssignment(left, right,
        program.records.targetOperation.get(left), fact, context)],
    ["field", "Project-source field assignment requires a finalized hygienic-name scope.",
      planRustAssignmentWrite],
    ["append", "String compound assignment requires one finalized hygienic-name scope.",
      planRustAssignmentWrite],
  ]) {
    const node = nodeIn(program, owner, (ast, candidate) => ast.is.IsBinaryExpression(candidate));
    const left = BinaryExpression_Left(program.source.ast, node);
    const right = BinaryExpression_Right(program.source.ast, node);
    const fact = program.records.targetOperation.get(node);
    const accepted = planContext(program, node);
    const planned = call(node, left, right, fact, accepted);
    assert.equal(planned !== undefined && planned.length > 0, true, owner + ": checked success path");
    assert.equal(accepted.diagnostics.length, 0, owner + ": no diagnostics");
    const context = planContext(program, node, false);
    assertInvariant(() => call(node, left, right, fact, context), context, message,
      owner === "append" ? node : left);
  }
});

test("resource producer facts retain exact identity and backend state ownership", () => {
  const { context: analyzed } = analyzeRustOperations(`
    class Resource { constructor() {} [Symbol.dispose](): void {} }
    export function resource(): void { using resource = new Resource(); }
  `, { surfaces: [] });
  const declaration = analyzed.sourceStorage.nodes.find(node => analyzed.ast.is.IsVariableDeclaration(node) &&
    analyzed.ast.variableDeclarationKind(node) === "using");
  assert.equal(declaration !== undefined, true, "the real resource producer analyzed the checked declaration");
  const records = analyzed.records.seal(analyzed.requiredRecords);
  const fact = records.resourceManagement.get(declaration);
  assert.equal(fact !== undefined, true, "the real producer published a disposal fact");
  assert.equal(fact === analyzed.records.resourceManagement.get(declaration), true, "sealing retains producer identity");
  assert.equal(fact.disposal.kind, "sync");
  assert.equal(fact.disposal.fallible, false);
  const sourceFile = analyzed.ast.getSourceFile(declaration);
  const context = {
    input: { program: { source: analyzed.source, records } }, sourceFile,
    diagnostics: [], functionReturnType: { kind: "unit" },
  };
  assert.equal(resourceFactForPlanning(declaration, context) === fact, true, "the exact producer fact is read");
  assert.equal(resourceDisposalReceiverMode(fact) === "ref" || resourceDisposalReceiverMode(fact) === "mut-ref", true);
  const missing = { ...context, diagnostics: [], input: { program: { ...context.input.program,
    records: createRustRecordFixture({ resourceManagement: { get: () => undefined } }, records),
  } } };
  assertInvariant(() => resourceFactForPlanning(declaration, missing), missing,
    "Resource declaration has no finalized exact Rust disposal fact.", declaration);
  assertInvariant(() => planResourceManagedBody(declaration, "resource", fact, context,
    () => ({ statements: [] })), context,
  "Resource management requires a finalized hygienic-name scope.", declaration);
  const invalid = { ...fact, disposal: { ...fact.disposal,
    target: { form: "provider", target: { form: "call", path: "fixture::dispose" } } } };
  assert.equal(resourceDisposalReceiverMode(invalid) === undefined, true);
  const rejected = { ...context, diagnostics: [],
    syntheticNames: createRustSyntheticNameState(analyzed.ast, declaration, []),
  };
  assert.equal(planResourceManagedBody(declaration, "resource", invalid, rejected,
    () => ({ statements: [] })) === undefined, true);
  assert.equal(rejected.diagnostics.length, 1);
  assert.equal(rejected.diagnostics[0].message,
    "Finalized resource disposal target has no closed Rust receiver mode. Node kind: KindSourceFile.",
    "the existing canonical receiver-mode guard remains unchanged");
});
