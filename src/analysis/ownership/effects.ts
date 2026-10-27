import type { RustBorrowEffects } from "../../target-model/records/storage/ownership-effects.js";
import type { AstReader, Node, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Operand, sourceBindingHasMutableExposure, sourceEnclosingCallable, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustBorrowPrimitiveCopyValue, rustBorrowPureCopyValue, rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";

import { validatedRustCapturedFieldStorageFact } from "../storage/receiver-captures.js";
import { rustNativeIndexStorageProjection, rustNativeStoragePathsDisjoint, rustNativeStorageProjections, rustNativeStorageRoot } from "../storage/native-paths.js";
import { rustNativeWriteTargets, rustNoNativeWrites } from "./effect-paths.js";

import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";
import { rustCallArgumentMode } from "../callables/values/parameter-passing.js";

type StoredField = Extract<RustTargetOperationFact, { readonly kind: "source-field" }>;

import type { RustBorrowedFieldWrite, RustReadUse } from "../../target-model/records/storage/ownership.js";

export interface RustBorrowEffectsInput {
  readonly ast: AstReader;
  readonly sourceFacts: Pick<ReadonlySourceFactResolver, "getFact">;
  readonly nodes: readonly Node[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly projectTypes: RustAnalysisProgram["projectTypes"];
  readonly objectRepresentations: RustAnalysisProgram["objectRepresentations"];
  readonly frozenDataWrites: RustAnalysisProgram["frozenDataWrites"];
  readonly structuralShapes: RustAnalysisProgram["structuralShapes"];
  readonly navigation: RustAnalysisProgram["sourceNavigation"];
}

export type AnalyzeRustBorrowEffectsResult =
  | { readonly kind: "resolved"; readonly effects: RustBorrowEffects }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

const maximumBorrowStabilityNodes = 4_194_304;

export function analyzeRustBorrowEffects(
  input: RustBorrowEffectsInput,
  readUses: ReadonlyMap<Node, RustReadUse>,
  maximumNodes = maximumBorrowStabilityNodes,
): AnalyzeRustBorrowEffectsResult {
  const rejected = (message: string): AnalyzeRustBorrowEffectsResult => ({
    kind: "rejected", diagnostics: [{
      code: "RUST_BORROW_STABILITY_BUDGET_INVALID", category: "error", source: "tsonic-rust", message,
      evidence: ["target.capability=rust.backend.borrow-stability"],
    }],
  });
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1 || maximumNodes > maximumBorrowStabilityNodes) {
    return rejected("Rust borrow stability requires a positive finite node budget within its analysis bound.");
  }
  const positions = new Map(input.nodes.map((node, index) => [node, index]));
  if (positions.size !== input.nodes.length) return rejected("Rust borrow effects require unique checked source-node identities.");
  if (input.nodes.some(node => !input.isNativeNode(node)))
    return rejected("Rust borrow effects require their exact admitted native-node inventory.");
  const pure = new Set<Node>();
  const writes = new Map<Node, RustBorrowedFieldWrite>();
  const nativeWrites = new Map<Node, readonly Node[]>();
  const stableBindings = new Set<Node>();
  const bindingDecisions = new WeakMap<Node, boolean>();
  const directField = (node: Node): boolean => rustDirectBorrowField(node, input);
  let reservations = 0;
  let exhausted = false;
  const reserveTargets = (count: number): boolean => {
    reservations += count;
    if (reservations > maximumNodes) exhausted = true;
    return !exhausted;
  };
  const selectStableBinding = (node: Node): void => {
    const write = input.records.compoundWrite.get(node);
    if (write?.abi.targetReceiver.kind !== "input" || write.abi.targetReceiver.input.mode !== "ref" ||
      write.abi.targetReceiver.input.conversion.kind !== "identity") return;
    const target = input.ast.is.IsBinaryExpression(node) ? BinaryExpression_Left(input.ast, node) : Node_Operand(input.ast, node);
    const receiver = target === undefined ? undefined : Node_Expression(input.ast, target);
    if (receiver === undefined || !input.ast.is.IsIdentifier(receiver)) return;
    const binding = input.records.sourceBinding.get(receiver);
    if (binding?.scope !== "lexical") return;
    let stable = bindingDecisions.get(binding.sourceDeclaration);
    if (stable === undefined) {
      if (!reserveTargets(1)) return;
      const summary = input.navigation.declarationUseSummary(binding.sourceDeclaration);
      stable = !summary.bindingWritten && !summary.exported &&
        !sourceBindingHasMutableExposure({ ast: input.ast, sourceFacts: input.sourceFacts }, summary, () => reserveTargets(1));
      if (exhausted) return;
      bindingDecisions.set(binding.sourceDeclaration, stable);
    }
    if (stable) stableBindings.add(receiver);
  };
  for (const node of input.nodes) {
    if (["KindStringLiteral", "KindNoSubstitutionTemplateLiteral", "KindNumericLiteral", "KindBigIntLiteral",
      "KindTrueKeyword", "KindFalseKeyword"].includes(input.ast.kindName(node))) stableBindings.add(node);
    if (!(input.ast.is.IsVariableDeclaration(node) || input.ast.is.IsParameterDeclaration(node) || input.ast.is.IsBindingElement(node)) ||
      sourceEnclosingCallable(node, input.ast) === undefined) continue;
    const summary = input.navigation.declarationUseSummary(node);
    if (summary.captured || summary.exported || summary.bindingWritten || summary.memberWritten || summary.hasUnclassifiedValueUse) continue;
    let stable = true;
    for (const use of summary.uses) {
      if (!reserveTargets(1)) break;
      if (use.kind === "source-linkage" || use.kind === "type-only") continue;
      let argument = use.reference;
      for (let parent = input.ast.parent(argument); parent !== undefined &&
        sourceTransparentExpressionOperand(input.ast, parent) === argument; parent = input.ast.parent(argument)) argument = parent;
      if (!["comparison", "condition", "return", "storage"].includes(use.role) &&
        !(use.role === "argument" && rustCallArgumentMode(argument, input.ast, input.records) === "ref") &&
        !(use.role === "receiver" && (readUses.get(argument)?.mode === "shared" ||
          isElementReadReceiver(argument, input))) &&
        !(use.role === "argument" && isLocationBindingArgument(argument, input))) {
        stable = false;
        break;
      }
    }
    if (stable) for (const use of summary.uses) if (input.ast.is.IsIdentifier(use.reference)) stableBindings.add(use.reference);
  }
  for (let index = input.nodes.length - 1; index >= 0 && !exhausted; index -= 1) {
    const node = input.nodes[index]!;
    if (!reserveTargets(1)) break;
    let invalid = false;
    input.ast.forEachChild(node, child => {
      if (child !== undefined && input.isNativeNode(child) &&
        (positions.get(child) === undefined || positions.get(child)! <= index)) invalid = true;
    });
    if (invalid) return rejected("Rust borrow effects require the canonical acyclic checked-node inventory.");
    selectStableBinding(node);
    const field = input.records.targetOperation.get(node);
    const aliasReceiver = field?.kind === "source-field" && field.valueSemantics.kind === "receiver-alias" &&
      field.dispatch === undefined && rustTargetTypeRefEquals(field.receiverCarrier, field.resultCarrier) &&
      rustBorrowValueIsUnprojected(node, input.records) ? Node_Expression(input.ast, node) : undefined;
    const operand = sourceTransparentExpressionOperand(input.ast, node) ?? aliasReceiver;
    if (operand !== undefined && stableBindings.has(operand)) stableBindings.add(node);
    if (rustBorrowPureCopyValue(node, input.ast, input.records, child => pure.has(child))) pure.add(node);
    const selected = selectBorrowedWrite(node, pure, input);
    if (selected !== undefined) writes.set(node, selected);
    if (!pure.has(node)) {
      const targets = aliasReceiver === undefined ? rustNativeWriteTargets(node, input,
        child => pure.has(child) ? rustNoNativeWrites : nativeWrites.get(child), directField, reserveTargets)
        : pure.has(aliasReceiver) ? rustNoNativeWrites : nativeWrites.get(aliasReceiver);
      if (targets !== undefined) nativeWrites.set(node, targets);
    }
  }
  if (exhausted) return rejected("Rust borrow stability exceeds its finite source-node accounting bound.");
  return { kind: "resolved", effects: Object.freeze({ pureValues: pure, fieldWrites: writes, stableBindings, nativeWrites }) };
}

export function selectRustBorrowRelationship(source: Node, later: Node,
  input: RustBorrowEffectsInput, effects: RustBorrowEffects): boolean {
  const visitedValues = new Set<Node>();
  while (!visitedValues.has(source)) {
    visitedValues.add(source);
    const inner = Node_Expression(input.ast, source);
    if (inner !== undefined && rustSourceValueWrapperContains(source, inner, input.ast)) {
      source = inner;
      continue;
    }
    const sequence = input.records.targetOperation.get(source);
    if (inner !== undefined && sequence?.kind === "source-field" && sequence.valueSemantics.kind === "receiver-alias" &&
      sequence.dispatch === undefined && rustTargetTypeRefEquals(sequence.receiverCarrier, sequence.resultCarrier) &&
      rustBorrowValueIsUnprojected(source, input.records)) {
      source = inner;
      continue;
    }
    if (sequence?.kind !== "sequence") break;
    const tail = BinaryExpression_Right(input.ast, source);
    if (tail === undefined || !rustBorrowValueIsUnprojected(source, input.records) ||
      !rustTargetTypeRefEquals(sequence.resultCarrier, sequence.rightCarrier) ||
      !rustTargetTypeRefEquals(sequence.rightCarrier, input.records.runtimeCarrier.get(tail)?.carrier)) return false;
    source = tail;
  }
  const root = rustNativeStorageRoot(source, input);
  const path = root === undefined ? undefined : rustNativeStorageProjections(source, root, input);
  const binding = path?.length === 0 && input.records.sourceBinding.get(source)?.scope === "lexical";
  const indexed = path?.[path.length - 1] === rustNativeIndexStorageProjection || typeof path?.[path.length - 1] === "number";
  const field = input.records.targetOperation.get(source);
  if (!binding && !indexed && (!rustDirectBorrowField(source, input) || field?.kind !== "source-field" || field.accessMode !== "read")) return false;
  const targets = effects.pureValues.has(later) ? rustNoNativeWrites : effects.nativeWrites.get(later);
  return root !== undefined && path !== undefined && targets !== undefined && targets.every(target => {
    const targetRoot = rustNativeStorageRoot(target, input);
    if (binding && input.ast.is.IsIdentifier(target) && targetRoot !== undefined) return targetRoot !== root;
    const targetPath = targetRoot === root ? rustNativeStorageProjections(target, root, input) : undefined;
    return targetPath !== undefined && rustNativeStoragePathsDisjoint(path, targetPath);
  });
}

function rustDirectBorrowField(node: Node, input: RustBorrowEffectsInput): boolean {
  const field = ordinaryStoredField(node, input);
  if (field === undefined || field.storage !== "project-object") return false;
  const receiver = Node_Expression(input.ast, node);
  return rustTargetTypeRefEquals(field.resultCarrier, input.records.runtimeCarrier.get(node)?.carrier) &&
    receiver !== undefined && rustTargetTypeRefEquals(field.receiverCarrier, input.records.runtimeCarrier.get(receiver)?.carrier) &&
    input.objectRepresentations.representationFor(input.projectTypes.definitionForCarrier(field.receiverCarrier))?.kind === "value" &&
    (field.declaration === undefined || !input.objectRepresentations.receiverCaptures.isCaptured(field.declaration));

}

function ordinaryStoredField(node: Node, input: RustBorrowEffectsInput): StoredField | undefined {
  const selected = input.records.targetOperation.get(node);
  return input.ast.is.IsPropertyAccessExpression(node) && rustBorrowValueIsUnprojected(node, input.records) &&
    selected?.kind === "source-field" && selected.valueSemantics.kind === "stored" && selected.dispatch === undefined &&
    Number.isSafeInteger(selected.storageIndex) && selected.storageIndex >= 0 &&
    (selected.declaration === undefined || input.objectRepresentations.aliasFor(selected.declaration) === undefined)
    ? selected : undefined;
}

function selectBorrowedWrite(
  node: Node, pure: ReadonlySet<Node>, input: RustBorrowEffectsInput,
): RustBorrowedFieldWrite | undefined {
  const { ast, records, projectTypes, objectRepresentations } = input;
  const assignment = records.targetOperation.get(node);
  if (!ast.is.IsBinaryExpression(node) || assignment?.kind !== "operator-token" || assignment.operator !== "=" ||
    assignment.leftConversion !== undefined || assignment.rightConversion !== undefined) return undefined;
  const target = BinaryExpression_Left(ast, node);
  const value = BinaryExpression_Right(ast, node);
  const receiver = target === undefined ? undefined : Node_Expression(ast, target);
  const owner = receiver === undefined ? undefined : Node_Expression(ast, receiver);
  if (target === undefined || value === undefined || receiver === undefined || owner === undefined ||
    !pure.has(value) || !rustBorrowPrimitiveCopyValue(target, records) || !rustBorrowValueIsUnprojected(owner, records) ||
    !(ast.is.IsIdentifier(owner) && records.sourceBinding.get(owner)?.scope === "lexical" ||
      ast.kindName(owner) === "KindThisExpression" || ast.kindName(owner) === "KindThisKeyword")) return undefined;
  const stored = ordinaryStoredField(target, input);
  const field = ordinaryStoredField(receiver, input);
  if (stored === undefined || stored.accessMode !== "write" || field === undefined || field.accessMode !== "read" ||
    field.storage !== "project-object" || field.declaration === undefined ||
    stored.declaration !== undefined && objectRepresentations.receiverCaptures.isCaptured(stored.declaration) ||
    !rustTargetTypeRefEquals(field.resultCarrier, stored.receiverCarrier) ||
    !rustTargetTypeRefEquals(field.resultCarrier, records.runtimeCarrier.get(receiver)?.carrier) ||
    !rustTargetTypeRefEquals(stored.resultCarrier, records.runtimeCarrier.get(target)?.carrier) ||
    !rustTargetTypeRefEquals(field.receiverCarrier, records.runtimeCarrier.get(owner)?.carrier) ||
    !rustTargetTypeRefEquals(stored.resultCarrier, records.runtimeCarrier.get(value)?.carrier)) return undefined;
  const parent = projectTypes.definitionForCarrier(field.receiverCarrier);
  if (parent === undefined || parent.kind !== "class" || projectTypes.isPolymorphic(parent) ||
    projectTypes.inheritedExternalBaseForDefinition(parent) !== undefined ||
    projectTypes.definitionContainingDeclaration(field.declaration) !== parent) return undefined;
  const parentKind = objectRepresentations.representationFor(parent)?.kind;
  const captured = objectRepresentations.receiverCaptures.isCaptured(field.declaration);
  if (captured) {
    const storage = validatedRustCapturedFieldStorageFact(field.declaration, input);
    if (storage === undefined || !rustTargetTypeRefEquals(storage.valueCarrier, field.resultCarrier)) return undefined;
  } else if (records.capturedFieldStorage.get(field.declaration) !== undefined) return undefined;
  if (!(captured && parentKind === "value") &&
    parentKind !== "shared-mutable" && parentKind !== "shared-immutable") return undefined;
  if (stored.storage === "structural-object") {
    const shape = input.structuralShapes.definitionForCarrier(stored.receiverCarrier);
    const selected = input.structuralShapes.field(stored.receiverCarrier, stored.storageIndex);
    if (rustStructuralObjectCarrierValue(stored.receiverCarrier)?.representation !== "reference" ||
      shape === undefined || shape.dispatchName !== undefined || selected === undefined ||
      selected.storage !== "stored" || selected.nativeLayout !== undefined || selected.method === true ||
      selected.readonly || !rustTargetTypeRefEquals(selected.carrier, stored.resultCarrier)) return undefined;
  } else {
    const child = projectTypes.definitionForCarrier(stored.receiverCarrier);
    if (child === undefined || parent === child || child.kind !== "class" && child.kind !== "interface" ||
      projectTypes.isPolymorphic(child) || projectTypes.inheritedExternalBaseForDefinition(child) !== undefined ||
      objectRepresentations.representationFor(child)?.kind !== "shared-mutable") return undefined;
  }
  return Object.freeze({ target, value, receiver, owner, field,
    location: captured ? "captured-field" : "stored-field",
    fallible: input.frozenDataWrites.receiverFor(stored.storage, stored.receiverCarrier, stored.storageIndex) !== undefined });
}

// An element read (`values[0]`) borrows its receiver; it neither consumes nor replaces the binding (an element write
// marks the binding member-written, which already excludes it).
function isElementReadReceiver(receiver: Node, input: RustBorrowEffectsInput): boolean {
  const access = input.ast.parent(receiver);
  return access !== undefined && input.ast.is.IsElementAccessExpression(access) && Node_Expression(input.ast, access) === receiver;
}

// A typed location bound to the binding (`addressof(values)`) reads and replaces the binding's own storage cell; the
// binding stays one stable place whose reads load the cell.
function isLocationBindingArgument(argument: Node, input: RustBorrowEffectsInput): boolean {
  const call = input.ast.parent(argument);
  return call !== undefined && input.ast.is.IsCallExpression(call) && input.records.targetOperation.get(call)?.kind === "typed-location";
}
