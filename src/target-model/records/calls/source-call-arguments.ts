import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustTargetOperationFact } from "../operations/operations.js";
import type { RustSourceCallArgumentProjection } from "../../operations/model.js";

export type RustSourceCallFact = Extract<RustTargetOperationFact, { readonly kind: "source-call" }>;

export interface RustSourceCallInputEmission {
  readonly argumentIndex: number;
  readonly projection: { readonly kind: "tuple" | "fixed" | "element"; readonly index: number; readonly clone: boolean;
    readonly conversion: Extract<RustSourceCallArgumentProjection, { readonly kind: "element" }>["conversion"] } | undefined;
  readonly passing: "value" | "identity" | "ref" | "mut-ref";
  readonly sequence: "value" | "native" | "js";
}

export type RustSourceParameterEmission = {
  readonly form: "required" | "optional" | "default" | "rest";
  readonly carrier: TargetTypeRef;
  readonly inputs: readonly RustSourceCallInputEmission[];
} & ({ readonly rest: "native" | "js" | "fixed" } |
  { readonly rest: "tuple"; readonly omitted: readonly TargetTypeRef[] });

export interface RustSourceCallEvaluationEmission {
  readonly arguments: readonly { readonly source: Node; readonly expression: Node; readonly destination: TargetTypeRef | undefined;
    readonly mutable: boolean; readonly borrow: "value" | "identity" | "ref" | "mut-ref";
    readonly elements: readonly { readonly index: number; readonly mode: "value" | "ref" | "mut-ref" }[] }[];
  readonly spread: boolean;
}

export type RustSourceCallArgumentEmission =
  | { readonly kind: "value" }
  | { readonly kind: "singleton"; readonly element: Node; readonly later: readonly Node[] };
