import type { AstReader, Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustFixedArrayCarrierValue } from "../../target-model/types/index.js";
import { isRustFinalizedSourceInput } from "../../target-model/operations/finalized-inputs.js";
import { rustBorrowValueIsUnprojected } from "./borrowed-element-purity.js";

export interface RustNativeStoragePathInput {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly navigation: RustAnalysisProgram["sourceNavigation"];
}

export const rustNativeIndexStorageProjection = Symbol("native-index");

export type RustNativeStorageProjection = Node | string | typeof rustNativeIndexStorageProjection;

export function rustNativeStorageRoot(node: Node, input: RustNativeStoragePathInput): Node | undefined {
  const visited = new Set<Node>();
  while (!visited.has(node)) {
    visited.add(node);
    if (input.ast.is.IsIdentifier(node)) return input.navigation.sourceReferenceFor(node)?.declaration;
    const kind = input.ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") return input.ast.getSourceFile(node);
    const receiver = Node_Expression(input.ast, node);
    if (receiver === undefined) return undefined;
    node = receiver;
  }
  return undefined;
}

export function rustNativeStorageProjections(
  node: Node, root: Node, input: RustNativeStoragePathInput,
): readonly RustNativeStorageProjection[] | undefined {
  const projections: RustNativeStorageProjection[] = [];
  const visited = new Set<Node>();
  while (!visited.has(node)) {
    visited.add(node);
    const kind = input.ast.kindName(node);
    if (kind === "KindIdentifier") return input.navigation.sourceReferenceFor(node)?.declaration === root
      ? Object.freeze(projections) : undefined;
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") return input.ast.getSourceFile(node) === root
      ? Object.freeze(projections) : undefined;
    if (kind === "KindElementAccessExpression") {
      const receiver = Node_Expression(input.ast, node);
      const index = ElementAccessExpression_ArgumentExpression(input.ast, node);
      const operation = input.records.targetOperation.get(node);
      const carrier = receiver === undefined ? undefined : input.records.runtimeCarrier.get(receiver)?.carrier;
      const container = carrier?.kind === "reference" ? carrier.referent : carrier;
      const element = container?.kind === "array" || container?.kind === "slice" ? container.element
        : rustFixedArrayCarrierValue(container)?.element;
      if (receiver === undefined || index === undefined || element === undefined ||
        !rustTargetTypeRefEquals(element, input.records.runtimeCarrier.get(node)?.carrier) ||
        !rustBorrowValueIsUnprojected(node, input.records)) return undefined;
      if (operation?.kind === "provider-operation") {
        const abi = operation.abi;
        const targetArgument = abi.targetArguments[0];
        if (abi.operationKind !== "indexer" || abi.target.form !== "index" ||
          abi.result.kind !== "sync" || abi.result.conversion.kind !== "identity" ||
          !rustTargetTypeRefEquals(abi.result.carrier, element) ||
          abi.effects.evaluation !== "pure" || abi.effects.invocation !== "infallible" || abi.effects.safety !== "safe" ||
          abi.sourceReceiver.kind !== "receiver" || !rustTargetTypeRefEquals(abi.sourceReceiver.carrier, carrier) ||
          abi.targetReceiver.kind !== "input" || !rustTargetTypeRefEquals(abi.targetReceiver.input.sourceCarrier, carrier) ||
          abi.targetReceiver.input.source.kind !== "receiver" || abi.targetReceiver.input.conversion.kind !== "identity" ||
          abi.sourceArguments.length !== 1 || abi.sourceArguments[0]?.sourceIndex !== 0 ||
          abi.targetArguments.length !== 1 || targetArgument === undefined || !isRustFinalizedSourceInput(targetArgument) ||
          targetArgument.source.kind !== "argument" || targetArgument.source.sourceIndex !== 0) return undefined;
      } else if (operation?.kind !== "fixed-index") return undefined;
      projections.unshift(rustNativeIndexStorageProjection);
    } else if (kind !== "KindParenthesizedExpression") {
      if (kind !== "KindPropertyAccessExpression") return undefined;
      const operation = input.records.targetOperation.get(node);
      if (operation?.kind !== "source-field" || operation.dispatch !== undefined) return undefined;
      if (operation.valueSemantics.kind === "receiver-alias") {
        if (operation.accessMode !== "read" || !rustTargetTypeRefEquals(operation.receiverCarrier, operation.resultCarrier) ||
          !rustBorrowValueIsUnprojected(node, input.records)) return undefined;
      } else {
        if (operation.valueSemantics.kind !== "stored" || !Number.isSafeInteger(operation.storageIndex) ||
          operation.storageIndex < 0) return undefined;
        projections.unshift(operation.declaration ?? `${operation.operationId}\0${operation.storageIndex}`);
      }
    }
    const receiver = Node_Expression(input.ast, node);
    if (receiver === undefined) return undefined;
    node = receiver;
  }
  return undefined;
}

export function rustNativeStoragePathsDisjoint(
  left: readonly RustNativeStorageProjection[], right: readonly RustNativeStorageProjection[],
): boolean {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] !== rustNativeIndexStorageProjection && right[index] !== rustNativeIndexStorageProjection;
    }
  }
  return false;
}
