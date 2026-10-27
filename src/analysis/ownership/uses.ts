import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ConditionalExpression_Condition, ElementAccessExpression_ArgumentExpression, ForStatement_Condition, Node_Expression, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";
import { rustFinalizedSourceInputs } from "../../target-model/operations/finalized-inputs.js";
import { rustBorrowedOperationArguments } from "../storage/provider-borrows.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";
import { selectRustOperationReadUses } from "../../policy/ownership/read-use.js";
import { type RustReadUse } from "../../target-model/records/ownership.js";
import { rustCallableProtocol } from "../../target-model/types/index.js";
import { rustCallArgumentMode } from "../callables/values/parameter-passing.js";
import { rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import { rustRuntimeSetSourceInputs } from "../control-flow/statement-completion.js";
import { rustTargetOperationIsDirectLocation } from "../../policy/operations/members/native-contracts.js";

export function rustNativeArgumentBorrowsRead(argument: Node, reference: Node,
  ast: AstReader, records: RustProgramRecords): boolean {
  const mode = rustCallArgumentMode(argument, ast, records);
  const carrier = records.runtimeCarrier.get(argument)?.carrier;
  const pending = [{ source: argument, borrowed: mode === "ref" || mode === "mut-ref" || carrier?.kind === "reference" }];
  const visited = new Map<Node, Set<boolean>>();
  while (pending.length !== 0) {
    const { source, borrowed } = pending.pop()!;
    const states = visited.get(source) ?? new Set<boolean>();
    if (states.has(borrowed)) continue;
    states.add(borrowed);
    visited.set(source, states);
    if (source === reference && borrowed) return true;
    const operand = sourceTransparentExpressionOperand(ast, source);
    const operation = records.targetOperation.get(source);
    if (operand !== undefined) pending.push({ source: operand, borrowed });
    else if (operation?.kind === "reference-operation" &&
      (operation.operation === "shared-reference" || operation.operation === "mutable-reference")) {
      pending.push({ source: operation.operandExpression, borrowed: true });
    } else if (borrowed && operation?.kind === "source-field" && operation.valueSemantics.kind === "stored") {
      const receiver = Node_Expression(ast, source);
      if (receiver !== undefined) pending.push({ source: receiver, borrowed: true });
    } else if (operation?.kind === "source-call") {
      const references = rustTargetGenericReferences(operation.resultCarrier);
      const lifetimes = new Set([...references.lifetimes, ...references.callScopedElisions, ...references.elisionInputs]
        .filter(lifetime => lifetime.kind !== "placeholder" && lifetime.kind !== "static").map(rustLifetimeKey));
      const argumentsList = ast.arguments(source);
      for (const parameter of operation.parameters) {
        const native = parameter.parameterCarrier;
        if (native.kind !== "reference" || native.lifetime === undefined || !lifetimes.has(rustLifetimeKey(native.lifetime))) continue;
        for (const input of parameter.inputs) {
          const actual = argumentsList[input.sourceArgumentIndex];
          if (actual !== undefined) pending.push({ source: actual, borrowed: true });
        }
      }
    }
  }
  return false;
}

export function analyzeRustReadUses(ast: AstReader, nodes: readonly Node[], records: RustAnalysisRecords,
  definitions: RustTypeDefinitions, ownsExternalArgument: (argument: Node) => boolean,
  structuralShapes: Pick<RustStructuralShapePlan, "field">,
  isDirectValueField: (node: Node) => boolean): ReadonlyMap<Node, RustReadUse> {
  const uses = new Map<Node, RustReadUse>();
  const consumesSource = (node: Node | undefined): boolean => {
    const conversion = node === undefined ? undefined : records.contextualValueConversion.get(node)?.conversion;
    const contract = conversion === undefined ? undefined : rustContextualRuntimeConversionContract(conversion, definitions);
    return contract?.sourceMode === "value" && contract.lowering !== "identity";
  };
  // A borrowed provider input whose argument is first converted by value (`&JsValue::from(handle)`) consumes the
  // argument's own read, so a later read of the same storage needs its clone.
  const argumentConsumed = (source: { readonly kind: string; readonly sourceIndex?: number }, argumentsList: readonly (Node | undefined)[] | undefined): boolean => {
    const argument = source.kind === "argument" && source.sourceIndex !== undefined ? argumentsList?.[source.sourceIndex] : undefined;
    return argument !== undefined && ownsExternalArgument(argument) || consumesSource(argument);
  };
  for (const node of nodes) {
    const operation = records.targetOperation.get(node);
    const computedMember = records.computedMember.get(node);
    const address = records.rawAddressPlan.get(node);
    const location = records.typedLocationPlan.get(node);
    const condition = ast.is.IsConditionalExpression(node) ? ConditionalExpression_Condition(ast, node)
      : ast.is.IsForStatement(node) ? ForStatement_Condition(ast, node)
        : ast.is.IsIfStatement(node) || ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node) ? Node_Expression(ast, node)
          : undefined;
    const guard = condition !== undefined ? records.nativeGuardResult.get(condition) === undefined ? condition : undefined
      : records.optionalChain.get(node)?.guard;
    if (operation === undefined && computedMember === undefined && address === undefined && location === undefined && guard === undefined) continue;
    const callable = operation?.kind === "source-call" && operation.target.form === "callable" ? operation.target.carrier : undefined;
    const callTrait = callable?.kind === "closure" ? callable.callTrait ?? "Fn" : undefined;
    const callableMode = callTrait === "FnOnce" ? "move" : callTrait === "FnMut" ? "mutable"
      : callTrait === "Fn" || rustCallableProtocol(callable) !== undefined ? "shared" : undefined;
    const structuralMethod = operation?.kind !== "source-call" || operation.target.form !== "structural-method" ? undefined
      : structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex)?.methodPlan
        ?? failTargetAnalysisInvariant("tsonic-rust", "A structural call requires its completed native receiver contract.", node);
    const structuralReceiverMode = structuralMethod?.kind === "fixed" && operation?.kind === "source-call" && operation.asyncBody === undefined
      ? structuralMethod.factoryReceiver : "shared";
    const left = operation?.kind === "runtime-set" ? BinaryExpression_Left(ast, node) : undefined;
    const argumentsList = operation?.kind === "runtime-set"
      ? operation.abi.operationKind === "index-set"
        ? [left === undefined ? undefined : ElementAccessExpression_ArgumentExpression(ast, left), BinaryExpression_Right(ast, node)]
        : [BinaryExpression_Right(ast, node)]
      : rustBorrowedOperationArguments(node, ast);
    const selected = selectRustOperationReadUses(ast, node, { operation, computedMember, address, location, guard, callableMode,
      structuralReceiverMode, arguments: argumentsList,
      nativeInputs: operation?.kind === "provider-operation" || operation?.kind === "runtime-set" ? rustFinalizedSourceInputs(operation.abi).map(input =>
        ({ source: input.source, mode: argumentConsumed(input.source, argumentsList) ? undefined : rustProviderInputBorrowMode(input) })) : [],
      argumentModes: (argumentsList ?? []).map(argument => records.argumentPassing.get(argument)?.mode) });
    let source = node;
    let parent = ast.parent(source);
    while (parent !== undefined && sourceTransparentExpressionOperand(ast, parent) === source) {
      source = parent;
      parent = ast.parent(source);
    }
    const assignment = parent === undefined || !ast.is.IsBinaryExpression(parent) || BinaryExpression_Left(ast, parent) !== source
      ? undefined : records.targetOperation.get(parent);
    const assignmentRight = parent !== undefined && (assignment?.kind === "nullish-assignment" ||
      (assignment?.kind === "operator-token" || assignment?.kind === "operator-call") &&
      (assignment.operator !== "=" || operation?.kind === "source-accessor" && operation.accessMode !== "read") &&
      isRustAssignmentOperator(assignment.operator)) ? BinaryExpression_Right(ast, parent) : undefined;
    const receiver = Node_Expression(ast, node);
    const extendedUse = (subject: Node, use: RustReadUse): RustReadUse => subject !== receiver || assignmentRight === undefined ? use
      : Object.freeze({ ...use, later: Object.freeze([...use.later, assignmentRight]) });
    for (const [subject, use] of selected) {
      const sourceUse = (use.mode === "shared" || use.mode === "mutable") && consumesSource(subject)
        ? Object.freeze({ ...use, mode: "value" as const, stableAcrossEffects: false }) : use;
      uses.set(subject, extendedUse(subject, sourceUse));
    }
    if (operation?.kind === "source-accessor" && operation.receiver.kind === "instance") {
      const accessors = operation.accessMode === "read" ? [operation.read]
        : operation.accessMode === "write" ? [operation.write] : [operation.read, operation.write];
      const receiver = Node_Expression(ast, node);
      const key = ast.is.IsElementAccessExpression(node) ? ElementAccessExpression_ArgumentExpression(ast, node) : undefined;
      if (receiver !== undefined && !uses.has(receiver) && accessors.every(accessor =>
        accessor !== undefined && records.selfMode.get(accessor.declaration)?.mode === "ref"))
        uses.set(receiver, extendedUse(receiver, Object.freeze({ mode: "shared", later: Object.freeze(key === undefined ? [] : [key]), laterStart: 0,
          stableAcrossEffects: true })));
    }
  }
  for (const node of nodes) {
    const use = uses.get(node);
    if (use === undefined) continue;
    const operand = sourceTransparentExpressionOperand(ast, node);
    if (operand !== undefined) uses.set(operand, use);
    const operation = records.targetOperation.get(node);
    const nativeIndex = operation?.kind === "provider-operation" && operation.abi.target.form === "index" &&
      operation.abi.targetReceiver.kind === "input" && operation.abi.targetReceiver.input.source.kind === "receiver" &&
      operation.abi.targetReceiver.input.conversion.kind === "identity" &&
      rustProviderInputBorrowMode(operation.abi.targetReceiver.input) !== undefined &&
      operation.abi.result.kind === "sync" && operation.abi.result.conversion.kind === "identity";
    if ((use.mode === "shared" || use.mode === "mutable") &&
      (operation?.kind === "tuple-index" || operation?.kind === "fixed-index" || nativeIndex)) {
      const receiver = Node_Expression(ast, node);
      const index = ElementAccessExpression_ArgumentExpression(ast, node);
      if (receiver !== undefined) uses.set(receiver, Object.freeze({ ...use,
        later: Object.freeze([...(index === undefined ? [] : [index]), ...use.later.slice(use.laterStart)]),
        laterStart: 0, stableAcrossEffects: false }));
    }
  }
  for (const node of nodes) {
    const operation = records.compoundWrite.get(node) ?? records.targetOperation.get(node);
    if (operation?.kind !== "runtime-set" || operation.abi.targetReceiver.kind !== "input" ||
      operation.abi.targetReceiver.input.source.kind !== "receiver" || operation.abi.targetReceiver.input.mode !== "mut-ref" ||
      operation.abi.targetReceiver.input.conversion.kind !== "identity") continue;
    const selected = rustRuntimeSetSourceInputs(ast, node, operation);
    let receiver = selected?.receiver;
    while (receiver !== undefined) {
      const operand = sourceTransparentExpressionOperand(ast, receiver);
      const fact = records.targetOperation.get(receiver);
      const direct = ast.is.IsIdentifier(receiver) || ast.kindName(receiver) === "KindThisExpression" ||
        ast.kindName(receiver) === "KindThisKeyword" || rustTargetOperationIsDirectLocation(fact) ||
        fact?.kind === "source-field" && fact.valueSemantics.kind === "stored" && fact.dispatch === undefined && isDirectValueField(receiver);
      if (operand === undefined && !direct) break;
      uses.set(receiver, Object.freeze({ mode: "shared", later: Object.freeze([]), laterStart: 0, stableAcrossEffects: false }));
      receiver = operand ?? Node_Expression(ast, receiver);
    }
  }
  return uses;
}
