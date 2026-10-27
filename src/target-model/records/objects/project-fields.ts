import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustProjectFieldSelection = Omit<
  Extract<RustTargetOperationFact, { readonly kind: "source-field" }>, "operationId" | "accessMode"
>;

export interface RustProjectStaticFieldStorage {
  readonly declaration: Node;
  readonly fileName: string;
  readonly targetName: string;
}
