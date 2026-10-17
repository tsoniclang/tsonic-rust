import type { Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { RustNativeInputPlace, RustNativePlace } from "../../target-model/records/ownership.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionContext, RustPhysicalEmissionOperand } from "../../target-model/records/physical-emission-contexts.js";
import { rustFinalizedSourceInputs } from "../operations/finalized-operation/conversions.js";
import { providerSourceInputKey } from "../operations/provider-source-inputs.js";
import { rustTargetOperationIsDirectLocation } from "../operations/target-operation.js";
import type { RustNativeStoragePathInput } from "./native-paths.js";
import { rustNativeStoragePathsDisjoint } from "./native-paths.js";

type ProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>;

type RustProviderMutableInputContext = RustNativeStoragePathInput & {
  readonly physicalEmissionContexts: RustCallableEmissionContexts;
  readonly nativePlaces: ReadonlyMap<TargetUseSiteRef, RustNativeInputPlace>;
};

export type RustProviderMutableInputSelection =
  | { readonly kind: "proved"; readonly operation: ProviderOperation; readonly context: RustPhysicalEmissionContext;
      readonly contextUse: TargetUseSiteRef; readonly inputs: readonly RustNativeInputPlace[] }
  | { readonly kind: "rejected"; readonly node: Node; readonly reason: string };

export interface RustProviderMutableInputPlan {
  readonly operations: readonly { readonly node: Node; readonly operation: ProviderOperation;
    readonly contextUse: TargetUseSiteRef; readonly selection: RustProviderMutableInputSelection }[];
  forOperation(node: Node, operation: ProviderOperation, contextUse: TargetUseSiteRef): RustProviderMutableInputSelection | undefined;
}

export function createRustProviderMutableInputPlan(input: RustProviderMutableInputContext): RustProviderMutableInputPlan {
  const groups = new Map<Node, Map<ProviderOperation, Map<TargetUseSiteRef, RustPhysicalEmissionOperand[]>>>();
  for (const operand of input.physicalEmissionContexts.operands) {
    const origin = operand.origin;
    const source = origin.kind !== "call-input" && origin.evaluation.kind === "provider-source"
      ? origin.evaluation.slot : undefined;
    const node = origin.kind === "call-input" ? origin.operationNode : source?.operationNode;
    const operation = origin.kind === "call-input" ? origin.operation : source?.operation;
    if (node === undefined || operation === undefined ||
      !rustFinalizedSourceInputs(operation.abi).some(value => value.mode === "mut-ref")) continue;
    const operations = groups.get(node) ?? new Map<ProviderOperation, Map<TargetUseSiteRef, RustPhysicalEmissionOperand[]>>();
    const contexts = operations.get(operation) ?? new Map<TargetUseSiteRef, RustPhysicalEmissionOperand[]>();
    const operands = contexts.get(operand.context.use) ?? [];
    if (origin.kind === "call-input" && origin.input.mode === "mut-ref") operands.push(operand);
    contexts.set(operand.context.use, operands);
    operations.set(operation, contexts);
    groups.set(node, operations);
  }
  const selections = new Map<Node, Map<ProviderOperation, Map<TargetUseSiteRef, RustProviderMutableInputSelection>>>();
  const inventory: RustProviderMutableInputPlan["operations"][number][] = [];
  for (const [node, operations] of groups) for (const [operation, contexts] of operations) {
    const selectedContexts = new Map<TargetUseSiteRef, RustProviderMutableInputSelection>();
    for (const [contextUse, operands] of contexts) {
      const selection = selectRustProviderMutableInputs(node, operation, contextUse, operands, input);
      if (selection === undefined) continue;
      selectedContexts.set(contextUse, selection);
      inventory.push(Object.freeze({ node, operation, contextUse, selection }));
    }
    const selectedOperations = selections.get(node) ?? new Map<ProviderOperation, Map<TargetUseSiteRef, RustProviderMutableInputSelection>>();
    selectedOperations.set(operation, selectedContexts);
    selections.set(node, selectedOperations);
  }
  return Object.freeze({ operations: Object.freeze(inventory),
    forOperation: (node: Node, operation: ProviderOperation, contextUse: TargetUseSiteRef) =>
      selections.get(node)?.get(operation)?.get(contextUse) });
}

export function selectRustProviderMutableInputs(
  operationNode: Node, operation: ProviderOperation, contextUse: TargetUseSiteRef,
  operands: readonly RustPhysicalEmissionOperand[], input: RustProviderMutableInputContext,
): RustProviderMutableInputSelection | undefined {
  const reject = (node: Node, reason: string): RustProviderMutableInputSelection => Object.freeze({ kind: "rejected", node, reason });
  const primary = input.records.compoundWrite.get(operationNode) ?? input.records.targetOperation.get(operationNode);
  if (primary !== operation && !(primary?.kind === "union-property" &&
    primary.variants.some(variant => variant.operation === operation)))
    return reject(operationNode, "Mutable provider admission requires its exact owned operation fact.");
  const mutable = rustFinalizedSourceInputs(operation.abi).filter(value => value.mode === "mut-ref");
  if (mutable.length === 0) return undefined;
  const keys = new Set<string>();
  for (const value of mutable) {
    const key = providerSourceInputKey(value);
    if (keys.has(key)) return reject(operationNode, "One source value cannot supply multiple mutable inputs to one Rust provider operation.");
    keys.add(key);
  }
  const context = input.physicalEmissionContexts.contextFor(contextUse);
  const occurrence = input.physicalEmissionContexts.sourceFor(operationNode, operation);
  if (context === undefined || occurrence === undefined || occurrence.operation !== operation ||
    occurrence.node !== operationNode || operands.length !== mutable.length)
    return reject(operationNode, "Mutable provider admission requires every exact physical input in its original emission context.");
  const selected: RustNativeInputPlace[] = [];
  const directPaths: NonNullable<RustNativePlace["sourcePath"]>[] = [];
  for (const value of mutable) {
    const key = providerSourceInputKey(value);
    const sourceRows = occurrence.inputs.filter(row => row.input === value);
    const physicalRows = operands.filter(operand => operand.origin.kind === "call-input" && operand.origin.input === value);
    if (sourceRows.length !== 1 || physicalRows.length !== 1)
      return reject(operationNode, "Mutable provider input requires one original source slot and one original physical operand.");
    const operand = physicalRows[0]!;
    const place = input.nativePlaces.get(operand.use);
    if (place === undefined || place.operand !== operand || place.operand.context !== context ||
      place.input !== value || place.slot !== sourceRows[0]!.slot || place.key !== key)
      return reject(operationNode, "Mutable provider input has no exact admitted physical place for its original input use.");
    const node = place.node;
    if (value.conversion.kind !== "identity") return reject(node, "Mutable provider input requires one exact identity conversion.");
    selected.push(place);
    if (mutable.length <= 1) continue;
    const fact = input.records.targetOperation.get(node);
    const direct = input.ast.is.IsIdentifier(node) && input.records.sourceBinding.get(node) !== undefined ||
      ["KindThisExpression", "KindThisKeyword"].includes(input.ast.kindName(node)) || rustTargetOperationIsDirectLocation(fact) ||
      fact?.kind === "source-field" && fact.valueSemantics.kind === "stored" && fact.dispatch === undefined;
    if (!direct) continue;
    const path = place.place.sourcePath;
    if (path === undefined) return reject(node,
      "Multiple direct mutable provider inputs require an exact projection path from their source storage root.");
    if (directPaths.some(previous => previous.declaration === path.declaration &&
      !rustNativeStoragePathsDisjoint(previous.projections, path.projections)))
      return reject(node, "One provider operation cannot hold overlapping mutable Rust locations from the same exact source storage root.");
    directPaths.push(path);
  }
  return Object.freeze({ kind: "proved", operation, context, contextUse, inputs: Object.freeze(selected) });
}
