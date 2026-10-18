import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import {
  Node_Expression, Node_Operand, BinaryExpression_Left, BinaryExpression_Right,
  sourceControlTransferTarget, sourceEnclosingCallable, sourceTransparentExpressionOperand,
  IterationStatement_Statement, LabeledStatement_Statement,
  TryStatement_TryBlock, TryStatement_CatchClause, CatchClause_Block,
  type TargetSourceProgram,
} from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type {
  RustAssignmentCompletion, RustControlExitCompletion, RustIterationBindingCompletion,
  RustIterationCompletion, RustRuntimeSetterCompletion, RustStatementCompletionIndex,
} from "../../target-model/records/statement-completion.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustBoolCarrier, isRustUnitCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustRecordCarrierValue } from "../../target-model/types/carriers/records.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { rustSwitchComparisonMatches } from "../operations/contracts/switch.js";
import type { RustProjectFlowReadSelectionIndex } from "./project-flow-read-selections.js";
import { validateRustDisposalLifecycle } from "./resource-lifecycle.js";

export interface RustStatementCompletionInput {
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly errorRegions: import("../errors/regions.js").RustAnalyzedErrorRegions & {
    readonly initialization: import("../../target-model/records/error-regions.js").RustInitializationErrorRecords<
      import("../../target-model/types/native-error-joins.js").RustNativeErrorSource<TargetTypeRef>> };
  readonly projectFlowReadSelections: RustProjectFlowReadSelectionIndex;
}

export type RustStatementCompletionSelection =
  | { readonly kind: "resolved"; readonly plan: RustStatementCompletionIndex }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

const supportedStatements: ReadonlySet<string> = new Set([
  "KindBlock", "KindFunctionDeclaration", "KindClassDeclaration", "KindTypeAliasDeclaration",
  "KindVariableStatement", "KindReturnStatement", "KindBreakStatement", "KindContinueStatement",
  "KindEmptyStatement", "KindDebuggerStatement", "KindLabeledStatement", "KindSwitchStatement",
  "KindExpressionStatement", "KindIfStatement", "KindWhileStatement", "KindDoStatement",
  "KindForStatement", "KindForInStatement", "KindForOfStatement", "KindThrowStatement", "KindTryStatement",
]);

export function rustRuntimeSetSourceInputs(
  ast: AstReader, node: Node, operation: Extract<RustTargetOperationFact, { readonly kind: "runtime-set" }>,
): RustRuntimeSetterCompletion | undefined {
  const update = ast.is.IsPrefixUnaryExpression(node) || ast.is.IsPostfixUnaryExpression(node);
  const sourceTarget = update ? Node_Operand(ast, node) : BinaryExpression_Left(ast, node);
  const value = update ? sourceTarget : BinaryExpression_Right(ast, node);
  let target = sourceTarget;
  if (target !== undefined) for (let operand = sourceTransparentExpressionOperand(ast, target); operand !== undefined;
    operand = sourceTransparentExpressionOperand(ast, target)) target = operand;
  const receiver = target === undefined ? undefined : Node_Expression(ast, target);
  const index = target !== undefined && ast.is.IsElementAccessExpression(target)
    ? ast.as.AsElementAccessExpression(target)?.ArgumentExpression : undefined;
  const expectedKind = target !== undefined && ast.is.IsPropertyAccessExpression(target) ? "property-set"
    : target !== undefined && ast.is.IsElementAccessExpression(target) ? "index-set" : undefined;
  const argumentsList = value === undefined ? [] : index === undefined ? [value] : [index, value];
  if (target === undefined || value === undefined || expectedKind === undefined ||
    operation.abi.operationKind !== expectedKind ||
    expectedKind === "index-set" && index === undefined || argumentsList.length !== operation.abi.sourceArguments.length ||
    operation.abi.sourceArguments.some(argument => argument.disposition !== "runtime") ||
    operation.abi.effects.awaiting !== "not-applicable" || operation.abi.result.kind !== "sync" || !isRustUnitCarrier(operation.abi.result.carrier))
    return undefined;
  return Object.freeze({ receiver, sourceArguments: Object.freeze(argumentsList) });
}

export function analyzeRustStatementCompletions(input: RustStatementCompletionInput): RustStatementCompletionSelection {
  const { source, records, names } = input;
  const { ast } = source;
  const diagnostics: TargetDiagnostic[] = [];
  const admitted = new Set<Node>();
  const conditions = new Map<Node, Node>();
  const targets = new Map<Node, readonly Node[]>();
  const exits = new Map<Node, RustControlExitCompletion>();
  const iterations = new Map<Node, RustIterationCompletion>();
  const setters = new Map<Node, RustRuntimeSetterCompletion>();
  const assignments = new Map<Node, RustAssignmentCompletion>();
  const projectReads = new Map<Node, readonly Node[]>();
  const frames = new Map<Node, { readonly asynchronous: boolean; readonly fallible: boolean }>();
  const reject = (node: Node, code: string, message: string): void => {
    diagnostics.push({ code, category: "error", source: "tsonic-rust", sourceNode: node, message,
      evidence: ["target.capability=rust.control-flow.finalized-completion"] });
  };
  const publish = <Value>(map: Map<Node, Value>, node: Node, value: Value): void => {
    if (map.has(node)) failTargetAnalysisInvariant("tsonic-rust", "One statement-completion owner must publish each exact source subject once.", node);
    map.set(node, value);
  };
  const admit = (node: Node | undefined, owner: Node): void => {
    if (node === undefined) {
      reject(owner, "RUST_STATEMENT_SEQUENCE_NOT_PROVEN", "A runtime control body requires its exact checked source statement.");
      return;
    }
    if (!input.isNativeNode(node)) return;
    if (supportedStatements.has(ast.kindName(node))) admitted.add(node);
    else if (records.nativeUnreachable.get(node) !== true && records.compileTimeSource.get(node) === undefined &&
      records.nativeParticipation.get(node) !== "erased") reject(node, "RUST_STATEMENT_NOT_SUPPORTED", "The Rust target does not support this runtime statement.");
  };
  const frame = (node: Node) => {
    const owner = sourceEnclosingCallable(node, ast) ?? ast.getSourceFile(node);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "A checked runtime statement requires its execution owner.", node);
    let errorOwner = owner;
    for (let current = node; current !== owner;) {
      const parent = ast.parent(current);
      if (parent === undefined) break;
      if (ast.is.IsTryStatement(parent) && TryStatement_TryBlock(ast, parent) === current &&
        CatchClause_Block(ast, TryStatement_CatchClause(ast, parent)) !== undefined) {
        errorOwner = current;
        break;
      }
      current = parent;
    }
    const existing = frames.get(errorOwner);
    if (existing !== undefined) return existing;
    const sourceFile = ast.is.IsSourceFile(owner) ? ast.getSourceFile(owner) : undefined;
    const generator = records.generator.get(owner);
    const initializer = sourceFile === undefined ? undefined : input.errorRegions.initialization.moduleFor(sourceFile);
    const region = errorOwner === owner ? initializer?.region ?? input.errorRegions.get(owner)
      : input.errorRegions.get(errorOwner);
    if (errorOwner !== owner && region === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A protected try body requires its completed local error-region evidence.", errorOwner);
    const selected = Object.freeze({ asynchronous: records.asyncFunction.get(owner) !== undefined || generator?.kind === "async" ||
      initializer?.asynchronous === true,
    fallible: region !== undefined && region.kind !== "infallible" });
    frames.set(errorOwner, selected);
    return selected;
  };
  const selectTargets = (node: Node): void => {
    const aliases: Node[] = [node];
    for (let parent = ast.parent(node); parent !== undefined && ast.is.IsLabeledStatement(parent);
      parent = ast.parent(parent)) aliases.push(parent);
    publish(targets, node, Object.freeze(aliases));
  };
  const condition = (node: Node, expression: Node | undefined): void => {
    if (expression === undefined) {
      if (!ast.is.IsForStatement(node)) reject(node, "RUST_CONDITION_NOT_PROVEN", "Control flow requires its exact checked condition.");
      return;
    }
    if ((!ast.is.IsIfStatement(node) || records.nativeGuardResult.get(expression) === undefined) &&
      !isRustBoolCarrier(rustEffectiveValueCarrier(records, expression))) {
      reject(expression, "RUST_CONDITION_NOT_BOOLEAN", "Control-flow conditions require the finalized native Boolean carrier.");
      return;
    }
    publish(conditions, node, expression);
  };
  const binding = (statement: Node, operation: Extract<RustTargetOperationFact, { readonly kind: "iteration" }>): RustIterationBindingCompletion | undefined => {
    const initializer = ast.as.AsForInOrOfStatement(statement)?.Initializer;
    const declarations = initializer === undefined ? undefined : ast.as.AsVariableDeclarationList(initializer)?.Declarations?.Nodes;
    if (declarations !== undefined) {
      const declaration = declarations.length === 1 ? declarations[0] : undefined;
      const name = declaration === undefined ? undefined : ast.name(declaration);
      if (declaration !== undefined && name !== undefined &&
        (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name)) && operation.iterationKind !== "for-in" &&
        ast.variableDeclarationKind(declaration) !== "using" && ast.variableDeclarationKind(declaration) !== "await using") {
        return Object.freeze({ kind: "pattern", pattern: name });
      }
      const selectedName = declaration === undefined ? undefined : names.nameForDeclaration(declaration);
      if (declaration === undefined || name === undefined || !ast.is.IsIdentifier(name) ||
        selectedName === undefined || !isValidRustIdentifier(selectedName) ||
        !rustTargetTypeRefEquals(records.runtimeCarrier.get(declaration)?.carrier, operation.elementCarrier) ||
        operation.iterationKind === "for-in" && (ast.variableDeclarationKind(declaration) === "using" || ast.variableDeclarationKind(declaration) === "await using")) {
        reject(initializer ?? statement, "RUST_ITERATION_BINDING_NOT_PROVEN", "Iteration declarations require one exact native binding or finalized element pattern.");
        return undefined;
      }
      return Object.freeze({ kind: "declaration", declaration, name: selectedName,
        mutable: records.mutatedBinding.get(declaration) !== undefined });
    }
    const declaration = initializer === undefined ? undefined : records.sourceBinding.get(initializer)?.sourceDeclaration;
    const selectedName = declaration === undefined ? undefined : names.nameForDeclaration(declaration);
    if (initializer === undefined || !ast.is.IsIdentifier(initializer) || declaration === undefined || selectedName === undefined ||
      !isValidRustIdentifier(selectedName) || !rustTargetTypeRefEquals(records.runtimeCarrier.get(declaration)?.carrier, operation.elementCarrier) ||
      records.mutatedBinding.get(declaration) === undefined) {
      reject(initializer ?? statement, "RUST_ITERATION_BINDING_NOT_PROVEN", "Iteration assignment requires one exact mutable native binding with the selected element carrier.");
      return undefined;
    }
    return Object.freeze({ kind: "assignment", declaration, reference: initializer, name: selectedName });
  };
  const iteration = (node: Node): void => {
    const operation = records.targetOperation.get(node);
    const selected = records.selectedOperation.get(node);
    if (operation?.kind !== "iteration" || selected?.operationKind !== "iteration" || selected.operationId !== operation.operationId ||
      !rustTargetTypeRefEquals(selected.resultType, operation.elementCarrier) ||
      operation.iterationKind === "for-in" && operation.lowering.kind !== "dense-index-keys" &&
        operation.lowering.kind !== "js-array-index-keys" && operation.lowering.kind !== "static-keys" &&
        operation.lowering.kind !== "record-keys" ||
      operation.iterationKind === "for-in" && operation.lowering.kind === "record-keys" &&
        !rustTargetTypeRefEquals(rustRecordCarrierValue(operation.iterableCarrier)?.key, operation.elementCarrier)) {
      reject(node, "RUST_ITERATION_SELECTION_NOT_PROVEN", "Iteration requires its identical checked native operation and element selection.");
      return;
    }
    const selectedBinding = binding(node, operation);
    if (selectedBinding === undefined) return;
    const currentFrame = frame(node);
    if (operation.lowering.kind === "async-generator" && !currentFrame.asynchronous) {
      reject(node, "RUST_ASYNC_ITERATION_FRAME_NOT_PROVEN", "Async iteration requires its finalized asynchronous execution owner.");
      return;
    }
    if (operation.lowering.kind === "fallible-owned" && !currentFrame.fallible) {
      reject(node, "RUST_ITERATION_ERROR_FRAME_NOT_PROVEN", "Fallible iteration requires its finalized native error owner.");
      return;
    }
    const declarationKind = selectedBinding.kind === "declaration" ? ast.variableDeclarationKind(selectedBinding.declaration) : undefined;
    const resource = declarationKind === "using" || declarationKind === "await using" ? selectedBinding.kind === "declaration" ? selectedBinding.declaration : undefined : undefined;
    if (resource !== undefined && records.resourceManagement.get(resource) === undefined) {
      reject(resource, "RUST_RESOURCE_MANAGEMENT_NOT_PROVEN", "An iteration resource requires its exact selected disposal contract.");
      return;
    }
    publish(iterations, node, Object.freeze({ binding: selectedBinding, resource }));
  };
  const switchSelection = (node: Node): void => {
    const selected = ast.as.AsSwitchStatement(node);
    const clauses = selected?.CaseBlock === undefined ? undefined : ast.as.AsCaseBlock(selected.CaseBlock)?.Clauses?.Nodes;
    const operation = records.targetOperation.get(node);
    if (selected?.Expression === undefined || clauses === undefined || operation?.kind !== "switch" ||
      operation.operationId !== "tsonic.rust.control.switch.strict-equality" || clauses.length !== operation.clauses.length ||
      !rustTargetTypeRefEquals(rustEffectiveValueCarrier(records, selected.Expression), operation.discriminantCarrier)) {
      reject(node, "RUST_SWITCH_SELECTION_NOT_PROVEN", "Switch requires one exact finalized discriminant and dense clause selection.");
      return;
    }
    for (const [index, clause] of clauses.entries()) {
      const retained = operation.clauses[index];
      const expression = clause === undefined ? undefined : ast.as.AsCaseOrDefaultClause(clause)?.Expression;
      const statements = clause === undefined ? undefined : ast.as.AsCaseOrDefaultClause(clause)?.Statements?.Nodes;
      if (clause === undefined || retained?.clause !== clause ||
        statements === undefined || statements.some(statement => statement === undefined) ||
        (ast.is.IsCaseClause(clause) ? expression === undefined || retained.expression !== expression || retained.carrier === undefined ||
          retained.comparison === undefined || !rustTargetTypeRefEquals(rustEffectiveValueCarrier(records, expression), retained.carrier) ||
          !rustSwitchComparisonMatches(operation.discriminantCarrier, retained.carrier, retained.comparison)
          : retained.expression !== undefined || retained.carrier !== undefined || retained.comparison !== undefined)) {
        reject(clause ?? node, "RUST_SWITCH_CLAUSE_NOT_PROVEN", "Switch clause requires its exact admitted native comparison and source correspondence.");
      }
      for (const statement of statements ?? []) {
        admit(statement, clause ?? node);
        if (statement === undefined || !ast.is.IsVariableStatement(statement)) continue;
        const declarationList = ast.as.AsVariableStatement(statement)?.DeclarationList;
        const declaration = declarationList === undefined ? undefined : ast.as.AsVariableDeclarationList(declarationList)?.Declarations?.Nodes[0];
        const kind = ast.variableDeclarationKind(declaration);
        if (kind === "using" || kind === "await using") reject(statement, "RUST_SWITCH_RESOURCE_SCOPE_NOT_PROVEN",
          "A switch-clause resource declaration requires an explicit block so its lexical disposal boundary is exact.");
      }
    }
  };
  const setter = (node: Node, operation: Extract<RustTargetOperationFact, { readonly kind: "runtime-set" }>): void => {
    const inputs = rustRuntimeSetSourceInputs(ast, node, operation);
    if (inputs === undefined) {
      reject(node, "RUST_SETTER_ABI_NOT_PROVEN", "Assignment requires one exact synchronous native setter ABI and checked source operands.");
      return;
    }
    const value = inputs.sourceArguments[inputs.sourceArguments.length - 1]!;
    const compound = records.compoundWrite.get(node);
    const selected = records.selectedOperation.get(node);
    const direct = compound === undefined && selected?.operationKind === "operator" && selected.operationId === operation.operationId &&
      selected.targetOperation === operation.operationId &&
      rustTargetTypeRefEquals(selected.resultType, records.runtimeCarrier.get(value)?.carrier);
    if (compound === undefined ? !direct : compound !== operation) {
      reject(node, "RUST_SETTER_SELECTION_NOT_PROVEN", "Assignment requires its identical checked native setter and result selection.");
      return;
    }
    publish(setters, node, inputs);
  };
  const assignment = (node: Node, operation: RustAssignmentCompletion): void => {
    if (!isRustAssignmentOperator(operation.operator)) return;
    const selected = records.selectedOperation.get(node);
    if (selected?.operationKind !== "operator" || selected.operationId !== operation.operationId || selected.targetOperation !== operation.operator ||
      !rustTargetTypeRefEquals(selected.resultType, operation.resultCarrier)) {
      reject(node, "RUST_ASSIGNMENT_SELECTION_NOT_PROVEN", "Assignment requires its exact checked operator identity and native result carrier.");
      return;
    }
    publish(assignments, node, operation);
  };
  const projectTypeTest = (node: Node): void => {
    const selected = ast.as.AsIfStatement(node);
    const operation = selected?.Expression === undefined ? undefined : records.targetOperation.get(selected.Expression);
    if (operation?.kind !== "project-type-test" || operation.lowering.kind !== "dispatch" || selected?.ThenStatement === undefined) return;
    const left = BinaryExpression_Left(ast, selected.Expression!);
    const selectedBinding = left === undefined || !ast.is.IsIdentifier(left) ? undefined : records.sourceBinding.get(left);
    if (selectedBinding === undefined || records.mutatedBinding.get(selectedBinding.sourceDeclaration) !== undefined ||
      !rustTargetTypeRefEquals(operation.sourceCarrier, operation.dispatchCarrier)) return;
    const reads = input.projectFlowReadSelections.readsWithin({ root: selected.ThenStatement, declaration: selectedBinding.sourceDeclaration,
      sourceCarrier: operation.sourceCarrier, dispatchCarrier: operation.dispatchCarrier, selectedCarrier: operation.targetCarrier });
    if (reads.length > 0) publish(projectReads, node, Object.freeze([...reads]));
  };
  const pending: Node[] = [...input.sourceFiles];
  const visited = new Set<Node>();
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (!input.isNativeNode(node)) continue;
    if (visited.has(node)) continue;
    visited.add(node);
    const kind = ast.kindName(node);
    if (supportedStatements.has(kind)) admitted.add(node);
    if (records.nativeUnreachable.get(node) === true || records.compileTimeSource.get(node) !== undefined || records.nativeParticipation.get(node) === "erased") continue;
    if (ast.is.IsBlock(node)) {
      for (const statement of ast.statements(node)) admit(statement, node);
    }
    if (ast.is.IsIfStatement(node)) {
      const statement = ast.as.AsIfStatement(node);
      admit(statement?.ThenStatement, node);
      if (statement?.ElseStatement !== undefined) admit(statement.ElseStatement, node);
    }
    if (ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node) || ast.is.IsForStatement(node) ||
      ast.is.IsForInStatement(node) || ast.is.IsForOfStatement(node)) {
      admit(IterationStatement_Statement(ast, node), node);
    }
    if (ast.is.IsLabeledStatement(node)) admit(LabeledStatement_Statement(ast, node), node);
    if (ast.is.IsIfStatement(node)) { condition(node, ast.as.AsIfStatement(node)?.Expression); projectTypeTest(node); }
    else if (ast.is.IsWhileStatement(node)) condition(node, ast.as.AsWhileStatement(node)?.Expression);
    else if (ast.is.IsDoStatement(node)) condition(node, ast.as.AsDoStatement(node)?.Expression);
    else if (ast.is.IsForStatement(node)) condition(node, ast.as.AsForStatement(node)?.Condition);
    if (ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node) || ast.is.IsForStatement(node) ||
      ast.is.IsForInStatement(node) || ast.is.IsForOfStatement(node) || ast.is.IsSwitchStatement(node) || ast.is.IsLabeledStatement(node)) selectTargets(node);
    if (ast.is.IsForInStatement(node) || ast.is.IsForOfStatement(node)) iteration(node);
    if (ast.is.IsSwitchStatement(node)) switchSelection(node);
    if (ast.is.IsVariableDeclaration(node)) {
      const kind = ast.variableDeclarationKind(node);
      if (kind === "using" || kind === "await using") {
        const issue = validateRustDisposalLifecycle(input, node, frame(node));
        if (issue !== undefined) diagnostics.push(issue);
      }
    }
    if (ast.is.IsBreakStatement(node) || ast.is.IsContinueStatement(node)) {
      const target = sourceControlTransferTarget(ast, node);
      if (target === undefined) reject(node, "RUST_CONTROL_DESTINATION_NOT_PROVEN", "Control transfer requires its exact checked source destination.");
      else publish(exits, node, Object.freeze({ completion: ast.is.IsBreakStatement(node) ? "break" : "continue", target }));
    }
    const operation = records.targetOperation.get(node);
    const compound = records.compoundWrite.get(node);
    if (compound !== undefined) setter(node, compound);
    else if (operation?.kind === "runtime-set") setter(node, operation);
    if (operation?.kind === "operator-token" || operation?.kind === "operator-call") assignment(node, operation);
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  if (diagnostics.length > 0) return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  return { kind: "resolved", plan: Object.freeze({ admitted: (node: Node) => admitted.has(node),
    conditionFor: (node: Node) => conditions.get(node), controlTargetsFor: (node: Node) => targets.get(node),
    exitFor: (node: Node) => exits.get(node), iterationFor: (node: Node) => iterations.get(node),
    setterFor: (node: Node) => setters.get(node), assignmentFor: (node: Node) => assignments.get(node),
    projectTypeTestReadsFor: (node: Node) => projectReads.get(node) }) };
}
