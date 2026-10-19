import type { RustRecordFamily } from "./program.js";
import type { TargetTypeRef } from "../types/model.js";
import type { Node } from "@tsonic/tsts";

export interface RustClassDeclarationEmission {
  readonly environmentBindingName: string | undefined;
  readonly nonCamelCaseName: boolean;
  readonly defaultConstructor: string | undefined;
}

export interface RustCallableReturnEmission {
  readonly invocation: TargetTypeRef | undefined;
  readonly outward: TargetTypeRef | undefined;
}

export interface RustCallableLeadingEmission {
  readonly parameters: readonly {
    readonly kind: "this" | "receiver";
    readonly carrier: TargetTypeRef;
    readonly reads: readonly Node[];
  }[];
}

export interface RustDeclarationEmissionRecords {
  readonly classDeclaration: RustRecordFamily<RustClassDeclarationEmission>;
  readonly callableReturn: RustRecordFamily<RustCallableReturnEmission>;
  readonly callableLeading: RustRecordFamily<RustCallableLeadingEmission>;
}
