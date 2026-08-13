export { createRustTargetPack, rustTargetId } from "./descriptor/rust-target-pack.js";
export {
  rustLangModule,
  rustSourceSemanticsModules,
  rustTypesModule,
} from "./source/rust-source-semantics/source-modules.js";
import { createRustTargetPack } from "./descriptor/rust-target-pack.js";
export {
  readRustCrateName,
  readRustEdition,
  readRustOutputType,
  readRustUserProjectFile,
  readRustTypescriptCompatibilityMode,
  validateRustTargetOptions,
} from "./options/rust-target-options.js";
export type { RustEdition, RustOutputType } from "./options/rust-target-options.js";
export { createRustBackend } from "./backend/rust-backend.js";
export { planRustArtifacts, rustModuleNameForFile } from "./backend/planner/rust-planner.js";
export {
  cargoCrateAttributeName,
  cargoCratesIoRegistry,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
  planCargoManifest,
  planRustCargoProject,
} from "./backend/planner/cargo-project.js";
export type {
  CargoDependency,
  CargoManifestPlan,
  CargoManifestPlanResult,
  RustCargoProjectPlan,
  RustCargoProjectPlanResult,
} from "./backend/planner/cargo-project.js";
export {
  missingFactDiagnostic,
  missingRuntimeReferenceDiagnostic,
  unsupportedConstructDiagnostic,
  unsupportedStatementDiagnostic,
} from "./backend/planner/diagnostics.js";
export type {
  RustBlock,
  RustExpr,
  RustFunctionParam,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustType,
} from "./backend/rust-ast/nodes.js";
export { createRustSourceFile, rustGeneratedHeaderComment } from "./backend/rust-ast/nodes.js";
export {
  escapeRustString,
  printRustExpr,
  printRustItem,
  printRustSourceFile,
  printRustType,
} from "./print/rust-printer.js";
export { printCargoManifest } from "./print/cargo-manifest-printer.js";
export { createCargoToolchain } from "./toolchain/cargo-toolchain.js";
export {
  analyzeRustProgram,
  rustTargetSemanticsExtensionId,
} from "./source/rust-target-semantics/index.js";
export {
  collectRustProviderOperationRows,
  collectRustProviderSemantics,
  rustProviderPolicyContributionsOf,
  rustProviderPolicyContributionKind,
  createRustProviderPackage,
  createRustProviderPackageSourceProvider,
} from "./source/provider-packages/index.js";
export type {
  RustProviderCrateDefinition,
  RustProviderModuleDefinition,
  RustProviderOperationDefinition,
  RustProviderOperationRow,
  RustProviderPackageDefinition,
  RustProviderPackageImplementation,
  RustProviderPolicyContribution,
  RustProviderSourceDependency,
  RustProviderTypeDefinition,
  RustProviderTypeRow,
} from "./source/provider-packages/index.js";
export type { RustTargetTypeRef } from "./policy/types.js";
export { rustExtensionId, rustTargetOperationFactKey } from "./source/rust-facts/keys.js";
export type {
  RustProviderChainStep,
  RustProviderConstantArgument,
  RustProviderOperationForm,
  RustTargetOperationFact,
  RustValueConversion,
  RustValueConversionId,
} from "./source/rust-facts/keys.js";
export {
  rustFloat64ToInt32ValueConversion,
  rustInt32ToFloat64ValueConversion,
  rustInt32ToUint8ValueConversion,
  rustInt32ToUsizeValueConversion,
  rustIsizeToFloat64ValueConversion,
  rustIsizeToInt32ValueConversion,
  rustUint32ToInt32ValueConversion,
  rustUint64ToFloat64ValueConversion,
  rustUint8ToInt32ValueConversion,
  rustUsizeToInt32ValueConversion,
  rustUsizeToFloat64ValueConversion,
  rustValueConversionContract,
  rustValueConversionIsFallible,
  selectRustSourceValueConversion,
} from "./source/rust-facts/value-conversions.js";
export type { RustValueConversionContract } from "./source/rust-facts/value-conversions.js";
export {
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustNumericCarrier,
  isRustSignedNumericCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  rustPrimitiveTypeName,
  rustJsArrayTargetType,
  rustJsArrayConcatItemTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetId,
  rustStringTargetType,
  rustUnitTargetType,
  rustUsizeTargetId,
  rustUsizeTargetType,
  rustVecTargetType,
  sameRustPrimitiveCarrier,
} from "./source/rust-target-types.js";
export { rustTypeFromCarrier } from "./backend/planner/render-types.js";
export { composeRustCapabilities } from "./plugin/compose.js";
export type { TsonicPlugin, TsonicTargetPlugin, TsonicTargetCapabilityPlugin, TargetCapabilityContext, TargetProviderModuleOwnership } from "./plugin/types.js";

// Standard installed-plugin entrypoint: the host imports the package and
// calls createTsonicPlugin() to register the Rust target.
export function createTsonicPlugin(): import("@tsonic/target-api").TsonicTargetPlugin {
  return {
    kind: "target",
    id: "@tsonic/target-rust",
    targetId: "rust",
    createTargetPack() {
      return createRustTargetPack();
    },
  };
}
