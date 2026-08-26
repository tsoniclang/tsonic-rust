import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import type { ProviderDeclarationModel, ProviderTypeExpression } from "@tsonic/tsts";
import type {
  RustCompilerDependency,
  RustCompilerGenericParameter,
  RustCompilerStandardTypeLocation,
} from "../model/model.js";
import type { RustNamedTypeTraitContract } from "../../../target-model/types/model.js";
import type { RustProviderModuleDefinition, RustProviderOperationDefinition, RustProviderTypeDefinition } from "../../packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export interface RustCompilerProviderProjection {
  readonly declarationModel: ProviderDeclarationModel;
  readonly module: RustProviderModuleDefinition;
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly types: readonly RustProviderTypeDefinition[];
  readonly carrierPaths: ReadonlyMap<string, string>;
  readonly carrierTraits: ReadonlyMap<string, RustNamedTypeTraitContract>;
}

export interface ProjectionOwner {
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export interface ProjectionContext {
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly owner: ProjectionOwner;
  readonly imports: Map<string, Set<string>>;
  readonly carrierPaths: Map<string, string>;
  readonly carrierTraits: Map<string, RustNamedTypeTraitContract>;
  readonly standardTypes: ReadonlyMap<string, RustCompilerStandardTypeLocation>;
  readonly localStandardTypeNames: ReadonlyMap<string, string>;
  readonly defaultGenericBindings?: import("../model/rustdoc-types.js").RustCompilerSubstitutions;
  readonly genericNames?: ReadonlyMap<string, string>;
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
