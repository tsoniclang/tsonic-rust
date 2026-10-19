import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef, RustTargetGenericArgument } from "../types/model.js";
import type { RustNativeMemoryLayout } from "../operations/native-memory.js";
import type { RustLifetimeRef } from "../lifetimes/model.js";

export interface RustStructuralShapeField {
  readonly nativeLayout?: RustNativeMemoryLayout;
  readonly sourceName: string;
  readonly targetName: string;
  readonly carrier: TargetTypeRef;
  readonly presence: "required" | "optional";
  readonly readonly: boolean;
  readonly storage: "stored" | "property" | "bound";
  readonly boundStorage?: { readonly carrier: TargetTypeRef; readonly direct: boolean };
  readonly property?: {
    readonly getterTargetName: string;
    readonly setterTargetName?: string;
    readonly selfMode: "ref" | "rc";
  };
  readonly method?: true;
  readonly methodStorageCarrier?: TargetTypeRef;
  readonly methodConstructions?: readonly RustStructuralMethodConstruction[];
  readonly receiverIndependent?: true;
  readonly nativeMethod?: true;
}

export interface RustStructuralMethodConstruction {
  readonly object: Node;
  readonly property: Node;
  readonly expression: Node;
  readonly storageIndex: number;
  readonly physicalCarrier: TargetTypeRef;
  readonly destinationCarrier: TargetTypeRef;
}

export interface RustStructuralMethodStorageSelection {
  readonly carrier: TargetTypeRef;
  readonly constructions: readonly RustStructuralMethodConstruction[];
}

export interface RustStructuralShapeDefinition {
  readonly carrier: TargetTypeRef;
  readonly sourceCarriers: readonly TargetTypeRef[];
  readonly ownerFileName: string;
  readonly componentId: string;
  readonly targetName: string;
  readonly genericParameters: readonly RustStructuralShapeGenericParameter[];
  readonly dispatchName?: string;
  readonly genericArguments: readonly RustTargetGenericArgument[];
  readonly fields: readonly RustStructuralShapeField[];
  readonly construction?: { readonly targetName: string; readonly carrier: TargetTypeRef };
}

export type RustStructuralShapeGenericParameter =
  | {
      readonly kind: "lifetime";
      readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
    }
  | { readonly kind: "type"; readonly identity: string; readonly name: string };
