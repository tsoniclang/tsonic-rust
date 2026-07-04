export { createRustTargetPack, rustTargetId } from "./descriptor/rust-target-pack.js";
import { createRustTargetPack } from "./descriptor/rust-target-pack.js";
export {
  readRustCrateName,
  readRustEdition,
  readRustOutputType,
  readRustTypescriptCompatibilityMode,
  validateRustTargetOptions,
} from "./options/rust-target-options.js";
export type { RustEdition, RustOutputType } from "./options/rust-target-options.js";
export { createRustBackend } from "./backend/rust-backend.js";
export { planRustArtifacts, rustModuleNameForFile } from "./backend/planner/rust-planner.js";
export {
  cargoCrateAttributeName,
  cargoPathReferenceKind,
  planCargoManifest,
} from "./backend/planner/cargo-project.js";
export type { CargoDependency, CargoManifestPlan, CargoManifestPlanResult } from "./backend/planner/cargo-project.js";
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
  createRustTargetSemanticsExtension,
  recordRustFactsBeforeFinalization,
  rustTargetSemanticsExtensionId,
} from "./source/rust-target-semantics/index.js";
export {
  collectRustProviderOperationRows,
  rustProviderOperationsMappersOf,
  rustProviderOperationsMapperKind,
  createRustProviderPackage,
  createRustProviderPackageBindingProvider,
} from "./source/provider-packages/index.js";
export type {
  RustProviderCrateDefinition,
  RustProviderModuleDefinition,
  RustProviderOperationRow,
  RustProviderPackageDefinition,
  RustProviderPackageImplementation,
} from "./source/provider-packages/index.js";
export { rustExtensionId, rustTargetOperationFactKey } from "./source/rust-facts/keys.js";
export type { RustProviderOperationForm, RustTargetOperationFact } from "./source/rust-facts/keys.js";
export {
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustNumericCarrier,
  isRustSignedNumericCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  rustPrimitiveTypeName,
  rustSourcePrimitiveTargetType,
  rustStringTargetId,
  rustStringTargetType,
  rustUnitTargetType,
  sameRustPrimitiveCarrier,
} from "./source/rust-target-types.js";
export { rustTypeFromCarrier } from "./backend/planner/render-types.js";
export { createRustCompileInputFromSession } from "./session/compile-input.js";
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
export type { RustProviderOperationsMapper } from "./source/provider-packages/index.js";
