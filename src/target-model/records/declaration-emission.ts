import type { RustRecordFamily } from "./program.js";
import type { TargetTypeRef } from "../types/model.js";

export interface RustClassDeclarationEmission {
  readonly environmentBindingName: string | undefined;
}

export interface RustCallableReturnEmission {
  readonly invocation: TargetTypeRef | undefined;
  readonly outward: TargetTypeRef | undefined;
}

export interface RustDeclarationEmissionRecords {
  readonly classDeclaration: RustRecordFamily<RustClassDeclarationEmission>;
  readonly callableReturn: RustRecordFamily<RustCallableReturnEmission>;
}
