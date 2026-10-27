import type { TargetTypeRef } from "../../types/model.js";
import type { RustDispatchContextProjection } from "../../operations/dispatch-contexts.js";
import type { RustFinalizedDispatchContextInput } from "./finalized-operation.js";

export interface RustDispatchRootEmission {
  readonly name: string;
  readonly index: number;
  readonly carrier: TargetTypeRef;
  readonly construct: { readonly path: string; readonly const: boolean };
}

export interface RustDispatchContextEmissionRecords {
  readonly dispatchInput: { readonly get: (component: string, input: RustFinalizedDispatchContextInput) => RustDispatchInputEmission | undefined };
  readonly dispatchRoots: { readonly get: (component: string) => readonly RustDispatchRootEmission[] | undefined };
  readonly binaryDispatch: { readonly get: (hook: string) => RustBinaryDispatchEmission | undefined };
}

export interface RustDispatchInputEmission {
  readonly rootIdentity: string;
  readonly path: string;
  readonly projections: readonly RustDispatchContextProjection[];
  readonly handle: string | undefined;
  readonly reference: boolean;
}

export interface RustBinaryDispatchComponentEmission {
  readonly componentId: string;
  readonly children: readonly string[];
  readonly emptyOwner: TargetTypeRef;
  readonly accesses: readonly {
    readonly identity: string;
    readonly path: string;
    readonly projections: readonly RustDispatchContextProjection[];
  }[];
}

export interface RustBinaryDispatchEmission {
  readonly reservedNames: ReadonlySet<string>;
  readonly inputCount: number;
  readonly rootComponentId: string;
  readonly groups: readonly {
    readonly targetArgumentIndex: number;
    readonly emptyMethod: string;
    readonly prependPath: string;
    readonly components: readonly RustBinaryDispatchComponentEmission[];
    readonly rootEmptyOwner: TargetTypeRef;
  }[];
}
