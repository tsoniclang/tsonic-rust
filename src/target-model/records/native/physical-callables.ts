import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableConversion } from "../../conversions/generic-callable.js";
import type { TargetTypeRef } from "../../types/model.js";

export type RustPhysicalCallableFlowApplication =
  | { readonly kind: "identity" }
  | { readonly kind: "variants"; readonly source: TargetTypeRef; readonly destination: TargetTypeRef;
      readonly members: readonly { readonly source: string; readonly target: string }[] }
  | { readonly kind: "missing-destination" }
  | { readonly kind: "unavailable" };

export interface RustPhysicalCallableFlowRecords {
  readonly genericCallableFlow: { readonly get: (node: Node, conversion: RustGenericCallableConversion,
    destination: TargetTypeRef | undefined) => RustPhysicalCallableFlowApplication | undefined };
}
