import type { TargetTypeRef } from "../../types/model.js";
import type { RustLifetimeRef } from "../../lifetimes/model.js";
import type { RustStructuralShapeDefinition, RustStructuralShapeField } from "./structural-shapes.js";

export interface RustConstructorShapeEmission {
  readonly lifetime: RustLifetimeRef | undefined;
  readonly genericParameterIndices: readonly number[];
  readonly members: readonly {
    readonly name: string;
    readonly parameters: readonly TargetTypeRef[];
    readonly result: TargetTypeRef;
    readonly selfMode: "rc" | "ref";
    readonly field: { readonly index: number; readonly role: "value" | "getter" | "setter" } | undefined;
  }[];
}

export interface RustStructuralFieldEmission {
  readonly field: RustStructuralShapeField;
  readonly carrier: TargetTypeRef;
  readonly methodAlias: string | undefined;
  readonly property: {
    readonly stored: TargetTypeRef;
    readonly getter: TargetTypeRef;
    readonly setter: TargetTypeRef | undefined;
    readonly getterAlias: string;
    readonly setterAlias: string;
  } | undefined;
}

export interface RustStructuralShapeEmission {
  readonly dispatch: RustConstructorShapeEmission | undefined;
  readonly contextConstructors: readonly ("value" | "identity")[];
  readonly bases: readonly TargetTypeRef[];
  readonly fields: readonly RustStructuralFieldEmission[];
  readonly derives: readonly ("Clone" | "Copy" | "Default")[];
}

export interface RustStructuralEmissionRecords {
  readonly structuralShapeEmission: { readonly get: (definition: RustStructuralShapeDefinition) => RustStructuralShapeEmission | undefined };
}
