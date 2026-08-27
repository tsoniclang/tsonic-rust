import type { Node } from "@tsonic/tsts";

export type RustLifetimeRef =
  | { readonly kind: "static" }
  | { readonly kind: "placeholder" }
  | {
      readonly kind: "call-scoped-elision";
      readonly callIdentity: string;
      readonly parameterIdentity: string;
    }
  | {
      readonly kind: "parameter";
      readonly identity: string;
      readonly name: string;
    }
  | {
      readonly kind: "bound";
      readonly binderIdentity: string;
      readonly identity: string;
      readonly name: string;
    };

export interface RustLifetimeBinder {
  readonly identity: string;
  readonly parameters: readonly RustBoundLifetimeParameterContract[];
}

export interface RustBoundLifetimeParameterContract {
  readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "bound" }>;
  readonly outlives: readonly RustLifetimeRef[];
}

export interface RustLifetimeParameterContract {
  readonly kind: "lifetime";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly lifetime: Extract<
    RustLifetimeRef,
    { readonly kind: "parameter" | "bound" }
  >;
  readonly outlives: readonly RustLifetimeRef[];
}

export interface RustTypeLifetimeContract {
  readonly kind: "type";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly outlives: readonly RustLifetimeRef[];
  readonly maybeSized: boolean;
}

export type RustSourceGenericParameterContract =
  | RustLifetimeParameterContract
  | RustTypeLifetimeContract;

export interface RustSourceGenericContract {
  readonly declaration: Node;
  readonly parameters: readonly RustSourceGenericParameterContract[];
  readonly lifetimeBinder?: RustLifetimeBinder;
}

export interface RustLifetimeIndex {
  contractFor(declaration: Node | undefined): RustSourceGenericContract | undefined;
  parameterFor(declaration: Node | undefined): RustSourceGenericParameterContract | undefined;
  resolve(node: Node | undefined): RustLifetimeRef | undefined;
  allContracts(): readonly RustSourceGenericContract[];
}

export const emptyRustLifetimeIndex: RustLifetimeIndex = Object.freeze({
  contractFor() { return undefined; },
  parameterFor() { return undefined; },
  resolve() { return undefined; },
  allContracts() { return Object.freeze([]); },
});

export const rustStaticLifetime: RustLifetimeRef = Object.freeze({ kind: "static" });
export const rustPlaceholderLifetime: RustLifetimeRef = Object.freeze({
  kind: "placeholder",
});
