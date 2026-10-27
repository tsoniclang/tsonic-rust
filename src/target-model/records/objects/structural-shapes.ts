import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef, RustTargetGenericArgument } from "../../types/model.js";
import type { RustNativeMemoryLayout } from "../../operations/native-memory.js";
import type { RustLifetimeRef } from "../../lifetimes/model.js";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";

export interface RustStructuralShapeField<MethodPlan = RustStructuralMethodPlan> {
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
  readonly methodPlan?: MethodPlan;
}

export type RustStructuralMethodExposure =
  | { readonly kind: "fixed"; readonly declaration: Node }
  | { readonly kind: "stored" };

export type RustStructuralMethodPlan = {
  readonly carrier: TargetTypeRef;
  readonly constructions: readonly RustStructuralMethodConstruction[];
  readonly receiver: "included" | "independent";
} & (
  | { readonly kind: "fixed"; readonly declaration: Node; readonly payload: RustStructuralMethodPayload;
      readonly context: TargetTypeRef; readonly factoryReceiver: "value" | "shared" }
  | { readonly kind: "stored" }
  | { readonly kind: "native-dispatch"; readonly implementation: "fixed"; readonly declaration: Node }
  | { readonly kind: "native-dispatch"; readonly implementation: "stored" }
);

export interface RustStructuralMethodPayload {
  readonly captures: readonly (RustClosureCaptureFact["captures"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receiverFields: readonly (RustClosureCaptureFact["receiverFields"][number] & { readonly storageCarrier: TargetTypeRef })[];
  readonly receivers: readonly (RustClosureCaptureFact["receivers"][number] & { readonly storageCarrier: TargetTypeRef })[];
}

export interface RustStructuralMethodConstruction {
  readonly object: Node;
  readonly property: Node;
  readonly expression: Node;
  readonly storageIndex: number;
  readonly physicalCarrier: TargetTypeRef;
  readonly destinationCarrier: TargetTypeRef;
  readonly payload: RustStructuralMethodPayload;
}

export interface RustStructuralMethodStorageSelection {
  readonly carrier: TargetTypeRef;
  readonly constructions: readonly RustStructuralMethodConstruction[];
  readonly nativeBody: { readonly declaration: Node; readonly payload: RustStructuralMethodPayload;
    readonly receiverFieldIdentities: readonly boolean[]; readonly factoryReceiver: "value" | "shared" } | undefined;
}

export interface RustStructuralShapeDefinition<MethodPlan = RustStructuralMethodPlan> {
  readonly carrier: TargetTypeRef;
  readonly sourceCarriers: readonly TargetTypeRef[];
  readonly ownerFileName: string;
  readonly componentId: string;
  readonly targetName: string;
  readonly genericParameters: readonly RustStructuralShapeGenericParameter[];
  readonly dispatchName?: string;
  readonly dispatchLifetime: RustLifetimeRef | undefined;
  readonly genericArguments: readonly RustTargetGenericArgument[];
  readonly stateGenericParameters: readonly RustStructuralShapeGenericParameter[];
  readonly stateGenericArguments: readonly RustTargetGenericArgument[];
  readonly contextMarker: { readonly name: string; readonly arguments: readonly RustTargetGenericArgument[] } | undefined;
  readonly contextConstructor: { readonly name: string; readonly contextParameter: string;
    readonly identityName: string; readonly identityParameter: string } | undefined;
  readonly fields: readonly RustStructuralShapeField<MethodPlan>[];
  readonly construction?: { readonly targetName: string; readonly carrier: TargetTypeRef };
}

export type RustStructuralShapeGenericParameter =
  | {
      readonly kind: "lifetime";
      readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
    }
  | { readonly kind: "type"; readonly identity: string; readonly name: string };
