import type { SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef, RustTargetGenericArgument } from "../types/model.js";
import type { RustGenericCallableImplementation, RustGenericCallableEnvironment, RustGenericCallablePhysicalDefinition,
  RustGenericCallablePhysicalMember, RustGenericCallableIdentitySelection } from "./generic-callables.js";
import type { RustDeclarationGenericRequirementContract } from "./generic-requirements.js";
import type { RustSourceCallEffectsFact } from "./object-methods.js";

export interface RustGenericImplementationEmission {
  readonly environment: RustGenericCallableEnvironment;
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly requirements: RustDeclarationGenericRequirementContract;
  readonly suspended: boolean;
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

export interface RustGenericDefinitionEmission {
  readonly identity: RustGenericCallableIdentitySelection | undefined;
  readonly invoked: boolean;
  readonly result: TargetTypeRef;
  readonly parameters: readonly TargetTypeRef[];
  readonly nativeFuture: { readonly optional: boolean } | undefined;
  readonly members: ReadonlyMap<RustGenericCallablePhysicalMember, RustGenericMemberEmission>;
}

export interface RustGenericDeclarationInventory {
  readonly implementations: readonly RustGenericCallableImplementation[];
  readonly definitions: readonly RustGenericCallablePhysicalDefinition[];
}

export interface RustGenericEmissionRecords {
  readonly genericImplementation: { readonly get: (implementation: RustGenericCallableImplementation) => RustGenericImplementationEmission | undefined };
  readonly genericDefinition: { readonly get: (definition: RustGenericCallablePhysicalDefinition) => RustGenericDefinitionEmission | undefined };
  readonly genericDeclarations: { readonly get: (sourceFile: SourceFile) => RustGenericDeclarationInventory | undefined };
}
