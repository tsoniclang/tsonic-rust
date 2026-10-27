import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustLifetimeRef } from "../../lifetimes/model.js";
import type { RustClassValueCallable } from "../callables/class-value-callables.js";
import type { RustStructuralShapeField } from "./structural-shapes.js";
import type { RustProjectStructuralView, RustProjectStructuralViewImplementation } from "./project-structural-views.js";
import type { RustShapeGenericRequirementContract } from "../types/generic-requirements.js";

export interface RustClassImplementationContext {
  readonly names: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, TargetTypeRef>;
  readonly lifetimes: ReadonlyMap<string, RustLifetimeRef>;
}

export interface RustClassImplementationGenerics {
  readonly parameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly lifetimes: readonly Extract<RustLifetimeRef, { readonly kind: "parameter" }>[];
}

export interface RustClassStructuralViewEmission extends RustProjectStructuralViewImplementation {
  readonly nativeTargetCarrier: TargetTypeRef;
  readonly nativeLifetimes: readonly Extract<RustLifetimeRef, { readonly kind: "parameter" }>[];
  readonly nativeOutlives: readonly { readonly carrier: TargetTypeRef; readonly lifetime: RustLifetimeRef }[];
}

export interface RustClassConstructorViewEmission {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly genericCarrier: TargetTypeRef;
  readonly construction: { readonly callable: RustClassValueCallable; readonly name: string } | undefined;
  readonly fields: readonly { readonly declaration: Node; readonly fileName: string; readonly targetName: string;
    readonly storage: RustStructuralShapeField; readonly callable: RustClassValueCallable | undefined }[];
}

export interface RustClassImplementationRecords {
  readonly structuralView: { readonly get: (source: TargetTypeRef, target: TargetTypeRef) => RustProjectStructuralView | undefined };
  readonly structuralViewImplementations: { readonly get: (declaration: Node, fileName: string) => readonly RustClassStructuralViewEmission[] | undefined };
  readonly structuralViewPolymorphic: { readonly get: (declaration: Node) => boolean | undefined };
  readonly structuralViewCallable: { readonly get: (callable: RustClassValueCallable) => RustStructuralViewCallableEmission | undefined };
  readonly structuralViewRequirements: { readonly get: (view: RustProjectStructuralView) => RustShapeGenericRequirementContract | undefined };
  readonly classImplementationContext: { readonly get: (declaration: Node, carrier: TargetTypeRef) => RustClassImplementationContext | undefined };
  readonly classImplementationGenerics: { readonly get: (carrier: TargetTypeRef) => RustClassImplementationGenerics | undefined };
  readonly classConstructorViews: { readonly get: (declaration: Node, fileName: string) => readonly RustClassConstructorViewEmission[] | undefined };
}

export interface RustStructuralViewCallableEmission {
  readonly result: TargetTypeRef;
  readonly owner: TargetTypeRef | undefined;
  readonly exactSlot: string | undefined;
}
