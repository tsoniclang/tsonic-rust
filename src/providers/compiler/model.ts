export const rustCompilerProviderProtocolVersion = 1;
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

export interface RustCompilerProjectSnapshot {
  readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
  readonly manifestPath: string;
  readonly rootPackageId: string;
  readonly compiler: RustCompilerIdentity;
  readonly dependencies: readonly RustCompilerDependency[];
  readonly packageSources: readonly RustCompilerPackageSource[];
  readonly digest: string;
}

export type RustCompilerType =
  | { readonly kind: "unit" }
  | { readonly kind: "primitive"; readonly name: string }
  | { readonly kind: "generic"; readonly name: string }
  | { readonly kind: "self" }
  | { readonly kind: "tuple"; readonly elements: readonly RustCompilerType[] }
  | { readonly kind: "array"; readonly element: RustCompilerType; readonly length: number }
  | { readonly kind: "slice"; readonly element: RustCompilerType }
  | { readonly kind: "reference"; readonly mutable: boolean; readonly target: RustCompilerType }
  | {
      readonly kind: "path";
      readonly crateName: string;
      readonly modulePath: readonly string[];
      readonly name: string;
      readonly typeArguments: readonly RustCompilerType[];
    };

export interface RustCompilerTypeParameter {
  readonly name: string;
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
  readonly receiver?: "value" | "shared" | "mutable";
  readonly asynchronous: boolean;
  readonly unsafe: boolean;
}

export interface RustCompilerField {
  readonly id: string;
  readonly name: string;
  readonly type: RustCompilerType;
}

export interface RustCompilerUnsupportedMember {
  readonly kind: "field" | "method";
  readonly name: string;
  readonly reason: string;
}

export type RustCompilerExport =
  | {
      readonly kind: "function";
      readonly id: string;
      readonly name: string;
      readonly function: RustCompilerFunction;
    }
  | {
      readonly kind: "struct";
      readonly id: string;
      readonly name: string;
      readonly typeParameters: readonly RustCompilerTypeParameter[];
      readonly fields: readonly RustCompilerField[];
      readonly methods: readonly RustCompilerFunction[];
      readonly unsupportedMembers: readonly RustCompilerUnsupportedMember[];
    };

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
}
