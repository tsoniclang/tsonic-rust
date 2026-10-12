import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "./finalized-operation-abi.js";

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
