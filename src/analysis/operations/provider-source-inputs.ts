import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../target-model/records/finalized-operation.js";

export function providerSourceInputNode(
  input: RustFinalizedSourceInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): Node | undefined {
  return input.source.kind === "receiver" ? receiverNode : argumentNodes[input.source.sourceIndex];
}

export function providerSourceInputKey(input: RustFinalizedSourceInput): string {
  return input.source.kind === "receiver" ? "receiver" : `argument:${input.source.sourceIndex}`;
}
