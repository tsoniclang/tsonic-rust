import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustGenericCallableImplementation, RustGenericCallablePhysicalDefinition,
  RustGenericCallablePhysicalMember, RustGenericCallableIdentitySelection, RustGenericCallableIdentityComparison } from "../callables/generic-callables.js";
import type { RustDeclarationGenericRequirementContract } from "./generic-requirements.js";
import type { RustSourceCallEffectsFact } from "../objects/object-methods.js";
import type { RustNativeGenericEntry } from "../program/declaration-emission.js";

export interface RustGenericImplementationEmission {
  readonly entry: RustNativeGenericEntry;
  readonly requirements: RustDeclarationGenericRequirementContract;
}

export interface RustGenericMemberEmission {
  readonly suspended: boolean;
  readonly completionVariant: string | undefined;
  readonly future: {
    readonly effects: RustSourceCallEffectsFact;
    readonly optional: boolean;
    readonly absent: boolean;
    readonly unchangedAwaitError: boolean;
  } | undefined;
}

export type RustGenericDefinitionEmission = {
  readonly identity: RustGenericCallableIdentitySelection | undefined;
} & ({ readonly invoked: false } | {
  readonly invoked: true;
  readonly result: TargetTypeRef;
  readonly parameters: readonly TargetTypeRef[];
  readonly nativeFuture: { readonly optional: boolean } | undefined;
  readonly members: ReadonlyMap<RustGenericCallablePhysicalMember, RustGenericMemberEmission>;
});

export interface RustGenericDeclarationInventory {
  readonly implementations: readonly RustGenericCallableImplementation[];
  readonly definitions: readonly RustGenericCallablePhysicalDefinition[];
}

export interface RustGenericValueEmission {
  readonly carrier: TargetTypeRef;
  readonly implementation: RustGenericCallableImplementation;
  readonly member: RustGenericCallablePhysicalMember;
  readonly marker: boolean;
}

export interface RustGenericIdentityEmission {
  readonly comparison: RustGenericCallableIdentityComparison;
  readonly stableLeft: boolean;
  readonly stableRight: boolean;
  readonly constant: boolean | undefined;
}

export interface RustGenericEmissionRecords {
  readonly genericIdentity: { readonly get: (node: Node) => RustGenericIdentityEmission | undefined };
  readonly genericValue: { readonly get: (node: Node, carrier: TargetTypeRef) => RustGenericValueEmission | undefined };
  readonly genericImplementation: { readonly get: (implementation: RustGenericCallableImplementation) => RustGenericImplementationEmission | undefined };
  readonly genericDefinition: { readonly get: (definition: RustGenericCallablePhysicalDefinition) => RustGenericDefinitionEmission | undefined };
  readonly genericDeclarations: { readonly get: (sourceFile: SourceFile) => RustGenericDeclarationInventory | undefined };
}
