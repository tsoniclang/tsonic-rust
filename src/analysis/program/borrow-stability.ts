import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  rustSourceBindingFactKey,
  rustTargetOperationFactKey,
  type RustTargetOperationFact,
} from "../facts/keys.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustTargetProgram } from "./model.js";
import { rustBorrowPrimitiveCopyValue, rustBorrowPureCopyValue, rustBorrowValueIsUnprojected } from "./borrowed-element-purity.js";
import { rustCapturedFieldStorageFactKey, validatedRustCapturedFieldStorageFact } from "../facts/receiver-captures.js";
import { rustNativeStoragePathsDisjoint, rustNativeStorageProjections, rustNativeStorageRoot } from "../facts/native-storage-paths.js";
import { rustNativeCopyWriteTargets, rustNoNativeCopyWrites } from "./borrow-stability-effects.js";

type StoredField = Extract<RustTargetOperationFact, { readonly kind: "source-field" }>;

export interface RustBorrowedFieldWrite {
  readonly target: Node;
  readonly value: Node;
  readonly receiver: Node;
  readonly owner: Node;
  readonly field: StoredField;
  readonly fallible: boolean;
  readonly location: "captured-field" | "stored-field";
}

export interface RustBorrowStabilityPlan {
  isPureCopyValue(node: Node): boolean;
  borrowedWriteFor(node: Node): RustBorrowedFieldWrite | undefined;
  canBorrowAcross(source: Node, later: Node): boolean;
}

interface RustBorrowStabilityInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustTargetProgram["facts"];
  readonly projectTypes: RustTargetProgram["projectTypes"];
  readonly objectRepresentations: RustTargetProgram["objectRepresentations"];
  readonly frozenDataWrites: RustTargetProgram["frozenDataWrites"];
  readonly structuralShapes: RustTargetProgram["structuralShapes"];
  readonly navigation: RustTargetProgram["sourceNavigation"];
}

export type AnalyzeRustBorrowStabilityResult =
  | { readonly kind: "resolved"; readonly plan: RustBorrowStabilityPlan }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

const maximumBorrowStabilityNodes = 4_194_304;

export function analyzeRustBorrowStability(
  input: RustBorrowStabilityInput,
  maximumNodes = maximumBorrowStabilityNodes,
): AnalyzeRustBorrowStabilityResult {
  const rejected = (message: string): AnalyzeRustBorrowStabilityResult => ({
    kind: "rejected", diagnostics: [{
      code: "RUST_BORROW_STABILITY_BUDGET_INVALID", category: "error", source: "tsonic-rust", message,
      evidence: ["target.capability=rust.backend.borrow-stability"],
    }],
  });
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1 || maximumNodes > maximumBorrowStabilityNodes) {
    return rejected("Rust borrow stability requires a positive finite node budget within its analysis bound.");
  }
  const pending: { readonly node: Node; readonly complete: boolean }[] = [];
  const visited = new WeakSet<Node>();
  const active = new WeakSet<Node>();
  const pure = new WeakSet<Node>();
  const writes = new WeakMap<Node, RustBorrowedFieldWrite>();
  const nativeWrites = new WeakMap<Node, readonly Node[]>();
  const directField = (node: Node): boolean => {
    const field = ordinaryStoredField(node, input);
    if (field === undefined || field.storage !== "project-object") return false;
    const receiver = Node_Expression(input.ast, node);
    return rustTargetTypeRefEquals(field.resultCarrier, input.facts.getRuntimeCarrierFact(node)?.carrier) &&
      receiver !== undefined && rustTargetTypeRefEquals(field.receiverCarrier, input.facts.getRuntimeCarrierFact(receiver)?.carrier) &&
      input.objectRepresentations.representationFor(input.projectTypes.definitionForCarrier(field.receiverCarrier))?.kind === "value" &&
      (field.declaration === undefined || !input.objectRepresentations.receiverCaptures.isCaptured(field.declaration));
  };
  let reservations = 0;
  let exhausted = false;
  const reserve = (node: Node): void => {
    if (exhausted) return;
    if (++reservations > maximumNodes) { exhausted = true; return; }
    pending.push({ node, complete: false });
  };
  const reserveTargets = (count: number): boolean => {
    reservations += count;
    if (reservations > maximumNodes) exhausted = true;
    return !exhausted;
  };
  input.sourceFiles.forEach(reserve);
  while (pending.length !== 0 && !exhausted) {
    const entry = pending.pop()!;
    if (entry.complete) {
      active.delete(entry.node);
      visited.add(entry.node);
      if (rustBorrowPureCopyValue(entry.node, input.ast, input.facts, child => pure.has(child))) pure.add(entry.node);
      const selected = selectBorrowedWrite(entry.node, pure, input);
      if (selected !== undefined) writes.set(entry.node, selected);
      if (!pure.has(entry.node)) {
        const targets = rustNativeCopyWriteTargets(entry.node, input,
          node => pure.has(node) ? rustNoNativeCopyWrites : nativeWrites.get(node), directField, reserveTargets);
        if (targets !== undefined) nativeWrites.set(entry.node, targets);
      }
    } else {
      if (active.has(entry.node)) return rejected("Rust borrow stability encountered a cyclic source-node graph.");
      if (visited.has(entry.node)) continue;
      active.add(entry.node);
      pending.push({ node: entry.node, complete: true });
      input.ast.forEachChild(entry.node, child => { if (child !== undefined && !exhausted) reserve(child); });
    }
  }
  if (exhausted) return rejected("Rust borrow stability exceeds its finite source-node accounting bound.");
  return { kind: "resolved", plan: Object.freeze({
    isPureCopyValue: (node: Node) => pure.has(node),
    borrowedWriteFor: (node: Node) => writes.get(node),
    canBorrowAcross(source: Node, later: Node): boolean {
      if (!directField(source)) return false;
      const field = input.facts.getFact(source, rustTargetOperationFactKey);
      if (field?.kind !== "source-field" || field.accessMode !== "read") return false;
      const root = rustNativeStorageRoot(source, input);
      const path = root === undefined ? undefined : rustNativeStorageProjections(source, root, input);
      const targets = pure.has(later) ? rustNoNativeCopyWrites : nativeWrites.get(later);
      return root !== undefined && path !== undefined && targets !== undefined && targets.every(target => {
        const targetRoot = rustNativeStorageRoot(target, input);
        const targetPath = targetRoot === root ? rustNativeStorageProjections(target, root, input) : undefined;
        return targetPath !== undefined && rustNativeStoragePathsDisjoint(path, targetPath);
      });
    },
  }) };
}

function ordinaryStoredField(node: Node, input: RustBorrowStabilityInput): StoredField | undefined {
  const selected = input.facts.getFact(node, rustTargetOperationFactKey);
  return input.ast.is.IsPropertyAccessExpression(node) && rustBorrowValueIsUnprojected(node, input.facts) &&
    selected?.kind === "source-field" && selected.valueSemantics.kind === "stored" && selected.dispatch === undefined &&
    Number.isSafeInteger(selected.storageIndex) && selected.storageIndex >= 0 &&
    (selected.declaration === undefined || input.objectRepresentations.aliasFor(selected.declaration) === undefined)
    ? selected : undefined;
}

function selectBorrowedWrite(
  node: Node, pure: WeakSet<Node>, input: RustBorrowStabilityInput,
): RustBorrowedFieldWrite | undefined {
  const { ast, facts, projectTypes, objectRepresentations } = input;
  const assignment = facts.getFact(node, rustTargetOperationFactKey);
  if (!ast.is.IsBinaryExpression(node) || assignment?.kind !== "operator-token" || assignment.operator !== "=" ||
    assignment.leftConversion !== undefined || assignment.rightConversion !== undefined) return undefined;
  const target = BinaryExpression_Left(ast, node);
  const value = BinaryExpression_Right(ast, node);
  const receiver = target === undefined ? undefined : Node_Expression(ast, target);
  const owner = receiver === undefined ? undefined : Node_Expression(ast, receiver);
  if (target === undefined || value === undefined || receiver === undefined || owner === undefined ||
    !pure.has(value) || !rustBorrowPrimitiveCopyValue(target, facts) || !rustBorrowValueIsUnprojected(owner, facts) ||
    !(ast.is.IsIdentifier(owner) && facts.getFact(owner, rustSourceBindingFactKey)?.scope === "lexical" ||
      ast.kindName(owner) === "KindThisExpression" || ast.kindName(owner) === "KindThisKeyword")) return undefined;
  const stored = ordinaryStoredField(target, input);
  const field = ordinaryStoredField(receiver, input);
  if (stored === undefined || stored.accessMode !== "write" || field === undefined || field.accessMode !== "read" ||
    field.storage !== "project-object" || field.declaration === undefined ||
    stored.declaration !== undefined && objectRepresentations.receiverCaptures.isCaptured(stored.declaration) ||
    !rustTargetTypeRefEquals(field.resultCarrier, stored.receiverCarrier) ||
    !rustTargetTypeRefEquals(field.resultCarrier, facts.getRuntimeCarrierFact(receiver)?.carrier) ||
    !rustTargetTypeRefEquals(stored.resultCarrier, facts.getRuntimeCarrierFact(target)?.carrier) ||
    !rustTargetTypeRefEquals(field.receiverCarrier, facts.getRuntimeCarrierFact(owner)?.carrier) ||
    !rustTargetTypeRefEquals(stored.resultCarrier, facts.getRuntimeCarrierFact(value)?.carrier)) return undefined;
  const parent = projectTypes.definitionForCarrier(field.receiverCarrier);
  if (parent === undefined || parent.kind !== "class" || projectTypes.isPolymorphic(parent) ||
    projectTypes.inheritedExternalBaseForDefinition(parent) !== undefined ||
    projectTypes.definitionContainingDeclaration(field.declaration) !== parent) return undefined;
  const parentKind = objectRepresentations.representationFor(parent)?.kind;
  const captured = objectRepresentations.receiverCaptures.isCaptured(field.declaration);
  if (captured) {
    const storage = validatedRustCapturedFieldStorageFact(field.declaration, input);
    if (storage === undefined || !rustTargetTypeRefEquals(storage.valueCarrier, field.resultCarrier)) return undefined;
  } else if (facts.getFact(field.declaration, rustCapturedFieldStorageFactKey) !== undefined) return undefined;
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
