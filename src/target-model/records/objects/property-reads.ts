import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustBoundMethodEmission {
  readonly method: string;
  readonly dispatch: boolean;
  readonly fallible: boolean;
  readonly parameters: readonly TargetTypeRef[];
}

export interface RustPropertyReadRecords {
  readonly boundMethod: { readonly get: (declaration: Node, receiver: TargetTypeRef, callable: TargetTypeRef) => RustBoundMethodEmission | undefined };
}
