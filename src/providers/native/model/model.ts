export const rustCompilerProviderProtocolVersion = 8;

export interface RustCompilerIdentity {
  readonly rustcVerboseVersion: string;
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
  | { readonly kind: "placeholder" }
  | {
      readonly kind: "parameter";
      readonly identity: RustCompilerItemIdentity;
      readonly name: string;
    }
  | {
      readonly kind: "bound";
      readonly binderIdentity: string;
      readonly identity: string;
      readonly name: string;
    }
  | {
      readonly kind: "elided";
      readonly ownerIdentity: string;
      readonly position: string;
    };

export type RustCompilerConstArgument =
  | { readonly kind: "integer"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "char"; readonly value: string }
  | {
      readonly kind: "parameter";
      readonly identity: RustCompilerItemIdentity;
      readonly name: string;
    }
  | { readonly kind: "infer" };

export type RustCompilerGenericArgument =
  | { readonly kind: "lifetime"; readonly lifetime: RustCompilerLifetime }
  | { readonly kind: "type"; readonly type: RustCompilerType }
  | { readonly kind: "const"; readonly value: RustCompilerConstArgument };

export interface RustCompilerLifetimeParameter {
  readonly kind: "lifetime";
  readonly lifetime: Extract<RustCompilerLifetime, { readonly kind: "parameter" | "bound" }>;
  readonly outlives: readonly RustCompilerLifetime[];
}

export interface RustCompilerTypeParameter {
  readonly kind: "type";
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly requirements: readonly RustCompilerTypeRequirement[];
  readonly outlives: readonly RustCompilerLifetime[];
  readonly maybeSized: boolean;
  readonly defaultType?: RustCompilerType;
}

export interface RustCompilerConstParameter {
  readonly kind: "const";
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly type: RustCompilerType;
  readonly defaultValue?: RustCompilerConstArgument;
}

export type RustCompilerGenericParameter =
  | RustCompilerLifetimeParameter
  | RustCompilerTypeParameter
  | RustCompilerConstParameter;

export interface RustCompilerGenerics {
  readonly parameters: readonly RustCompilerGenericParameter[];
}

export const emptyRustCompilerGenerics: RustCompilerGenerics = Object.freeze({
  parameters: Object.freeze([]),
});

export interface RustCompilerLifetimeBinder {
  readonly identity: string;
  readonly parameters: readonly RustCompilerLifetimeParameter[];
}

export type RustCompilerAssociatedConstraint =
  | {
      readonly kind: "equality";
      readonly identity: RustCompilerItemIdentity;
      readonly name: string;
      readonly genericArguments: readonly RustCompilerGenericArgument[];
      readonly type: RustCompilerType;
    }
  | {
      readonly kind: "bounds";
      readonly identity: RustCompilerItemIdentity;
      readonly name: string;
      readonly genericArguments: readonly RustCompilerGenericArgument[];
      readonly traits: readonly RustCompilerTraitDispatch[];
      readonly outlives: readonly RustCompilerLifetime[];
    };

export type RustCompilerType =
  | { readonly kind: "unit" }
  | { readonly kind: "primitive"; readonly name: string }
  | {
      readonly kind: "generic";
      readonly identity: RustCompilerItemIdentity;
      readonly name: string;
    }
  | { readonly kind: "self"; readonly owner: RustCompilerItemIdentity }
  | { readonly kind: "tuple"; readonly elements: readonly RustCompilerType[] }
  | {
      readonly kind: "array";
      readonly element: RustCompilerType;
      readonly length: RustCompilerConstArgument;
    }
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
      readonly parameters: readonly RustCompilerType[];
      readonly result: RustCompilerType;
      readonly lifetimeBinder?: RustCompilerLifetimeBinder;
      readonly abi: string;
      readonly unsafe: boolean;
    }
  | {
      readonly kind: "trait-object";
      readonly principal: RustCompilerTraitDispatch;
      readonly autoTraits: readonly RustCompilerTraitDispatch[];
      readonly lifetime: RustCompilerLifetime;
    }
  | {
      readonly kind: "opaque";
      readonly identity: RustCompilerItemIdentity;
      readonly bounds: readonly RustCompilerTraitDispatch[];
      readonly outlives: readonly RustCompilerLifetime[];
      readonly captures: readonly RustCompilerGenericArgument[];
    }
  | {
      readonly kind: "associated-type";
      readonly identity: RustCompilerItemIdentity;
      readonly owner: RustCompilerType;
      readonly trait: RustCompilerTraitDispatch;
      readonly name: string;
      readonly genericArguments: readonly RustCompilerGenericArgument[];
      readonly maybeSized: boolean;
    }
  | {
      readonly kind: "path";
      readonly identity: RustCompilerItemIdentity;
      readonly crateName: string;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly genericArguments: readonly RustCompilerGenericArgument[];
    };

export type RustCompilerTypeRequirement =
  | "clone"
  | "copy"
  | { readonly kind: "trait"; readonly trait: RustCompilerTraitDispatch };

export interface RustCompilerTraitRequirement {
  readonly typeArgumentIndex: number;
  readonly requirement: RustCompilerTypeRequirement;
}

export interface RustCompilerTraitImplementation {
  readonly trait: RustCompilerTypeRequirement;
  readonly requirements: readonly RustCompilerTraitRequirement[];
}

export interface RustCompilerTypeTraits {
  readonly implementations: readonly RustCompilerTraitImplementation[];
}

export interface RustCompilerParameter {
  readonly name: string;
  readonly type: RustCompilerType;
}

export interface RustCompilerBorrowedResultProjection {
  readonly sourceType: RustCompilerType;
  readonly conversion: "copy" | "owned-string" | "optional-copy" | "optional-owned-string";
}

export type RustCompilerReceiver =
  | { readonly kind: "value"; readonly type: RustCompilerType }
  | { readonly kind: "shared"; readonly lifetime: RustCompilerLifetime; readonly type: RustCompilerType }
  | { readonly kind: "mutable"; readonly lifetime: RustCompilerLifetime; readonly type: RustCompilerType }
  | { readonly kind: "custom"; readonly type: RustCompilerType };

export interface RustCompilerTraitDispatch {
  readonly identity: RustCompilerItemIdentity;
  readonly path: string;
  readonly genericArguments: readonly RustCompilerGenericArgument[];
  readonly associatedConstraints: readonly RustCompilerAssociatedConstraint[];
  readonly lifetimeBinder?: RustCompilerLifetimeBinder;
}

export interface RustCompilerFunction {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly parameters: readonly RustCompilerParameter[];
  readonly result: RustCompilerType;
  readonly genericParameters: readonly RustCompilerGenericParameter[];
  readonly typeRequirements: readonly RustCompilerTypeParameter[];
  readonly resultLoans: import("../../../target-model/operations/result-loans.js").RustNativeResultLoanContract;
  readonly resultLoanTypes: {
    readonly result: RustCompilerType;
    readonly lifetimes: readonly { readonly key: string; readonly lifetime: RustCompilerLifetime }[];
    readonly inputs: readonly { readonly input: import("../../../target-model/operations/result-loans.js").RustNativeResultLoanOrigin["input"];
      readonly type: RustCompilerType }[];
  };
  readonly receiver?: RustCompilerReceiver;
  readonly traitDispatch?: RustCompilerTraitDispatch;
  readonly borrowedResult?: RustCompilerBorrowedResultProjection;
  readonly asynchronous: boolean;
  readonly unsafe: boolean;
  readonly abi: string;
  readonly variadic: boolean;
}

export interface RustCompilerField {
  readonly id: string;
  readonly name: string;
  readonly type: RustCompilerType;
}

export type RustCompilerEnumVariant = {
  readonly id: string;
  readonly name: string;
} & (
  | { readonly kind: "plain"; readonly fields: readonly RustCompilerType[] }
  | { readonly kind: "tuple"; readonly fields: readonly RustCompilerType[] }
  | { readonly kind: "struct"; readonly fields: readonly RustCompilerField[] }
);

export interface RustCompilerAssociatedConstant {
  readonly id: string;
  readonly name: string;
  readonly type: RustCompilerType;
  readonly traitDispatch?: RustCompilerTraitDispatch;
  readonly typeRequirements: readonly RustCompilerTypeParameter[];
}

export interface RustCompilerAssociatedType {
  readonly identity: RustCompilerItemIdentity;
  readonly name: string;
  readonly genericParameters: readonly RustCompilerGenericParameter[];
  readonly requirements: readonly RustCompilerTypeRequirement[];
  readonly outlives: readonly RustCompilerLifetime[];
  readonly maybeSized: boolean;
  readonly ownerRequirements: readonly RustCompilerTypeRequirement[];
  readonly ownerOutlives: readonly RustCompilerLifetime[];
  readonly ownerMaybeSized: boolean;
  readonly defaultType?: RustCompilerType;
}

export interface RustCompilerUnsupportedMember {
  readonly kind: "associated-constant" | "associated-type" | "field" | "method" | "variant";
  readonly name: string;
  readonly reason: string;
}

interface RustCompilerExportIdentity {
  readonly id: string;
  readonly name: string;
  readonly targetPath: readonly string[];
}

export type RustCompilerExport = RustCompilerExportIdentity & {
  readonly canonicalPath: readonly string[];
} & (
  | {
      readonly kind: "primitive";
      readonly type: Extract<RustCompilerType, { readonly kind: "primitive" }>;
      readonly methods: readonly RustCompilerFunction[];
      readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
    }
  | {
      readonly kind: "constant";
      readonly type: RustCompilerType;
    }
  | {
      readonly kind: "static";
      readonly type: RustCompilerType;
      readonly unsafe: boolean;
      readonly mutable: boolean;
      readonly copy: boolean;
    }
  | {
      readonly kind: "function";
      readonly function: RustCompilerFunction;
    }
  | {
      readonly kind: "struct";
      readonly genericParameters: readonly RustCompilerGenericParameter[];
      readonly fields: readonly RustCompilerField[];
      readonly methods: readonly RustCompilerFunction[];
      readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly traits: RustCompilerTypeTraits;
    }
  | {
      readonly kind: "type-alias";
      readonly genericParameters: readonly RustCompilerGenericParameter[];
      readonly type: RustCompilerType;
    }
  | {
      readonly kind: "enum";
      readonly genericParameters: readonly RustCompilerGenericParameter[];
      readonly variantsComplete: boolean;
      readonly variants: readonly RustCompilerEnumVariant[];
      readonly methods: readonly RustCompilerFunction[];
      readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly traits: RustCompilerTypeTraits;
    }
  | {
      readonly kind: "union";
      readonly genericParameters: readonly RustCompilerGenericParameter[];
      readonly fields: readonly RustCompilerField[];
      readonly methods: readonly RustCompilerFunction[];
      readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly traits: RustCompilerTypeTraits;
    }
  | {
      readonly kind: "trait";
      readonly genericParameters: readonly RustCompilerGenericParameter[];
      readonly methods: readonly RustCompilerFunction[];
      readonly associatedConstants: readonly RustCompilerAssociatedConstant[];
      readonly associatedTypes: readonly RustCompilerAssociatedType[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly superTraits: readonly RustCompilerTraitDispatch[];
      readonly outlives: readonly RustCompilerLifetime[];
      readonly auto: boolean;
      readonly unsafe: boolean;
    }
);

export interface RustCompilerStandardTypeLocation {
  readonly canonicalPath: readonly string[];
  readonly sourceModuleSpecifier: string;
  readonly sourceExportName: string;
  readonly targetPath: readonly string[];
  readonly targetId: string;
  readonly genericParameters: readonly RustCompilerGenericParameter[];
}

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
  readonly unsupportedExports: readonly RustCompilerUnsupportedExport[];
  readonly standardTypeLocations: readonly RustCompilerStandardTypeLocation[];
}

export interface RustCompilerNativeRetentionQuestion {
  readonly id: string;
  readonly declaration: RustCompilerItemIdentity;
  readonly dependency: RustCompilerDependency;
  readonly applicationIdentity: string;
  readonly resultType: RustCompilerType;
  readonly phase: "value" | "pending" | "completion";
  readonly invocation: {
    readonly path: readonly string[];
    readonly ownerArguments: readonly RustCompilerGenericArgument[];
    readonly method: string | undefined;
    readonly trait: RustCompilerTraitDispatch | undefined;
    readonly inputs: readonly { readonly input: import("../../../target-model/operations/result-loans.js").RustNativeResultLoanOrigin["input"];
      readonly type: RustCompilerType }[];
    readonly genericArguments: readonly RustCompilerGenericArgument[];
    readonly selectedInput: import("../../../target-model/operations/result-loans.js").RustNativeResultLoanOrigin["input"];
    readonly selectedKind: "borrow" | "carried";
    readonly asynchronous: boolean;
    readonly unsafe: boolean;
    readonly fallible: boolean;
  };
  readonly origin: {
    readonly lifetime: Extract<RustCompilerLifetime, { readonly kind: "parameter" | "bound" | "elided" }>;
    readonly referent: RustCompilerType;
    readonly mutable: boolean;
  };
  readonly parameters: readonly (RustCompilerGenericParameter | { readonly kind: "lifetime";
    readonly lifetime: Extract<RustCompilerLifetime, { readonly kind: "elided" }>;
    readonly outlives: readonly RustCompilerLifetime[] })[];
  readonly requirements: readonly RustCompilerTypeParameter[];
}

export interface RustCompilerNativeRetentionQuestionSpan {
  readonly questionId: string;
  readonly phase: "use" | "cleanup";
  readonly startLine: number;
  readonly endLine: number;
}

export interface RustCompilerNativeRetentionEvidence {
  readonly sourceDigest: string;
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly diagnosticsDigest: string;
  readonly diagnostics: readonly {
    readonly code: string | null;
    readonly message: string;
    readonly spans: readonly { readonly startLine: number; readonly endLine: number; readonly primary: boolean }[];
  }[];
}

export type RustCompilerNativeRetentionFact = {
  readonly questionId: string;
  readonly applicationIdentity: string;
} & (
  | { readonly kind: "resolved"; readonly use: "retained" | "released"; readonly cleanup: "retained" | "released" }
  | { readonly kind: "unavailable"; readonly reasons: readonly string[] }
);

export interface RustCompilerNativeRetentionBatch {
  readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
  readonly snapshotDigest: string;
  readonly compilerIdentity: string;
  readonly questionDigest: string;
  readonly facts: readonly RustCompilerNativeRetentionFact[];
  readonly evidence: readonly RustCompilerNativeRetentionEvidence[];
}
