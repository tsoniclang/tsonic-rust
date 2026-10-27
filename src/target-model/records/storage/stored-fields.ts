import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustStructuralShapeField } from "../objects/structural-shapes.js";
import type { RustFrozenWriteReceiver, RustProjectFieldDispatchPlan } from "./field-writes.js";
import type { RustTargetOperationFact } from "../operations/operations.js";

export type RustValueFieldProjectionStep =
  | { readonly kind: "transparent"; readonly node: Node; readonly next: Node }
  | { readonly kind: "field"; readonly node: Node; readonly next: Node; readonly path: readonly string[];
      readonly field: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>; readonly writable: boolean };

export interface RustValueFieldProjection {
  readonly steps: readonly RustValueFieldProjectionStep[];
  readonly root: Node;
}

export interface RustStoredFieldEmission {
  readonly check: RustFrozenWriteReceiver | undefined;
  readonly declaration: Node | undefined;
  readonly path: readonly string[] | undefined;
  readonly borrowedRead: boolean;
  readonly dispatch: { readonly plan: RustProjectFieldDispatchPlan; readonly read: string; readonly write: string } | undefined;
}

export interface RustStructuralPropertyStorage {
  readonly value: TargetTypeRef;
  readonly stored: TargetTypeRef;
  readonly getter: TargetTypeRef;
  readonly setter: TargetTypeRef | undefined;
}

export interface RustStructuralFieldStorage {
  readonly field: RustStructuralShapeField;
  readonly value: boolean;
  readonly dispatch: boolean;
  readonly borrowedRead: boolean;
  readonly location: TargetTypeRef | undefined;
  readonly property: RustStructuralPropertyStorage | undefined;
}

export type RustStructuralMethodInvocation = {
  readonly result: TargetTypeRef;
  readonly parameterCount: number;
  readonly rawStorage: TargetTypeRef;
} & (
  | { readonly kind: "fixed"; readonly owner: TargetTypeRef; readonly factoryReceiver: "value" | "shared" }
  | { readonly kind: "native-dispatch"; readonly cloneDispatch: boolean }
  | { readonly kind: "stored"; readonly generic: boolean; readonly receiver: "included" | "independent" }
);

export interface RustStoredFieldRecords {
  readonly admittedField: { readonly get: (node: Node) => Extract<RustTargetOperationFact, { readonly kind: "source-field" }> | undefined };
  readonly valueFieldProjection: { readonly get: (node: Node) => RustValueFieldProjection | undefined };
  readonly storedField: { readonly get: (storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number) => RustStoredFieldEmission | undefined };
  readonly structuralFieldStorage: { readonly get: (carrier: TargetTypeRef, index: number) => RustStructuralFieldStorage | undefined };
  readonly structuralObjectStorage: { readonly get: (carrier: TargetTypeRef) => { readonly value: boolean } | undefined };
  readonly structuralMethodInvocation: { readonly get: (carrier: TargetTypeRef, index: number, arguments_: readonly TargetTypeRef[]) => RustStructuralMethodInvocation | undefined };
  readonly fieldValueReceiver: { readonly get: (node: Node) => boolean | undefined };
  readonly referenceObjectField: { readonly get: (node: Node) => boolean | undefined };
  readonly capturedReceiverStable: { readonly get: (node: Node) => boolean | undefined };
}
