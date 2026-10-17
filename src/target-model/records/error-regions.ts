import type { SourceFile } from "@tsonic/tsts";
import type { RustProgramErrorOwner, TargetTypeRef } from "../types/model.js";
import type { RustNativeErrorSource } from "../types/native-error-joins.js";
import type { RustProducerErrorReference } from "../types/carriers/producer-errors.js";
import type { RustErrorDomain } from "../operations/error-boundary.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";

export interface RustExternalSourcePackageError {
  readonly componentId: string;
  readonly errorOwnerComponentId: string;
  readonly crateName: string;
  readonly typePath: string;
  readonly variant: string;
}

export interface RustSourcePackageErrorDomainPlan {
  readonly componentId: string;
  readonly errorDomain: RustErrorDomain;
  readonly errorTypeIdentity: string;
  readonly errorOwnerComponentId: string | undefined;
  readonly forwardModulePath?: string;
  readonly definitions: readonly RustProjectTypeDefinition[];
  readonly externalErrors: readonly RustExternalSourcePackageError[];
}

export interface RustSourcePackageErrorPlan {
  readonly componentIdByFileName: ReadonlyMap<string, string>;
  readonly componentIdByDefinition: ReadonlyMap<RustProjectTypeDefinition, string>;
  readonly domainsByComponentId: ReadonlyMap<string, RustSourcePackageErrorDomainPlan>;
  readonly dependencyErrorsByComponentId: ReadonlyMap<string, readonly RustExternalSourcePackageError[]>;
  componentBoundaryFor(consumerComponentId: string, ownerComponentId: string): RustSourcePackageErrorBoundary | undefined;
  physicalBoundaryFor(consumerComponentId: string, owner: RustProgramErrorOwner): RustSourcePackageErrorBoundary | undefined;
  nativeBoundaryFor(consumerComponentId: string, owner: RustProgramErrorOwner): RustSourcePackageErrorBoundary | undefined;
}

export interface RustSourcePackageErrorBoundary {
  readonly componentId: string;
  readonly errorDomain: RustErrorDomain;
  readonly errorTypePath: string;
  readonly errorTypeIdentity: string;
}

export type RustPhysicalErrorOwner = Extract<RustProgramErrorOwner, { readonly kind: "physical" }>;

export type RustJsRejectionConversion =
  | { readonly kind: "identity" | "uninhabited" | "retained-error"; readonly carrier: TargetTypeRef }
  | { readonly kind: "program-error"; readonly carrier: TargetTypeRef; readonly owner: RustPhysicalErrorOwner }
  | { readonly kind: "native-join"; readonly carrier: TargetTypeRef; readonly arms: readonly RustJsRejectionConversion[] };

export interface RustJsRejectionRegion {
  readonly local: RustJsRejectionConversion | undefined;
  readonly sources: readonly { readonly identity: string; readonly conversion: RustJsRejectionConversion }[];
  readonly requiredCarriers: readonly TargetTypeRef[];
}

export interface RustErrorRegionSelection<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly kind: "infallible" | "package" | "native";
  readonly fileName: string;
  readonly localOwner: RustPhysicalErrorOwner | undefined;
  readonly sources: readonly Source[];
  readonly jsRejection?: RustJsRejectionRegion;
}

export interface RustSourceErrorRegionSelection<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly operand: RustErrorRegionSelection<Source>;
  readonly channels: readonly {
    readonly sourceIdentity: string;
    readonly targetIdentity: string;
    readonly uninhabited: boolean;
  }[];
}

export interface RustModuleErrorInitializer<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly sourceFile: SourceFile;
  readonly identity: string;
  readonly asynchronous: boolean;
  readonly region: RustErrorRegionSelection<Source>;
}

export type RustInitializerErrorSelection =
  | { readonly kind: "infallible" }
  | { readonly kind: "package"; readonly owner: RustPhysicalErrorOwner }
  | { readonly kind: "native"; readonly owner: RustPhysicalErrorOwner; readonly sources: readonly (
      | { readonly kind: "package"; readonly identity: string; readonly variant: string }
      | { readonly kind: "module"; readonly identity: string; readonly variant: string; readonly sourceFile: SourceFile }
    )[] };

export interface RustInitializerSelection<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly modules: readonly RustModuleErrorInitializer<Source>[];
  readonly asynchronous: boolean;
  readonly error: RustInitializerErrorSelection;
}

export interface RustBinaryErrorSelection {
  readonly sources: readonly (
    | { readonly kind: "lifecycle"; readonly identity: "lifecycle"; readonly variant: "Lifecycle" }
    | { readonly kind: "initialization"; readonly identity: "initialization"; readonly variant: "Initialization" }
    | { readonly kind: "worker"; readonly identity: string; readonly variant: string; readonly sourceFile: SourceFile }
  )[];
}

export interface RustInitializationErrorRecords<Source extends RustNativeErrorSource<TargetTypeRef> =
  RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef }> {
  readonly entrySourceFile: SourceFile | undefined;
  readonly root: RustInitializerSelection<Source>;
  readonly workers: readonly { readonly sourceFile: SourceFile; readonly initializer: RustInitializerSelection<Source> }[];
  readonly binary: RustBinaryErrorSelection;
  readonly moduleFor: (sourceFile: SourceFile) => RustModuleErrorInitializer<Source> | undefined;
  readonly workerFor: (sourceFile: SourceFile) => RustInitializerSelection<Source> | undefined;
}

export interface RustErrorJoinDeclaration {
  readonly name: string;
  readonly arity: number;
  readonly clone: boolean;
}

export interface RustErrorRegionRecords {
  readonly declarationsFor: (fileName: string) => readonly RustErrorJoinDeclaration[];
  readonly producerError: (reference: RustProducerErrorReference) => TargetTypeRef | undefined;
  readonly initialization: RustInitializationErrorRecords;
}
