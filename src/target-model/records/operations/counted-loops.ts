import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export type RustCountedLoopRepresentation =
  | { readonly kind: "native-counter"; readonly counterDeclaration: Node; readonly start: Node;
      readonly bound: Node; readonly body: Node; readonly rangeCarrier: TargetTypeRef }
  | { readonly kind: "integer-range-number-counter"; readonly counterDeclaration: Node; readonly start: Node;
      readonly bound: Node; readonly body: Node; readonly rangeCarrier: TargetTypeRef; readonly counterCarrier: TargetTypeRef };
