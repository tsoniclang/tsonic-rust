import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustStructuralShapeField } from "./structural-shapes.js";
import type { RustFrozenWriteReceiver, RustProjectFieldDispatchPlan } from "./field-writes.js";

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

export interface RustStructuralMethodInvocation {
  readonly result: TargetTypeRef;
  readonly parameterCount: number;
  readonly rawStorage: TargetTypeRef;
  readonly generic: boolean;
  readonly native: boolean;
  readonly cloneDispatch: boolean;
  readonly receiverIndependent: boolean;
}

export interface RustStoredFieldRecords {
  readonly storedField: { readonly get: (storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number) => RustStoredFieldEmission | undefined };
  readonly structuralFieldStorage: { readonly get: (carrier: TargetTypeRef, index: number) => RustStructuralFieldStorage | undefined };
  readonly structuralObjectStorage: { readonly get: (carrier: TargetTypeRef) => { readonly value: boolean } | undefined };
  readonly structuralMethodInvocation: { readonly get: (carrier: TargetTypeRef, index: number, arguments_: readonly TargetTypeRef[]) => RustStructuralMethodInvocation | undefined };
  readonly fieldValueReceiver: { readonly get: (node: Node) => boolean | undefined };
  readonly capturedReceiverStable: { readonly get: (node: Node) => boolean | undefined };
}
