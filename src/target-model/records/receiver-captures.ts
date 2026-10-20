import type { TargetTypeRef } from "../types/model.js";
import type { RustCapturedFieldStorage } from "../types/field-storage.js";

export interface RustCapturedFieldStorageFact {
  readonly storage: RustCapturedFieldStorage;
  readonly valueCarrier: TargetTypeRef;
}
import type { Node } from "@tsonic/tsts";

export interface RustReceiverFieldCapture {
  readonly declaration: Node;
  readonly reference: Node;
  readonly receiver: Node;
  readonly references: readonly Node[];
}

export interface RustReceiverCapture {
  readonly owner: Node;
  readonly reference: Node;
  readonly references: readonly Node[];
}

export interface RustReceiverCaptureEmissionRecords {
  readonly capturedFieldIdentity: { readonly get: (declaration: Node, reference: Node) => boolean | undefined };
}
