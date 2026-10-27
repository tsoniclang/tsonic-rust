import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture, rustNativeFixtureNodes } from "../../../helpers/records.mjs";
import { rustProgramSourceFiles, rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { createRustPlanningContext } from "../../../../dist/backend/planner/context.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustPackageFallibleBoundary } from "../../../../dist/backend/planner/program/fallible-boundaries.js";
import { planRustSourcePackageErrors } from "../../../../dist/backend/planner/program/source-package-errors.js";
import { rustCurrentErrorBoundary } from "../../../../dist/backend/planner/program/plan-context.js";
import { planThrowStatement, planTryStatement } from "../../../../dist/backend/planner/statements/statement-try.js";
import { planForInStatement, planForOfStatement, planRuntimeSetStatement } from "../../../../dist/backend/planner/statements/statement-loops.js";
import { planResourceManagedBody, resourceDisposalReceiverMode, resourceFactForPlanning } from "../../../../dist/backend/planner/statements/resource-management.js";
import { planRustDirectOperatorCallAssignment, planRustSourceAccessorAssignment } from "../../../../dist/backend/planner/statements/assignments.js";
import { planRustAssignmentWrite } from "../../../../dist/backend/planner/statements/assignment-writes.js";
import { validateRustFinalizedOperationAbi } from "../../../../dist/policy/operations/members/abi/validation.js";
import { analyzeRustStatementCompletions } from "../../../../dist/analysis/control-flow/statement-completion.js";
import { analyzeRustCountedLoopRepresentations } from "../../../../dist/analysis/control-flow/counted-loop-representations.js";
import { createRustStatementCompletionProducer } from "../../../../dist/analysis/program/records/operations/statement-completion.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { analyzeRustProgramErrorModuleEmission } from "../../../../dist/analysis/errors/module-emission.js";
import { planStatement } from "../../../../dist/backend/planner/statements/planning.js";
import { finalizeRustProviderOperationAbi } from "../../../../dist/policy/operations/members/abi/finalize.js";
import { finishProviderOperationExpression } from "../../../../dist/backend/planner/expressions/conversions.js";

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
  for (const file of rustProgramSourceFiles(program)) visit(file);
  assert.equal(found !== undefined, true, owner + ": checked construct exists");
  return found;
}

function planContext(program, node, names = true) {
  // The sealed program's own source-file context, as the planner builds it.
  const context = rustSourceFilePlanContext(program, node, {
    controlFlow: { nextLoopId: 0 }, functionReturnType: { kind: "unit" },
    ...(names ? {} : { syntheticNames: undefined }),
  });
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

// Re-runs the statement-completion owner over the analysis program with the same inputs the target program passes.
function admitStatements(program) {
  const ordered = rustNativeFixtureNodes(program);
  const nativeNodes = new Set(ordered);
  return analyzeRustStatementCompletions({ source: program.source, sourceFiles: program.sourceFiles,
    isNativeNode: node => nativeNodes.has(node),
    records: program.records, names: program.names, typeDefinitions: program.typeDefinitions,
    errorRegions: program.errorRegions, projectFlowReadSelections: program.projectFlowReadSelections,
    producer: createRustStatementCompletionProducer(() => {}), required: [],
    safetyApplications: program.safetyApplications, components: program.sourcePackageComponents,
    ownership: program.ownership, projectTypes: program.projectTypes, projectFieldDispatch: program.projectFieldDispatch,
    structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites,
    countedLoops: analyzeRustCountedLoopRepresentations({ ast: program.source.ast, nativeNodes: ordered,
      navigation: program.source.navigation, records: program.records, borrowedElementReads: program.borrowedElementReads }) });
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

test("statement planning respects the same erased and compile-time domain as admission", () => {
  const program = programFixture();
  const node = nodeIn(program, "trying", (ast, candidate) => ast.is.IsTryStatement(candidate));
  for (const family of ["compileTimeSource", "nativeParticipation"]) {
    const changed = { ...program, records: createRustRecordFixture({ [family]: { get: subject =>
      subject === node ? family === "compileTimeSource" ? { kind: "compile-time" } : "erased"
        : program.records[family].get(subject) } }, program.records), statementCompletions: {
      ...program.statementCompletions, admitted: () => { throw new Error("An erased statement cannot enter runtime dispatch."); },
    } };
    const context = planContext(changed, node);
    assert.equal(planStatement(node, context)?.length, 0, `${family}: no runtime statement is emitted`);
    assert.equal(context.diagnostics.length, 0, `${family}: no new source rejection is introduced`);
  }
});

test("native provider error renderability remains a precise diagnostic rather than an unproven invariant", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    class ProgramFailure { code: number = 1; }
    export function throwing(): void { throw new ProgramFailure(); }
  ` } });
  const node = nodeIn(program, "throwing", (ast, candidate) => ast.is.IsThrowStatement(candidate));
  const context = planContext(program, node);
  const errorCarrier = { kind: "target-named", id: "fixture.UnresolvedError" };
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "fixture::dispose" }, sourceArgumentCarriers: [],
    resultCarrier: { kind: "tuple", elements: [] }, isAsync: false, isFallible: true,
    errorBoundary: "provider-native", errorCarrier,
  }, program.typeDefinitions);
  assert.equal(abi !== undefined, true, "structural carrier validity does not prove contextual native rendering");
  const errors = program.records.sourcePackageErrors.get();
  assert.equal(errors !== undefined, true, "the real source program supplies the native error domains");
  const producer = createRustProgramRecordBuilder(program.typeDefinitions);
  let domains = 0;
  for (const domain of errors.domainsByComponentId.values()) {
    if (domain.errorDomain !== "project" || domain.forwardModulePath !== undefined) continue;
    const variants = program.records.programErrorVariants.get(domain.componentId);
    assert.equal(variants !== undefined, true, "the actual error owner supplied the complete native variant inventory");
    producer.errorTransportEmissionPlans.variants(domain.componentId, variants);
    domains += 1;
  }
  assert.equal(domains > 0, true, "the real checked throw requires native program error transport");
  const issues = analyzeRustProgramErrorModuleEmission({ ...program,
    providerErrorCarriers: [...program.providerErrorCarriers, errorCarrier],
  }, errors, producer.errorTransportEmissionPlans);
  assert.equal(issues.length, 1, "one precise source admission diagnostic is retained before the seal");
  assert.equal(issues[0].code, "RUST_PROVIDER_ERROR_CARRIER_UNRENDERABLE",
    "the real admission owner rejects an unresolved native carrier rather than relabelling a source error");
  assert.equal(issues[0].message, "A selected provider-native error carrier has no exact renderable Rust type.",
    "the diagnostic identifies the exact unresolved renderability obligation");
  assert.equal(issues[0].evidence.includes(`carrier=${JSON.stringify(errorCarrier)}`), true,
    "the refusal retains the original unsupported native carrier");
  assertInvariant(() => finishProviderOperationExpression(context, { abi },
    { kind: "call", path: "fixture::dispose", args: [] }, node), context,
  "An admitted native type requires its exact sealed position evidence.", undefined);
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
    const selected = admitStatements(hideFields(program, node, "AsBinaryExpression", [field]));
    assert.equal(selected.kind, "rejected", `${field}: exact setter source correspondence is required before publication`);
    assert.equal(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_SETTER_ABI_NOT_PROVEN" &&
      diagnostic.sourceNode === node), true, `${field}: admission retains the exact source identity`);
    assert.equal(selected.plan === undefined, true, `${field}: no incomplete statement plan is published`);
  }
  // The sealed runtime-setter record is the planner's only source of the admitted operands and ABI correspondence.
  const missing = planContext({ ...program, records: { ...program.records,
    runtimeSetter: { get: subject => subject === node ? undefined : program.records.runtimeSetter.get(subject) } } }, node);
  assertInvariant(() => planRuntimeSetStatement(node, fact, missing), missing,
    "Runtime setter requires its admitted native source operands and ABI correspondence.", node);
  const malformed = { ...fact, abi: { ...fact.abi,
    target: { form: "call", path: "fixture::set", chain: [{ kind: "copy-selected-carrier" }] } } };
  assert.equal(validateRustFinalizedOperationAbi(malformed.abi, program.typeDefinitions), false,
    "the canonical ABI owner rejects the same impossible malformed chain, not a fabricated source program");
});

test("admitted iteration cannot lose mandatory body and binding syntax", () => {
  const program = programFixture();
  for (const [owner, kind, view, field, plan, message] of [
    ["forOf", "IsForOfStatement", "AsForInOrOfStatement", "Statement", planForOfStatement,
      "for-of statements require a concrete source body."],
    ["forIn", "IsForInStatement", "AsForInOrOfStatement", "Initializer", planForInStatement,
      "for-in requires one exact binding initializer."],
  ]) {
    const node = nodeIn(program, owner, (ast, candidate) => ast.is[kind](candidate));
    const changed = hideFields(program, node, view, [field]);
    const selected = admitStatements(changed);
    assert.equal(selected.kind, "rejected", `${owner}: checked iteration syntax is complete before publication`);
    assert.equal(selected.diagnostics.some(diagnostic => diagnostic.sourceNode === node && diagnostic.code ===
      (field === "Statement" ? "RUST_STATEMENT_SEQUENCE_NOT_PROVEN" : "RUST_ITERATION_BINDING_NOT_PROVEN")), true,
    `${owner}: admission retains the missing source component and exact identity`);
    assert.equal(selected.plan === undefined, true, `${owner}: no incomplete iteration plan is published`);
    if (field === "Statement") {
      const context = planContext(changed, node);
      assertInvariant(() => plan(node, context), context, message, node);
    }
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
    target: { form: "provider", receiverMode: "value", abi: { target: { form: "call", path: "fixture::dispose" } } } } };
  assert.throws(() => resourceDisposalReceiverMode(invalid), error =>
    error.message.includes("Finalized resource disposal target has no closed Rust receiver mode."),
  "the same invalid call-form disposer fails at its internal boundary");
  const rejected = { ...context, diagnostics: [],
    syntheticNames: createRustSyntheticNameState(analyzed.ast, declaration, []),
  };
  assertInvariant(() => planResourceManagedBody(declaration, "resource", invalid, rejected,
    () => ({ statements: [] })), rejected,
  "Finalized resource disposal target has no closed Rust receiver mode.");
});
