import type { TargetTypeRef } from "../types/model.js";

export interface RustDispatchRootEmission {
  readonly index: number;
  readonly carrier: TargetTypeRef;
  readonly construct: { readonly path: string; readonly const: boolean };
}

export interface RustDispatchContextEmissionRecords {
  readonly dispatchRoots: { readonly get: (component: string) => readonly RustDispatchRootEmission[] | undefined };
}
