import type { Node } from "@tsonic/tsts";
import type { RustTargetTraitRef } from "../types/model.js";
import { rustNamedTargetType, rustNativeTraitRef } from "../types/carriers/native.js";
import { rustRetainedErrorTargetId } from "../types/carriers/source-error.js";
import { snapshotClosedMetadata } from "../metadata/closed-data.js";

export type RustGenericRequirement = "clone" | "default" | "static" | "source-numeric" | "number-predicate" | "js-rejection";

export function rustGenericRequirementBound(
  requirement: RustGenericRequirement,
  retainedError: { readonly identity: typeof rustRetainedErrorTargetId; readonly path: string | undefined },
): RustLifetimeRef | RustTargetTraitRef | undefined {
  switch (requirement) {
    case "static": return rustStaticLifetime;
    case "clone": return snapshotClosedMetadata(rustNativeTraitRef("core::clone::Clone"));
    case "default": return snapshotClosedMetadata(rustNativeTraitRef("core::default::Default"));
    case "source-numeric": return snapshotClosedMetadata(rustNativeTraitRef("js_abi::SourceNumeric"));
    case "number-predicate": return snapshotClosedMetadata(rustNativeTraitRef("js_abi::NativeNumberPredicate"));
    case "js-rejection": {
      if (retainedError?.identity !== rustRetainedErrorTargetId || retainedError.path === undefined ||
        retainedError.path.length === 0) return undefined;
      const carrier = rustNamedTargetType(retainedError.identity, retainedError.path, [], [], undefined, [],
        retainedError.identity, []);
      return snapshotClosedMetadata(rustNativeTraitRef("core::convert::Into", [{ kind: "type", type: carrier }]));
    }
    default: return undefined;
  }
}

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
  readonly identity: string;
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
