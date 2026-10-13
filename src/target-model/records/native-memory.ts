import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustNativeMemoryLayout } from "../operations/native-memory.js";

export type RustNativeArrayStorage = {
  readonly layout: RustNativeMemoryLayout;
  readonly stride: number;
} & ({ readonly kind: "element"; readonly declaration: Node } |
  { readonly kind: "binding" | "reference" | "literal" });

export interface RustRawLocationPlan {
  readonly operation: "to-raw" | "reinterpret";
  readonly expression: Node;
  readonly inputCarrier: TargetTypeRef;
  readonly layout: RustNativeMemoryLayout;
}
