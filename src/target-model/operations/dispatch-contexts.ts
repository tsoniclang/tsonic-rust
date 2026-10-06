import type { RustProviderOperationForm } from "./model.js";
import type { TargetTypeRef } from "../types/model.js";

export type RustDispatchContextConstruction = Pick<
  Extract<RustProviderOperationForm, { readonly form: "call" }>, "form" | "path"
>;

export type RustDispatchContextProjection = Pick<
  Extract<RustProviderOperationForm, { readonly form: "receiver-method" }>, "form" | "name"
>;

export interface RustDispatchContextDefinition {
  readonly id: string;
  readonly requiredCrate: string;
  readonly rootCarrier: TargetTypeRef;
  readonly construct: RustDispatchContextConstruction & { readonly const: boolean };
  readonly handleCarrier?: TargetTypeRef;
  readonly handle?: RustDispatchContextProjection;
  readonly composedContexts: readonly {
    readonly contextId: string;
    readonly project: RustDispatchContextProjection;
  }[];
}

export interface RustDispatchContextInput {
  readonly contextId: string;
  readonly view: "root" | "handle";
  readonly targetArgumentIndex: number;
  readonly mode: "value" | "ref";
}

export interface RustDispatchContextGroupInput {
  readonly contextIds: readonly string[];
  readonly targetArgumentIndex: number;
  readonly empty: Pick<
    Extract<RustProviderOperationForm, { readonly form: "associated-call" }>, "form" | "owner" | "method"
  >;
  readonly prepend: RustDispatchContextConstruction;
}

export interface RustResolvedDispatchContextInput extends RustDispatchContextInput {
  readonly carrier: TargetTypeRef;
}
