import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";

export interface RustSourceCallableEmission {
  readonly binding: string | undefined;
  readonly construction: { readonly kind: "generic" } | {
    readonly kind: "pointer";
    readonly lexical: boolean;
  } | {
    readonly kind: "callable";
    readonly lexical: boolean;
    readonly physical: TargetTypeRef;
    readonly arguments: TargetTypeRef;
    readonly captures: RustClosureCaptureFact["captures"];
    readonly staticStorage: boolean;
    readonly fallible: boolean;
    readonly unit: boolean;
    readonly error: TargetTypeRef;
  };
}

export interface RustSourceCallableEmissionRecords {
  readonly sourceCallableEmission: {
    readonly get: (declaration: Node, carrier: TargetTypeRef) => RustSourceCallableEmission | undefined;
  };
}
