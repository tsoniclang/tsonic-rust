import type { ArgumentPassingMode, ProviderDeclarationIdentity, SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustLifetimeBinder, RustLifetimeRef } from "../lifetimes/index.js";

export type RustTargetConstArgument =
  | { readonly kind: "integer"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "char"; readonly value: string }
  | { readonly kind: "parameter"; readonly identity: string; readonly name: string }
  | { readonly kind: "infer" };

export type RustTargetGenericArgument =
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetimeRef }
  | { readonly kind: "type"; readonly type: RustTargetTypeRef }
  | { readonly kind: "const"; readonly value: RustTargetConstArgument };

export interface RustTargetTraitRef {
  readonly kind: "trait-ref";
  readonly id: string;
  readonly path: string;
  readonly sourceItem?: {
    readonly fileName: string;
    readonly typeName: string;
  };
  readonly genericArguments: readonly RustTargetGenericArgument[];
  readonly associatedConstraints: readonly RustTargetAssociatedConstraint[];
  readonly lifetimeBinder?: RustLifetimeBinder;
}

export type RustTargetAssociatedConstraint =
  | {
      readonly kind: "equality";
      readonly identity: string;
      readonly name: string;
      readonly genericArguments: readonly RustTargetGenericArgument[];
      readonly type: RustTargetTypeRef;
    }
  | {
      readonly kind: "bounds";
      readonly identity: string;
      readonly name: string;
      readonly genericArguments: readonly RustTargetGenericArgument[];
      readonly traits: readonly RustTargetTraitRef[];
      readonly outlives: readonly RustLifetimeRef[];
    };

export type RustProgramErrorOwner =
  | { readonly kind: "logical" }
  | { readonly kind: "physical"; readonly domain: "runtime" }
  | { readonly kind: "physical"; readonly domain: "project"; readonly componentId: string };

export type RustTargetTypeRef =
  | { readonly kind: "source-primitive"; readonly name: SourcePrimitiveKind }
  | {
      readonly kind: "target-named";
      readonly id: string;
      readonly genericArguments?: readonly RustTargetGenericArgument[];
      readonly sourceAbsence?: true;
      readonly errorOwner?: RustProgramErrorOwner;
    }
  | { readonly kind: "type-parameter"; readonly identity: string; readonly name: string; readonly optionalStorageValue?: RustTargetTypeRef }
  | { readonly kind: "array"; readonly element: RustTargetTypeRef; readonly rank?: number }
  | { readonly kind: "slice"; readonly element: RustTargetTypeRef }
  | { readonly kind: "tuple"; readonly elements: readonly RustTargetTypeRef[] }
  | {
      readonly kind: "reference";
      readonly referent: RustTargetTypeRef;
      readonly mutable: boolean;
      readonly lifetime?: RustLifetimeRef;
    }
  | { readonly kind: "pointer"; readonly pointee: RustTargetTypeRef; readonly mutability?: "const" | "mut" | "target-defined" }
  | {
      readonly kind: "function-pointer";
      readonly args: readonly RustTargetTypeRef[];
      readonly result: RustTargetTypeRef;
      readonly lifetimeBinder?: RustLifetimeBinder;
      readonly abi?: readonly string[];
      readonly isUnsafe?: boolean;
    }
  | RustTargetTraitRef
  | {
      readonly kind: "closure";
      readonly callTrait?: "Fn" | "FnMut" | "FnOnce";
      readonly args: readonly RustTargetTypeRef[];
      readonly result: RustTargetTypeRef;
      readonly fallible?: boolean;
      readonly lifetimeBinder?: RustLifetimeBinder;
    }
  | { readonly kind: "opaque"; readonly id: string }
  | {
      readonly kind: "trait-object";
      readonly principal: RustTargetTraitRef;
      readonly autoTraits: readonly RustTargetTraitRef[];
      readonly lifetime?: RustLifetimeRef;
    }
  | {
      readonly kind: "impl-trait";
      readonly id: string;
      readonly bounds: readonly RustTargetTraitRef[];
      readonly outlives: readonly RustLifetimeRef[];
      readonly captures: readonly RustTargetGenericArgument[];
    }
  | {
      readonly kind: "associated-type";
      readonly owner: RustTargetTypeRef;
      readonly trait?: RustTargetTraitRef;
      readonly name: string;
      readonly genericArguments?: readonly RustTargetGenericArgument[];
    }
  | { readonly kind: "target-specific"; readonly target: "rust"; readonly name: string; readonly value?: unknown };

export type TargetTypeRef = RustTargetTypeRef;

export interface RustNamedTypeTraitRequirement {
  readonly typeArgumentIndex: number;
  readonly trait: RustTargetTraitRef;
}

export interface RustNamedTypeTraitImplementation {
  readonly trait: RustTargetTraitRef;
  readonly requirements: readonly RustNamedTypeTraitRequirement[];
}

export interface RustNamedTypeTraitContract {
  readonly implementations: readonly RustNamedTypeTraitImplementation[];
}

export interface RustTargetParameter {
  readonly name: string;
  readonly type: RustTargetTypeRef;
  readonly passingMode: ArgumentPassingMode;
  readonly optional?: boolean;
  readonly paramsArray?: boolean;
}

export type RustTargetGenericParameter =
  | {
      readonly kind: "type";
      readonly sourceName: string;
      readonly targetIdentity: string;
    }
  | {
      readonly kind: "lifetime";
      readonly sourceName: string;
      readonly targetIdentity: string;
    }
  | {
      readonly kind: "const";
      readonly sourceName: string;
      readonly targetIdentity: string;
    };

export interface RustTargetMember {
  readonly id: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly kind: "method" | "constructor" | "property" | "field" | "indexer" | "event" | "operator";
  readonly static?: boolean;
  readonly parameters: readonly RustTargetParameter[];
  readonly returnType?: RustTargetTypeRef;
  readonly genericParameters?: readonly RustTargetGenericParameter[];
  readonly providerDeclaration?: ProviderDeclarationIdentity;
}
