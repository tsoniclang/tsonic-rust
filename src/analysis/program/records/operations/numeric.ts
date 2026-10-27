import type { Node } from "@tsonic/tsts";
import type { RustNumericRepresentations } from "../../../../target-model/records/operations/numeric.js";

export function createRustNumericRepresentationRecords(expressions: readonly Node[]): RustNumericRepresentations {
  const selected = new WeakSet(expressions);
  return Object.freeze({ int32Remainder: Object.freeze({ get: (expression: Node) => selected.has(expression) }) });
}
