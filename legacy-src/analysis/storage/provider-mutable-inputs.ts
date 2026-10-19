import type { Node } from "@tsonic/tsts";
import { Node_Expression, BinaryExpression_Left, BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression, asSourceNode } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs } from "../operations/finalized-operation/conversions.js";
import type { RustFinalizedSourceInput } from "../../target-model/records/finalized-operation.js";
import { providerSourceInputKey, providerSourceInputNode } from "../operations/provider-source-inputs.js";

import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { rustTargetOperationIsDirectLocation } from "../operations/target-operation.js";
import { rustNativeStoragePathsDisjoint, rustNativeStorageProjections, rustNativeStorageRoot } from "./native-paths.js";
import type { RustNativeStoragePathInput, RustNativeStorageProjection } from "./native-paths.js";
import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import type { RustStatementCompletionRecords } from "../../target-model/records/statement-completion.js";

type ProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>;

type RustProviderMutableInputContext = RustNativeStoragePathInput & {
  readonly statementCompletions: Pick<RustStatementCompletionRecords, "runtimeSetter">;
};

export type RustProviderMutableInputSelection =
  | { readonly kind: "proved"; readonly operation: ProviderOperation;
      readonly inputs: readonly { readonly input: RustFinalizedSourceInput; readonly key: string; readonly node: Node }[] }
  | { readonly kind: "rejected"; readonly node: Node; readonly reason: string };

export interface RustProviderMutableInputPlan {
  forOperation(node: Node): RustProviderMutableInputSelection | undefined;
}

export function createRustProviderMutableInputPlan(input: RustProviderMutableInputContext & {
  readonly nodes: readonly Node[];
}): RustProviderMutableInputPlan {
  const selections = new Map<Node, RustProviderMutableInputSelection>();
  for (const node of input.nodes) {
    const operation = input.records.compoundWrite.get(node) ?? input.records.targetOperation.get(node);
    if (operation?.kind !== "provider-operation" && operation?.kind !== "runtime-set") continue;
    const selected = selectRustProviderMutableInputs(node, operation, input);
    if (selected !== undefined) selections.set(node, selected);
  }
  return Object.freeze({ forOperation: (node: Node) => selections.get(node) });
}

export function selectRustProviderMutableInputs(
  operationNode: Node, operation: ProviderOperation, input: RustProviderMutableInputContext,
): RustProviderMutableInputSelection | undefined {
  if ((input.records.compoundWrite.get(operationNode) ?? input.records.targetOperation.get(operationNode)) !== operation)
    return Object.freeze({ kind: "rejected", node: operationNode,
      reason: "Mutable provider admission requires its exact owned operation fact." });
  const mutable = rustFinalizedSourceInputs(operation.abi).filter(value => value.mode === "mut-ref");
  if (mutable.length === 0) return undefined;
  const setter = operation.kind === "runtime-set" ? input.statementCompletions.runtimeSetter.get(operationNode) : undefined;
  if (operation.kind === "runtime-set" && setter === undefined) return Object.freeze({ kind: "rejected", node: operationNode,
    reason: "Mutable setter admission requires its exact admitted source operand binding." });
  const kind = input.ast.kindName(operationNode);
  const selectedReceiver = input.records.selectedOperation.get(operationNode)?.provenance?.sourceReceiver;
  const callee = kind === "KindCallExpression" || kind === "KindNewExpression" ? Node_Expression(input.ast, operationNode) : undefined;
  const receiver = operation.kind === "runtime-set" ? setter!.receiver
    : asSourceNode(selectedReceiver, input.ast) ?? rustMemberAccessReceiver(input.ast, callee ?? operationNode);
  let arguments_: readonly (Node | undefined)[];
  if (operation.kind === "runtime-set") arguments_ = setter!.sourceArguments;
  else if (kind === "KindElementAccessExpression") arguments_ = [ElementAccessExpression_ArgumentExpression(input.ast, operationNode)];
  else if (kind === "KindBinaryExpression") {
    const left = BinaryExpression_Left(input.ast, operationNode);
    const right = BinaryExpression_Right(input.ast, operationNode);
    arguments_ = left !== undefined && input.ast.is.IsElementAccessExpression(left) &&
      receiver === rustMemberAccessReceiver(input.ast, left)
      ? [ElementAccessExpression_ArgumentExpression(input.ast, left), right] : [right];
  } else arguments_ = [...input.ast.arguments(operationNode)];
  const selected: { input: RustFinalizedSourceInput; key: string; node: Node }[] = [];
  const paths: { root: Node; projections: readonly RustNativeStorageProjection[] }[] = [];
  const keys = new Set<string>();
  const reject = (node: Node, reason: string): RustProviderMutableInputSelection => Object.freeze({ kind: "rejected", node, reason });
  for (const value of mutable) {
    const source = providerSourceInputNode(value, receiver, arguments_);
    if (source === undefined) return reject(operationNode, "Mutable provider input has no exact authored source operand.");
    const key = providerSourceInputKey(value);
    if (keys.has(key)) return reject(source, "One source value cannot supply multiple mutable inputs to one Rust provider operation.");
    keys.add(key);
    let node = source;
    const marker = input.records.targetOperation.get(source);
    if (marker?.kind === "flow-marker") {
      const operands = [...input.ast.arguments(source)];
      if (marker.state !== "borrowed-mut" || operands.length !== 1 || operands[0] === undefined)
        return reject(source, "Mutable provider input requires its exact finalized mutable-borrow operand.");
      node = operands[0];
    }
    if (value.conversion.kind !== "identity") return reject(node, "Mutable provider input requires one exact identity conversion.");
    selected.push({ input: value, key, node });
    if (mutable.length <= 1) continue;
    const fact = input.records.targetOperation.get(node);
    const direct = input.ast.is.IsIdentifier(node) && input.records.sourceBinding.get(node) !== undefined ||
      ["KindThisExpression", "KindThisKeyword"].includes(input.ast.kindName(node)) || rustTargetOperationIsDirectLocation(fact) ||
      fact?.kind === "source-field" && fact.valueSemantics.kind === "stored" && fact.dispatch === undefined;
    if (!direct) continue;
    const root = rustNativeStorageRoot(node, input);
    if (root === undefined) {
      return reject(node, "Multiple direct mutable provider inputs require exact disjoint source storage roots.");
    }
    const projections = rustNativeStorageProjections(node, root, input);
    if (projections === undefined) return reject(node, "Mutable provider input has no exact projection path from its source storage root.");
    if (paths.some(previous => previous.root === root && !rustNativeStoragePathsDisjoint(previous.projections, projections)))
      return reject(node, "One provider operation cannot hold overlapping mutable Rust locations from the same exact source storage root.");
    paths.push({ root, projections });
  }
  return Object.freeze({ kind: "proved", operation, inputs: Object.freeze(selected.map(value => Object.freeze(value))) });
}
