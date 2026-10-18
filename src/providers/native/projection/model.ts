import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import type { ProviderDeclarationModel, ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerDependency,
  RustCompilerGenericParameter,
  RustCompilerStandardTypeLocation,
  RustCompilerFunction,
  RustCompilerType,
} from "../model/model.js";
import type { RustNamedTypeTraitContract } from "../../../target-model/types/model.js";
import type { RustProviderModuleDefinition, RustProviderOperationDefinition, RustProviderTypeDefinition } from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export interface RustCompilerProviderProjection {
  readonly nativeDeclarations: ReadonlyMap<string, RustCompilerNativeDeclarationProjection>;
  readonly nativeApplications: readonly RustCompilerNativeTypeProjection[];
  readonly completeExports: ReadonlySet<string>;
  readonly declarationModel: ProviderDeclarationModel;
  readonly module: RustProviderModuleDefinition;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly types: readonly RustProviderTypeDefinition[];
  readonly carrierPaths: ReadonlyMap<string, string>;
  readonly carrierTraits: ReadonlyMap<string, RustNamedTypeTraitContract>;
}

export interface RustCompilerNativeDeclarationProjection {
  readonly declaration: RustCompilerFunction;
  readonly dependency: RustCompilerDependency;
  readonly publicPath: readonly string[];
  readonly method: string | undefined;
  readonly ownerParameters: readonly RustCompilerGenericParameter[];
  readonly parameters: readonly {
    readonly native: RustCompilerGenericParameter;
    readonly projected: import("../../../target-model/operations/model.js").RustProviderGenericParameter;
  }[];
}

export interface RustCompilerNativeTypeProjection {
  readonly native: RustCompilerType;
  readonly target: TargetTypeRef;
}

export interface RustNativeResultRetentionRequest {
  readonly id: string;
  readonly declarationIdentity: string;
  readonly resultTypeIdentity: string;
  readonly phase: "value" | "pending" | "completion";
  readonly origin: import("../../../target-model/operations/result-loans.js").RustNativeResultLoanOrigin;
  readonly application: import("../../../target-model/types/carriers/generic-inference.js").RustTargetGenericBindings;
  readonly arguments: readonly import("../../../target-model/types/model.js").RustTargetGenericArgument[];
}

export interface ProjectionOwner {
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export interface ProjectionContext {
  readonly allocateFunctionTypeIdentity: () => string;
  readonly materialization: import("@tsonic/tsts").ProviderDeclarationMaterialization;
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly owner: ProjectionOwner;
  readonly imports: Map<string, Set<string>>;
  readonly carrierPaths: Map<string, string>;
  readonly carrierTraits: Map<string, RustNamedTypeTraitContract>;
  readonly nativeDeclarations: Map<string, RustCompilerNativeDeclarationProjection>;
  readonly nativeApplications: RustCompilerNativeTypeProjection[];
  readonly standardTypes: ReadonlyMap<string, RustCompilerStandardTypeLocation>;
  readonly localTypeLocations: ReadonlyMap<string, {
    readonly sourceExportName: string;
    readonly targetPath: readonly string[];
    readonly genericParameters: readonly RustCompilerGenericParameter[];
  }>;
  readonly defaultGenericBindings?: import("../model/types/substitution.js").RustCompilerSubstitutions;
  readonly callableGenerics?: ReadonlyMap<string, import("./callable-generics.js").RustCompilerCallableSignature>;
  readonly genericNames?: ReadonlyMap<string, { readonly nativeName: string; readonly sourceName: string }>;
  readonly currentType?: {
    readonly exportId: string;
    readonly name: string;
    readonly carrier: TargetTypeRef;
    readonly sourceType: ProviderTypeExpression;
    readonly genericParameters: readonly RustCompilerGenericParameter[];
    readonly canonicalPath: readonly string[];
    readonly targetPath: readonly string[];
  };
}

export const sourcePrimitiveByRustName = new Map<string, Parameters<typeof rustSourcePrimitiveTargetType>[0]>([
  ["bool", "bool"],
  ["i8", "int8"],
  ["u8", "uint8"],
  ["i16", "int16"],
  ["u16", "uint16"],
  ["i32", "int32"],
  ["u32", "uint32"],
  ["i64", "int64"],
  ["u64", "uint64"],
  ["i128", "int128"],
  ["u128", "uint128"],
  ["isize", "native-int"],
  ["usize", "native-uint"],
  ["f32", "float32"],
  ["f64", "float64"],
]);
