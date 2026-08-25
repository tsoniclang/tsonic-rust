export const rustCompilerProviderProtocolVersion = 3;
export const supportedRustdocFormatVersion = 57;

export interface RustCompilerIdentity {
  readonly rustcVerboseVersion: string;
  readonly rustdocFormatVersion: typeof supportedRustdocFormatVersion;
}

export interface RustCompilerDependency {
  readonly alias: string;
  readonly packageId: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly crateName: string;
  readonly targetCrateName: string;
  readonly manifestPath: string;
  readonly sourceRoot: string;
  readonly sourceDigest: string;
  readonly closurePackageIds: readonly string[];
  readonly features: readonly string[];
}

export interface RustCompilerPackageSource {
  readonly packageId: string;
  readonly sourceRoot: string;
  readonly sourceDigest: string;
}

interface RustCompilerSnapshotBase {
  readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
  readonly manifestPath: string;
  readonly rootPackageId: string;
  readonly compiler: RustCompilerIdentity;
  readonly dependencies: readonly RustCompilerDependency[];
  readonly packageSources: readonly RustCompilerPackageSource[];
  readonly digest: string;
}

export interface RustCompilerCargoProjectSnapshot extends RustCompilerSnapshotBase {
  readonly kind: "cargo-project";
}

export interface RustCompilerMetadataArtifact {
  readonly crateName: string;
  readonly path: string;
  readonly byteLength: number;
  readonly modifiedMilliseconds: number;
  readonly digest: string;
}

export interface RustCompilerStandardLibrarySnapshot extends RustCompilerSnapshotBase {
  readonly kind: "standard-library";
  readonly targetTriple: string;
  readonly targetLibraryDirectory: string;
  readonly metadataArtifacts: readonly RustCompilerMetadataArtifact[];
}

export type RustCompilerProjectSnapshot =
  | RustCompilerCargoProjectSnapshot
  | RustCompilerStandardLibrarySnapshot;

export interface RustCompilerItemIdentity {
  readonly itemId: string;
  readonly canonicalPath: readonly string[];
}

export type RustCompilerLifetime =
  | { readonly kind: "static" }
  | {
      readonly kind: "parameter";
      readonly identity: RustCompilerItemIdentity;
      readonly displayName: string;
    }
  | {
      readonly kind: "bound";
      readonly binderId: string;
      readonly parameterId: string;
      readonly displayName: string;
    }
  | {
      readonly kind: "elided";
      readonly ownerId: string;
      readonly position: string;
    };

export type RustCompilerConstExpression =
  | { readonly kind: "literal"; readonly literalKind: "boolean"; readonly value: boolean }
  | { readonly kind: "literal"; readonly literalKind: "integer"; readonly value: bigint }
  | { readonly kind: "literal"; readonly literalKind: "character"; readonly value: string }
  | { readonly kind: "parameter"; readonly identity: RustCompilerItemIdentity; readonly displayName: string }
  | { readonly kind: "item"; readonly identity: RustCompilerItemIdentity; readonly displayPath: readonly string[] }
  | {
      readonly kind: "unary";
      readonly operator: "negate" | "not";
      readonly operand: RustCompilerConstExpression;
    }
  | {
      readonly kind: "binary";
      readonly operator:
        | "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "remainder"
        | "shift-left"
        | "shift-right"
        | "bit-and"
        | "bit-or"
        | "bit-xor";
      readonly left: RustCompilerConstExpression;
      readonly right: RustCompilerConstExpression;
    }
  | { readonly kind: "inferred" };

export type RustCompilerGenericArgument =
  | { readonly kind: "lifetime"; readonly value: RustCompilerLifetime }
  | { readonly kind: "type"; readonly value: RustCompilerType }
  | { readonly kind: "const"; readonly value: RustCompilerConstExpression };

export interface RustCompilerTraitReference {
  readonly identity: RustCompilerItemIdentity;
  readonly displayPath: readonly string[];
  readonly arguments: readonly RustCompilerGenericArgument[];
  readonly associatedConstraints: readonly RustCompilerAssociatedConstraint[];
}

export type RustCompilerAssociatedConstraint =
  | {
      readonly kind: "equality";
      readonly item: RustCompilerItemIdentity;
      readonly displayName: string;
      readonly arguments: readonly RustCompilerGenericArgument[];
      readonly type: RustCompilerType;
    }
  | {
      readonly kind: "bounds";
      readonly item: RustCompilerItemIdentity;
      readonly displayName: string;
      readonly arguments: readonly RustCompilerGenericArgument[];
      readonly bounds: readonly RustCompilerBound[];
    };

export interface RustCompilerLifetimeParameter {
  readonly kind: "lifetime";
  readonly identity: RustCompilerLifetime;
  readonly bounds: readonly RustCompilerLifetime[];
}

export interface RustCompilerTypeParameter {
  readonly kind: "type";
  readonly identity: RustCompilerItemIdentity;
  readonly displayName: string;
  readonly bounds: readonly RustCompilerBound[];
  readonly defaultType?: RustCompilerType;
  readonly declarationKind: "explicit" | "implicit-self" | "synthetic";
}

export interface RustCompilerConstParameter {
  readonly kind: "const";
  readonly identity: RustCompilerItemIdentity;
  readonly displayName: string;
  readonly type: RustCompilerType;
  readonly defaultValue?: RustCompilerConstExpression;
}

export type RustCompilerGenericParameter =
  | RustCompilerLifetimeParameter
  | RustCompilerTypeParameter
  | RustCompilerConstParameter;

export interface RustCompilerBinder {
  readonly id: string;
  readonly lifetimes: readonly RustCompilerLifetimeParameter[];
}

export type RustCompilerBound =
  | {
      readonly kind: "trait";
      readonly binder?: RustCompilerBinder;
      readonly trait: RustCompilerTraitReference;
      readonly polarity: "required" | "maybe" | "negative";
    }
  | {
      readonly kind: "lifetime-outlives";
      readonly longer: RustCompilerLifetime;
      readonly shorter: RustCompilerLifetime;
    }
  | {
      readonly kind: "type-outlives";
      readonly type: RustCompilerType;
      readonly lifetime: RustCompilerLifetime;
    }
  | {
      readonly kind: "associated-equality";
      readonly projection: Extract<RustCompilerType, { readonly kind: "associated-type" }>;
      readonly value: RustCompilerType;
    }
  | {
      readonly kind: "precise-capture";
      readonly captures: readonly RustCompilerGenericArgument[];
    };

export type RustCompilerWherePredicate =
  | {
      readonly kind: "type";
      readonly binder?: RustCompilerBinder;
      readonly type: RustCompilerType;
      readonly bounds: readonly RustCompilerBound[];
    }
  | {
      readonly kind: "lifetime";
      readonly lifetime: RustCompilerLifetime;
      readonly outlives: readonly RustCompilerLifetime[];
    }
  | {
      readonly kind: "equality";
      readonly projection: Extract<RustCompilerType, { readonly kind: "associated-type" }>;
      readonly value: RustCompilerType;
    };

export interface RustCompilerGenerics {
  readonly parameters: readonly RustCompilerGenericParameter[];
  readonly wherePredicates: readonly RustCompilerWherePredicate[];
}

export const emptyRustCompilerGenerics: RustCompilerGenerics = Object.freeze({
  parameters: Object.freeze([]),
  wherePredicates: Object.freeze([]),
});

export type RustCompilerType =
  | { readonly kind: "unit" }
  | { readonly kind: "never" }
  | { readonly kind: "primitive"; readonly name: string }
  | { readonly kind: "type-parameter"; readonly identity: RustCompilerItemIdentity; readonly displayName: string }
  | { readonly kind: "self"; readonly owner: RustCompilerItemIdentity }
  | { readonly kind: "tuple"; readonly elements: readonly RustCompilerType[] }
  | { readonly kind: "array"; readonly element: RustCompilerType; readonly length: RustCompilerConstExpression }
  | { readonly kind: "slice"; readonly element: RustCompilerType }
  | {
      readonly kind: "reference";
      readonly mutable: boolean;
      readonly lifetime: RustCompilerLifetime;
      readonly target: RustCompilerType;
    }
  | { readonly kind: "raw-pointer"; readonly mutable: boolean; readonly target: RustCompilerType }
  | {
      readonly kind: "function-pointer";
      readonly binder?: RustCompilerBinder;
      readonly parameters: readonly RustCompilerType[];
      readonly result: RustCompilerType;
      readonly abi: string;
      readonly safety: "safe" | "unsafe";
      readonly variadic: boolean;
    }
  | {
      readonly kind: "trait-object";
      readonly principal: RustCompilerTraitReference;
      readonly autoTraits: readonly RustCompilerTraitReference[];
      readonly lifetime: RustCompilerLifetime;
    }
  | {
      readonly kind: "opaque";
      readonly identity: RustCompilerItemIdentity;
      readonly bounds: readonly RustCompilerBound[];
      readonly captures: readonly RustCompilerGenericArgument[];
    }
  | {
      readonly kind: "associated-type";
      readonly owner: RustCompilerType;
      readonly trait: RustCompilerTraitReference;
      readonly item: RustCompilerItemIdentity;
      readonly displayName: string;
      readonly arguments: readonly RustCompilerGenericArgument[];
    }
  | {
      readonly kind: "path";
      readonly identity: RustCompilerItemIdentity;
      readonly crateName: string;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly arguments: readonly RustCompilerGenericArgument[];
    };

export interface RustCompilerParameter {
  readonly name: string;
  readonly type: RustCompilerType;
}

export interface RustCompilerReceiver {
  readonly type: RustCompilerType;
  readonly explicit: boolean;
}

export interface RustCompilerFunction {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly parameters: readonly RustCompilerParameter[];
  readonly result: RustCompilerType;
  readonly enclosingGenerics: RustCompilerGenerics;
  readonly generics: RustCompilerGenerics;
  readonly receiver?: RustCompilerReceiver;
  readonly traitDispatch?: RustCompilerTraitReference;
  readonly asynchronous: boolean;
  readonly safety: "safe" | "unsafe";
  readonly abi: string;
  readonly variadic: boolean;
}

export interface RustCompilerField {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly type: RustCompilerType;
}

export type RustCompilerVariantFields =
  | { readonly kind: "unit" }
  | { readonly kind: "tuple"; readonly fields: readonly RustCompilerField[] }
  | { readonly kind: "struct"; readonly fields: readonly RustCompilerField[] };

export interface RustCompilerEnumVariant {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly fields: RustCompilerVariantFields;
  readonly discriminant?: RustCompilerConstExpression;
}

export interface RustCompilerAssociatedConstant {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly type: RustCompilerType;
  readonly traitDispatch?: RustCompilerTraitReference;
  readonly generics: RustCompilerGenerics;
}

export interface RustCompilerAssociatedType {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly generics: RustCompilerGenerics;
  readonly bounds: readonly RustCompilerBound[];
  readonly defaultType?: RustCompilerType;
}

export interface RustCompilerUnsupportedMember {
  readonly kind: "associated-constant" | "associated-type" | "field" | "method" | "variant";
  readonly name: string;
  readonly reason: string;
}

export interface RustCompilerTraitImplementation {
  readonly trait: RustCompilerTraitReference;
  readonly requirements: readonly {
    readonly typeArgumentIndex: number;
    readonly trait: RustCompilerTraitReference;
  }[];
}

export interface RustCompilerTypeTraits {
  readonly implementations: readonly RustCompilerTraitImplementation[];
}

export interface RustCompilerLayout {
  readonly representation: "rust" | "c" | "transparent";
  readonly packed?: RustCompilerConstExpression;
  readonly alignment?: RustCompilerConstExpression;
}

interface RustCompilerExportIdentity {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly targetPath: readonly string[];
}

interface RustCompilerNominalExport {
  readonly generics: RustCompilerGenerics;
  readonly methods: readonly RustCompilerFunction[];
  readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
  readonly associatedTypes: readonly RustCompilerAssociatedType[];
  readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
  readonly traits: RustCompilerTypeTraits;
  readonly layout: RustCompilerLayout;
}

export type RustCompilerExport = RustCompilerExportIdentity & (
  | { readonly kind: "constant"; readonly type: RustCompilerType }
  | { readonly kind: "static"; readonly type: RustCompilerType; readonly safety: "safe" | "unsafe"; readonly mutable: boolean; readonly threadLocal: boolean }
  | { readonly kind: "function"; readonly function: RustCompilerFunction }
  | (RustCompilerNominalExport & { readonly kind: "struct"; readonly fields: readonly RustCompilerField[] })
  | { readonly kind: "type-alias"; readonly generics: RustCompilerGenerics; readonly type: RustCompilerType }
  | (RustCompilerNominalExport & { readonly kind: "enum"; readonly variantsComplete: boolean; readonly variants: readonly RustCompilerEnumVariant[] })
  | (RustCompilerNominalExport & { readonly kind: "union"; readonly fields: readonly RustCompilerField[] })
  | (RustCompilerNominalExport & {
      readonly kind: "trait";
      readonly safety: "safe" | "unsafe";
      readonly auto: boolean;
      readonly implementationItemsRequired: boolean;
      readonly superTraits: readonly RustCompilerBound[];
    })
);

export interface RustCompilerImplementation {
  readonly identity: RustCompilerItemIdentity;
  readonly generics: RustCompilerGenerics;
  readonly target: RustCompilerType;
  readonly trait?: RustCompilerTraitReference;
  readonly polarity: "positive" | "negative";
  readonly safety: "safe" | "unsafe";
  readonly methods: readonly RustCompilerFunction[];
  readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
  readonly associatedTypes: readonly RustCompilerAssociatedType[];
  readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
}

interface RustCompilerStandardItemIdentity {
  readonly kind: "type" | "trait";
  readonly canonicalPath: readonly string[];
  readonly targetId: string;
}

export type RustCompilerStandardItemLocation = RustCompilerStandardItemIdentity & (
  | {
      readonly sourceAvailability: "available";
      readonly sourceModuleSpecifier: string;
      readonly sourceExportName: string;
      readonly targetPath: readonly string[];
      readonly sourceStability: "stable" | "unstable";
      readonly sourceGenericArgumentCount: number;
      readonly requiredSourceGenericArgumentCount: number;
    }
  | { readonly sourceAvailability: "unavailable" }
);

export interface RustCompilerUnsupportedExport {
  readonly name: string;
  readonly reason: string;
}

export interface RustCompilerModuleModel {
  readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
  readonly projectDigest: string;
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly exports: readonly RustCompilerExport[];
  readonly implementations: readonly RustCompilerImplementation[];
  readonly unsupportedExports: readonly RustCompilerUnsupportedExport[];
  readonly standardItemLocations: readonly RustCompilerStandardItemLocation[];
}
