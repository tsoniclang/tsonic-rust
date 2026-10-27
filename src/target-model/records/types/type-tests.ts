import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeTestPlan } from "../../operations/type-tests.js";
import type { RustRuntimeUnionVariant } from "../../types/carriers/runtime-unions.js";

export type RustClosedTypeTestEmission =
  | { readonly kind: "constant"; readonly value: boolean }
  | { readonly kind: "runtime-array" }
  | { readonly kind: "error"; readonly lowering: "native-error" | "closed-value" | "program-error";
      readonly errorKind: "any" | "RangeError" | "TypeError" | "URIError" }
  | { readonly kind: "project"; readonly plan: RustProjectTypeTestPlan }
  | { readonly kind: "option"; readonly test: RustClosedTypeTestEmission }
  | { readonly kind: "union"; readonly carrier: TargetTypeRef; readonly form: "matches" | "match";
      readonly arms: readonly { readonly variant: RustRuntimeUnionVariant; readonly test: RustClosedTypeTestEmission }[] };

export interface RustClosedTypeTestSource {
  readonly operand: Node;
  readonly test: RustClosedTypeTestEmission;
}
