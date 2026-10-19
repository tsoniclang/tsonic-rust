import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustLifetimeRef } from "../lifetimes/model.js";
import type { RustClassValueCallable } from "./class-value-callables.js";
import type { RustStructuralShapeField } from "./structural-shapes.js";

export interface RustClassImplementationContext {
  readonly names: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, TargetTypeRef>;
  readonly lifetimes: ReadonlyMap<string, RustLifetimeRef>;
}

export interface RustClassImplementationGenerics {
  readonly parameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly lifetimes: readonly Extract<RustLifetimeRef, { readonly kind: "parameter" }>[];
}

export interface RustClassConstructorViewEmission {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly genericCarrier: TargetTypeRef;
  readonly dispatchName: string;
  readonly construction: { readonly callable: RustClassValueCallable; readonly name: string } | undefined;
  readonly fields: readonly { readonly declaration: Node; readonly fileName: string; readonly targetName: string;
    readonly storage: RustStructuralShapeField; readonly callable: RustClassValueCallable | undefined }[];
}

export interface RustClassImplementationRecords {
  readonly classImplementationContext: { readonly get: (declaration: Node, carrier: TargetTypeRef) => RustClassImplementationContext | undefined };
  readonly classImplementationGenerics: { readonly get: (carrier: TargetTypeRef) => RustClassImplementationGenerics | undefined };
  readonly classConstructorViews: { readonly get: (declaration: Node, fileName: string) => readonly RustClassConstructorViewEmission[] | undefined };
}
