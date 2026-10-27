import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import {
  Node_Expression, Node_Operand, BinaryExpression_Left, BinaryExpression_Right,
  sourceControlTransferTarget, sourceEnclosingCallable, sourceTransparentExpressionOperand,
  sourceLabeledStatementTarget, type SourceLabeledStatementTarget, sourceExpressionResultDisposition,
  TryStatement_TryBlock,
  IterationStatement_Statement, LabeledStatement_Statement,
  type TargetSourceProgram,
} from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { RustErrorRegionRecords, RustErrorRegionSelection } from "../../target-model/records/errors/error-regions.js";
import type {
  RustAssignmentCompletion, RustControlExitCompletion, RustIterationBindingCompletion,
  RustIterationCompletion, RustRuntimeSetterCompletion, RustStatementCompletionRecords,
} from "../../target-model/records/operations/statement-completion.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustBoolCarrier, isRustStringCarrier, isRustUnitCarrier, isRustProgramErrorCarrier, rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustRecordCarrierValue } from "../../target-model/types/carriers/records.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { rustSwitchComparisonMatches } from "../operations/control-flow/switch.js";
import type { RustProjectFlowReadSelectionIndex } from "./project-flow-read-selections.js";
import { validateRustDisposalLifecycle } from "./resource-lifecycle.js";
import type { RustStatementCompletionProducer } from "../program/records/operations/statement-completion.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";
import type { RustCountedLoopRepresentation } from "../../target-model/records/operations/counted-loops.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import { rustSourceHasExplicitUnsafeContext } from "../safety/regions.js";
import { admitRustThrowCompletion } from "../errors/throw-admission.js";
import { admitRustProjectFieldDispatch } from "../errors/field-dispatch.js";
import { analyzeRustOptionalChainBodyFallibility } from "../errors/optional-chains.js";
import { admitRustAwaitBoundary } from "../callables/async/await-admission.js";
import { admitRustSourceValueConversions } from "../conversions/source-admission.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/program/source-package-semantics.js";
import type { RustThrowCompletion, RustCatchBinding, RustCatchErrorConversion } from "../../target-model/records/operations/exception-flow.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustAssignmentValueSelection } from "../../target-model/records/operations/operator-selection.js";
import { selectRustAssignmentValue } from "../../policy/operations/operators/assignment-value.js";
import type { RustOwnershipRecords } from "../../target-model/records/storage/ownership.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustErrorRegionCarrier } from "../errors/regions.js";
import { rustCarrierProvidesErrorObservation } from "../../policy/constraints/error-protocols.js";
import { selectRustPhysicalProgramErrorOwner } from "../errors/error-types.js";
import { rustNativeErrorJoinReference } from "../../target-model/types/native-error-joins.js";
import { rustUninhabitedError } from "../../policy/conversions/callable-physical.js";

export interface RustStatementCompletionInput {
  readonly structuralShapes: Parameters<typeof analyzeRustOptionalChainBodyFallibility>[0]["structural"];
  readonly frozenDataWrites: Parameters<typeof analyzeRustOptionalChainBodyFallibility>[0]["frozen"];
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly errorRegions: RustErrorRegionRecords;
  readonly projectFlowReadSelections: RustProjectFlowReadSelectionIndex;
  readonly producer: RustStatementCompletionProducer;
  readonly required: RustRequiredRecord[];
  readonly countedLoops: ReadonlyMap<Node, RustCountedLoopRepresentation>;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly components: RustSourcePackageComponentClassifications;
  readonly ownership: RustOwnershipRecords;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
}

export type RustStatementCompletionSelection =
  | { readonly kind: "resolved"; readonly plan: RustStatementCompletionRecords }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

export function selectRustCaughtErrorConversion(source: TargetTypeRef, target: TargetTypeRef,
  proofs: readonly { readonly error: TargetTypeRef; readonly target: TargetTypeRef }[]): RustCatchErrorConversion | undefined {
  if (!isRustTargetTypeRef(source) || !isRustTargetTypeRef(target) || !isDenseDataArray(proofs) || proofs.length > 4096 ||
    proofs.some(proof => proof === null || typeof proof !== "object" ||
      !isRustTargetTypeRef(proof.error) || !isRustTargetTypeRef(proof.target))) return undefined;
  let remaining = 4096;
  const select = (carrier: TargetTypeRef, depth: number): RustCatchErrorConversion | undefined => {
    if (remaining-- <= 0 || depth > 128) return undefined;
    if (rustTargetTypeRefEquals(carrier, target)) return Object.freeze({ kind: "identity", carrier });
    if (rustUninhabitedError(carrier)) return Object.freeze({ kind: "uninhabited", carrier });
    const join = rustNativeErrorJoinReference(carrier);
    if (join !== undefined) {
      const arms: RustCatchErrorConversion[] = [];
      for (const error of join.errors) {
        const arm = select(error, depth + 1);
        if (arm === undefined) return undefined;
        arms.push(arm);
      }
      return Object.freeze({ kind: "native-join", carrier, arms: Object.freeze(arms) });
    }
    return proofs.some(proof => rustTargetTypeRefEquals(proof.error, carrier) && rustTargetTypeRefEquals(proof.target, target))
      ? Object.freeze({ kind: "into", carrier }) : undefined;
  };
  return select(source, 0);
}

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
  const labels = new Map<Node, SourceLabeledStatementTarget>();
  const throws = new Map<Node, RustThrowCompletion>();
  const catches = new Map<Node, RustCatchBinding>();
  const assignmentValues = new Map<Node, RustAssignmentValueSelection>();
  const methodWrites = new Map<Node, boolean>();
  const frames = new Map<Node, { readonly asynchronous: boolean; readonly fallible: boolean;
    readonly region: RustErrorRegionSelection | undefined }>();
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
    const existing = frames.get(node);
    if (existing !== undefined) return existing;
    const owner = sourceEnclosingCallable(node, ast) ?? ast.getSourceFile(node);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "A checked runtime statement requires its execution owner.", node);
    const sourceFile = ast.is.IsSourceFile(owner) ? ast.getSourceFile(owner) : undefined;
    const generator = records.generator.get(owner);
    const initializer = sourceFile === undefined ? undefined : input.errorRegions.initialization.moduleFor(sourceFile);
    const region = input.errorRegions.localFor(node);
    const selected = Object.freeze({ asynchronous: records.asyncFunction.get(owner) !== undefined || generator?.kind === "async" ||
      initializer?.asynchronous === true,
    fallible: region !== undefined && region.kind !== "infallible", region });
    frames.set(node, selected);
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
  const exception = (node: Node): void => {
    if (ast.is.IsThrowStatement(node)) {
      const file = ast.getSourceFile(node);
      const component = file === undefined ? undefined : input.components.componentForFile(ast.getFileName(file));
      const admittedThrow = admitRustThrowCompletion({ ast, records, region: frame(node).region, componentId: component?.componentId }, node);
      if (admittedThrow.kind === "rejected") diagnostics.push(admittedThrow.diagnostic);
      else publish(throws, node, admittedThrow.completion);
    }
    if (ast.is.IsCatchClause(node)) {
      const declaration = ast.as.AsCatchClause(node)?.VariableDeclaration;
      const name = declaration === undefined ? "_" : input.names.nameForDeclaration(declaration);
      if (name === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted catch binding requires its authored native name.", node);
      const uses = declaration === undefined ? [] : input.source.navigation.declarationUseSummary(declaration).uses.filter(use =>
        input.isNativeNode(use.reference) && records.nativeUnreachable.get(use.reference) !== true &&
        records.compileTimeSource.get(use.reference) === undefined && records.nativeParticipation.get(use.reference) !== "erased");
      const statement = ast.parent(node);
      const body = statement === undefined ? undefined : TryStatement_TryBlock(ast, statement);
      const region = body === undefined ? undefined : input.errorRegions.get(body);
      const inputCarrier = region === undefined ? undefined : rustErrorRegionCarrier(region);
      if (inputCarrier === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted catch binding requires its completed protected error region.", node);
      const observes = uses.some(use => {
        const disposition = sourceExpressionResultDisposition(ast, use.reference);
        if (disposition.kind === "discarded") return false;
        let value = use.reference;
        for (let parent = ast.parent(value); parent !== undefined && sourceTransparentExpressionOperand(ast, parent) === value;
          parent = ast.parent(value)) value = parent;
        const parent = ast.parent(value);
        return parent === undefined || !ast.is.IsThrowStatement(parent) || Node_Expression(ast, parent) !== value;
      });
      const owner = sourceEnclosingCallable(node, ast);
      const physicalOwner = selectRustPhysicalProgramErrorOwner(node, { ast, components: input.components });
      const target = physicalOwner === undefined ? undefined : rustProgramErrorTargetType(physicalOwner);
      const proofs = owner === undefined ? [] : records.nativeGenerics.get(owner)?.inputs.flatMap(parameter =>
        parameter.caught === undefined ? [] : [{ error: parameter.caught.error,
          target: target !== undefined && rustTargetTypeRefEquals(parameter.caught.target, rustProgramErrorTargetType())
            ? target : parameter.caught.target }]) ?? [];
      const operand = observes && !isRustProgramErrorCarrier(inputCarrier) &&
        !rustCarrierProvidesErrorObservation(inputCarrier, input.typeDefinitions) && target !== undefined
        ? selectRustCaughtErrorConversion(inputCarrier, target, proofs) : undefined;
      const conversion = operand === undefined || target === undefined ? undefined : Object.freeze({ target, operand });
      publish(catches, node, Object.freeze({ name, used: uses.length !== 0, inputCarrier,
        readCarrier: conversion?.target ?? inputCarrier, conversion }));
    }
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
      operation.operationId !== "tsonic.rust.control.switch.strict-equality" || !isDenseDataArray(operation.clauses) ||
      clauses.length !== operation.clauses.length ||
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
    if (operation.abi.effects.safety === "requires-unsafe" &&
      !rustSourceHasExplicitUnsafeContext(ast, node, input.safetyApplications)) {
      diagnostics.push({ code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED", category: "error", source: "tsonic-rust",
        message: "The selected Rust operation requires an explicit unsafecontext() source region at this use site.", sourceNode: node });
      return;
    }
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
    let target = ast.is.IsBinaryExpression(node) ? BinaryExpression_Left(ast, node) : Node_Operand(ast, node);
    const read = target === undefined ? undefined : input.ownership.reads.get(target);
    const right = ast.is.IsBinaryExpression(node) ? BinaryExpression_Right(ast, node) : undefined;
    if (operation.operator !== "=" && read === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted compound assignment requires its selected previous-value ownership.", node);
    const stringBorrow = operation.operator === "+=" && isRustStringCarrier(operation.resultCarrier) &&
      read?.value.kind === "borrow" && right !== undefined && read.borrowedAcross.has(right);
    const borrowed = operation.kind === "operator-call" && operation.operandModes[0] === "ref" && read?.value.kind === "borrow" &&
      right !== undefined && read.borrowedAcross.has(right);
    const previous = stringBorrow ? Object.freeze({ kind: "borrow" as const, mutable: false })
      : borrowed ? read!.value : read?.snapshot ?? read?.source ?? { kind: "copy" as const };
    const value = selectRustAssignmentValue(operation, previous);
    if (value === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted assignment requires its selected native value operation.", node);
    publish(assignmentValues, node, value);
    while (target !== undefined && target !== node) {
      publish(assignmentValues, target, value);
      const targetOperation = records.targetOperation.get(target);
      if (targetOperation?.kind === "source-method-property") {
        const definition = input.projectTypes.definitionForCarrier(targetOperation.receiverCarrier);
        if (definition === undefined) failTargetAnalysisInvariant("tsonic-rust", "A selected method replacement requires its native receiver definition.", target);
        publish(methodWrites, target, input.projectTypes.isPolymorphic(definition));
      }
      if (targetOperation?.kind === "source-accessor") {
        const selected = records.selectedOperation.get(target);
        const unsafe = (role: "getter" | "setter"): boolean => {
          const declaration = role === "getter" ? selected?.provenance?.sourceSelectedReadDeclaration : selected?.provenance?.sourceSelectedWriteDeclaration;
          return declaration !== undefined && input.safetyApplications.forDeclaration(declaration).some(application =>
            application.applicationPlacement === role && application.contract === "requires-unsafe");
        };
        if ((unsafe("setter") || operation.operator !== "=" && unsafe("getter")) &&
          !rustSourceHasExplicitUnsafeContext(ast, target, input.safetyApplications)) diagnostics.push({
          code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED", category: "error", source: "tsonic-rust", sourceNode: target,
          message: "The selected Rust operation requires an explicit unsafecontext() source region at this use site.",
        });
      }
      const inner = sourceTransparentExpressionOperand(ast, target);
      if (inner === undefined) break;
      target = inner;
    }
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
    if (ast.is.IsLabeledStatement(node)) {
      admit(LabeledStatement_Statement(ast, node), node);
      const selected = sourceLabeledStatementTarget(ast, node);
      if (selected === undefined || selected.loop !== undefined && selected.loopBody === undefined) {
        failTargetAnalysisInvariant("tsonic-rust", "A checked label requires its exact source body and iteration target.", node);
      }
      publish(labels, node, selected);
    }
    if (ast.is.IsIfStatement(node)) { condition(node, ast.as.AsIfStatement(node)?.Expression); projectTypeTest(node); }
    else if (ast.is.IsWhileStatement(node)) condition(node, ast.as.AsWhileStatement(node)?.Expression);
    else if (ast.is.IsDoStatement(node)) condition(node, ast.as.AsDoStatement(node)?.Expression);
    else if (ast.is.IsForStatement(node)) condition(node, ast.as.AsForStatement(node)?.Condition);
    if (ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node) || ast.is.IsForStatement(node) ||
      ast.is.IsForInStatement(node) || ast.is.IsForOfStatement(node) || ast.is.IsSwitchStatement(node) || ast.is.IsLabeledStatement(node)) selectTargets(node);
    if (ast.is.IsForInStatement(node) || ast.is.IsForOfStatement(node)) iteration(node);
    if (ast.is.IsThrowStatement(node) || ast.is.IsCatchClause(node)) exception(node);
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
    if (ast.is.IsAwaitExpression(node)) {
      const issue = admitRustAwaitBoundary(ast, node, records.awaitValue.get(node), frame(node).fallible);
      if (issue !== undefined) diagnostics.push(issue);
    }
    const optional = records.optionalChain.get(node);
    if (optional !== undefined) {
      const fallible = analyzeRustOptionalChainBodyFallibility({ ast, records, structural: input.structuralShapes,
        dispatch: input.projectFieldDispatch, frozen: input.frozenDataWrites, definitions: input.typeDefinitions }, node, optional.guard);
      if (fallible && !frame(node).fallible) diagnostics.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
        message: `Fallible optional-chain operations require a finalized fallible lowering context. Node kind: ${ast.kindName(node)}.`,
        evidence: ["target.capability=rust.error.optional-chain"] });
    }
    if (operation?.kind === "regexp-create" && !frame(node).fallible) diagnostics.push({
      code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `Fallible calls require a fallible lowering context (a throwing function or a try block). Node kind: ${ast.kindName(node)}.`,
      evidence: ["target.capability=rust.error.call"],
    });
    if (operation?.kind === "source-field" || operation?.kind === "source-union-field" || operation?.kind === "source-accessor") {
      const issue = admitRustProjectFieldDispatch({ ast, region: frame(node).region, dispatch: input.projectFieldDispatch, records }, node, operation);
      if (issue !== undefined) diagnostics.push(issue);
    }
    if ((operation?.kind === "provider-operation" || operation?.kind === "runtime-set") && operation.abi.effects.invocation === "fallible" && !frame(node).fallible)
      diagnostics.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
        message: `Fallible operations require a finalized fallible lowering context. Node kind: ${ast.kindName(node)}.`,
        evidence: ["target.capability=rust.error.call"] });
    if (compound !== undefined) setter(node, compound);
    else if (operation?.kind === "runtime-set") setter(node, operation);
    if (operation?.kind === "operator-token" || operation?.kind === "operator-call") assignment(node, operation);
    diagnostics.push(...admitRustSourceValueConversions({ ast, records, definitions: input.typeDefinitions,
      fallible: frame(node).fallible }, node, operation));
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  if (diagnostics.length > 0) return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  for (const subject of admitted) {
    requireRustRecord(input.required, "statementAdmission", subject, ast.kindName(subject), "analyzeRustStatementCompletions");
  }
  for (const [family, selected] of [
    ["statementCondition", conditions], ["statementControlTargets", targets], ["controlExit", exits],
    ["iterationCompletion", iterations], ["runtimeSetter", setters], ["assignmentCompletion", assignments],
    ["projectTypeTestReads", projectReads], ["labeledStatement", labels],
    ["countedLoop", input.countedLoops],
    ["throwCompletion", throws], ["catchBinding", catches],
    ["assignmentValue", assignmentValues],
    ["methodWriteDispatch", methodWrites],
  ] as const) {
    for (const subject of selected.keys()) {
      requireRustRecord(input.required, family, subject, ast.kindName(subject), "analyzeRustStatementCompletions");
    }
  }
  input.producer.publish({ admitted, conditions, targets, exits, iterations, setters, assignments, projectReads, labels,
    countedLoops: input.countedLoops, throws, catches, assignmentValues, methodWrites });
  return { kind: "resolved", plan: input.producer.records };
}
