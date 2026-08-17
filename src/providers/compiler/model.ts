export const rustCompilerProviderProtocolVersion = 2;
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

export type RustCompilerType =
  | { readonly kind: "unit" }
  | { readonly kind: "primitive"; readonly name: string }
  | { readonly kind: "generic"; readonly name: string }
  | { readonly kind: "self" }
  | { readonly kind: "tuple"; readonly elements: readonly RustCompilerType[] }
  | { readonly kind: "array"; readonly element: RustCompilerType; readonly length: number }
  | { readonly kind: "slice"; readonly element: RustCompilerType }
  | { readonly kind: "reference"; readonly mutable: boolean; readonly target: RustCompilerType }
  | { readonly kind: "raw-pointer"; readonly mutable: boolean; readonly target: RustCompilerType }
  | {
      readonly kind: "function-pointer";
      readonly parameters: readonly RustCompilerType[];
      readonly result: RustCompilerType;
      readonly abi: string;
      readonly unsafe: boolean;
    }
  | {
      readonly kind: "path";
      readonly crateName: string;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly typeArguments: readonly RustCompilerType[];
    };

export interface RustCompilerTypeParameter {
  readonly name: string;
  readonly requirements: readonly RustCompilerTypeRequirement[];
  readonly defaultType?: RustCompilerType;
}

export type RustCompilerTypeRequirement =
  | "clone"
  | "copy"
  | { readonly kind: "trait"; readonly path: string };

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

export interface RustCompilerFunction {
  readonly id: string;
  readonly name: string;
  readonly parameters: readonly RustCompilerParameter[];
  readonly result: RustCompilerType;
  readonly typeParameters: readonly RustCompilerTypeParameter[];
  readonly typeRequirements: readonly RustCompilerTypeParameter[];
  readonly receiver?: "value" | "shared" | "mutable";
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

export interface RustCompilerEnumVariant {
  readonly id: string;
  readonly name: string;
  readonly kind: "plain" | "tuple";
  readonly fields: readonly RustCompilerType[];
}

export interface RustCompilerUnsupportedMember {
  readonly kind: "field" | "method" | "variant";
  readonly name: string;
  readonly reason: string;
}

interface RustCompilerExportIdentity {
  readonly id: string;
  readonly name: string;
  readonly canonicalPath: readonly string[];
  readonly targetPath: readonly string[];
}

export type RustCompilerExport = RustCompilerExportIdentity & (
  | {
      readonly kind: "constant";
      readonly type: RustCompilerType;
    }
  | {
      readonly kind: "static";
      readonly type: RustCompilerType;
      readonly unsafe: boolean;
      readonly mutable: boolean;
    }
  | {
      readonly kind: "function";
      readonly function: RustCompilerFunction;
    }
  | {
      readonly kind: "struct";
      readonly typeParameters: readonly RustCompilerTypeParameter[];
      readonly fields: readonly RustCompilerField[];
      readonly methods: readonly RustCompilerFunction[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly traits: RustCompilerTypeTraits;
    }
  | {
      readonly kind: "type-alias";
      readonly typeParameters: readonly RustCompilerTypeParameter[];
      readonly type: RustCompilerType;
    }
  | {
      readonly kind: "enum";
      readonly typeParameters: readonly RustCompilerTypeParameter[];
      readonly variantsComplete: boolean;
      readonly variants: readonly RustCompilerEnumVariant[];
      readonly methods: readonly RustCompilerFunction[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly traits: RustCompilerTypeTraits;
    }
  | {
      readonly kind: "union";
      readonly typeParameters: readonly RustCompilerTypeParameter[];
      readonly fields: readonly RustCompilerField[];
      readonly methods: readonly RustCompilerFunction[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
      readonly traits: RustCompilerTypeTraits;
    }
);

export interface RustCompilerStandardTypeLocation {
  readonly canonicalPath: readonly string[];
  readonly sourceModuleSpecifier: string;
  readonly sourceExportName: string;
  readonly targetPath: readonly string[];
  readonly targetId: string;
  readonly sourceTypeArgumentCount: number;
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
