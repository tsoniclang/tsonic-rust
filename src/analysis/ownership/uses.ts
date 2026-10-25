import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";
import { rustFinalizedSourceInputs } from "../../target-model/operations/finalized-inputs.js";
import { rustBorrowedOperationArguments } from "../storage/provider-borrows.js";
import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";
import { selectRustOperationReadUses } from "../../policy/ownership/read-use.js";
import { type RustReadUse } from "../../target-model/records/ownership.js";
import { rustCallableProtocol } from "../../target-model/types/index.js";
import { rustCallArgumentMode } from "../callables/parameter-passing.js";
import { rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";

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
  structuralShapes: Pick<RustStructuralShapePlan, "field">): ReadonlyMap<Node, RustReadUse> {
  const uses = new Map<Node, RustReadUse>();
  // A borrowed provider input whose argument is first converted by value (`&JsValue::from(handle)`) consumes the
  // argument's own read, so a later read of the same storage needs its clone.
  const argumentConsumed = (source: { readonly kind: string; readonly sourceIndex?: number }, argumentsList: readonly (Node | undefined)[] | undefined): boolean => {
    const argument = source.kind === "argument" && source.sourceIndex !== undefined ? argumentsList?.[source.sourceIndex] : undefined;
    const conversion = argument === undefined ? undefined : records.contextualValueConversion.get(argument)?.conversion;
    return argument !== undefined && ownsExternalArgument(argument) || conversion !== undefined &&
      rustContextualRuntimeConversionContract(conversion, definitions)?.sourceMode === "value";
  };
  for (const node of nodes) {
    const operation = records.targetOperation.get(node);
    const computedMember = records.computedMember.get(node);
    const address = records.rawAddressPlan.get(node);
    const location = records.typedLocationPlan.get(node);
    const guard = records.optionalChain.get(node)?.guard;
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
      assignment.operator !== "=" && isRustAssignmentOperator(assignment.operator)) ? BinaryExpression_Right(ast, parent) : undefined;
    const receiver = Node_Expression(ast, node);
    const extendedUse = (subject: Node, use: RustReadUse): RustReadUse => subject !== receiver || assignmentRight === undefined ? use
      : Object.freeze({ ...use, later: Object.freeze([...use.later, assignmentRight]) });
    for (const [subject, use] of selected) uses.set(subject, extendedUse(subject, use));
    // A getter read whose method borrows `self` shares its receiver, like a stored field read.
    if (operation?.kind === "source-accessor" && operation.accessMode === "read" && operation.receiver.kind === "instance" &&
      operation.read !== undefined && records.selfMode.get(operation.read.declaration)?.mode === "ref") {
      const receiver = Node_Expression(ast, node);
      const key = ast.is.IsElementAccessExpression(node) ? ElementAccessExpression_ArgumentExpression(ast, node) : undefined;
      if (receiver !== undefined && !uses.has(receiver))
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
  return uses;
}
