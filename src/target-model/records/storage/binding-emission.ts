import type { TargetTypeRef } from "../../types/model.js";
import type { RustBindingValueProjectionFact } from "../objects/value-projections.js";

export type RustBindingProjectionOwnership = "copy" | "clone";

interface RustBindingProjectionSelection {
  readonly retainStorage: boolean;
  readonly fact: RustBindingValueProjectionFact;
  readonly checkedElement: TargetTypeRef | undefined;
}

export type RustBindingProjectionEmission = RustBindingProjectionSelection & (
  | { readonly kind: "object-field"; readonly storage: "project-object" | "structural-object"; readonly index: number }
  | { readonly kind: "object-rest"; readonly storage: "project-object" | "structural-object";
      readonly fields: readonly { readonly sourceIndex: number; readonly carrier: TargetTypeRef; readonly method: boolean }[] }
  | { readonly kind: "tuple-element" | "fixed-array-element" | "vec-element"; readonly index: number; readonly ownership: RustBindingProjectionOwnership }
  | { readonly kind: "checked-vec-element" | "js-array-element"; readonly index: number }
  | { readonly kind: "tuple-rest"; readonly start: number; readonly elements: readonly RustBindingProjectionOwnership[]; readonly syntax: "tuple" | "slice" }
  | { readonly kind: "fixed-array-rest"; readonly start: number; readonly end: string; readonly output: "array" | "vector" }
  | { readonly kind: "vec-rest" | "js-array-rest"; readonly start: number }
);
