import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustFrozenWriteReceiver } from "./field-writes.js";

export interface RustFrozenDataWritePlan {
  receiverFor(storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number): RustFrozenWriteReceiver | undefined;
  receiverForDeclaration(declaration: Node): RustFrozenWriteReceiver | undefined;
  capturesFieldIdentity(declaration: Node, reference?: Node): boolean;
}


export interface RustFrozenReceiverCapturePlan {
  capturesFieldIdentity(declaration: Node, reference?: Node): boolean;
}
