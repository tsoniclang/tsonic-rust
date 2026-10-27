import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProgramErrorModuleEmission } from "../../target-model/records/errors/error-transport.js";
import type { RustSourcePackageErrorPlan } from "../../target-model/records/errors/source-package-errors.js";
import type { RustErrorTransportEmissionProducer } from "../program/records/errors/error-transport.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustTsValueTargetType, rustJsValueTargetType,
  rustNamedTargetType, rustJsErrorTargetId } from "../../target-model/types/index.js";
import { rustRuntimeErrorTypeIdentity } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustStandaloneTypeIdentity } from "../../policy/types/resolution/standalone-emission.js";

export function analyzeRustProgramErrorModuleEmission(program: Omit<RustAnalysisProgram, "reachability">,
  errors: RustSourcePackageErrorPlan, producer: RustErrorTransportEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const providers = new Map<string, TargetTypeRef>();
  const builtins = new Set([
    selectRustStandaloneTypeIdentity(rustNamedTargetType(rustRuntimeErrorTypeIdentity, "tsonic_rust_runtime::TsonicError"), { programError: false }),
    selectRustStandaloneTypeIdentity(rustNamedTargetType(rustJsErrorTargetId, "tsonic_rust_runtime::JsError"), { programError: false }),
  ]);
  const ownsTransport = [...errors.domainsByComponentId.values()].some(domain =>
    domain.errorDomain === "project" && domain.forwardModulePath === undefined);
  if (!ownsTransport) return Object.freeze(issues);
  for (const carrier of program.providerErrorCarriers) {
    if (rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) || rustTargetTypeRefEquals(carrier, rustProgramErrorTargetType())) continue;
    const identity = selectRustStandaloneTypeIdentity(carrier, { programError: false });
    if (identity === undefined) {
      issues.push(Object.freeze({ code: "RUST_PROVIDER_ERROR_CARRIER_UNRENDERABLE", category: "error", source: "tsonic-rust",
        message: "A selected provider-native error carrier has no exact renderable Rust type.",
        evidence: Object.freeze(["target.capability=rust.error.provider-conversion", `carrier=${JSON.stringify(carrier)}`]) }));
      continue;
    }
    if (!builtins.has(identity) && !providers.has(identity)) providers.set(identity, carrier);
  }
  const providerErrors = Object.freeze([...providers].sort(([left], [right]) => left.localeCompare(right, "en")).map(([, carrier]) => carrier));
  for (const domain of errors.domainsByComponentId.values()) {
    if (domain.errorDomain !== "project" || domain.forwardModulePath !== undefined) continue;
    const inventory = producer.records.programErrorVariants.get(domain.componentId);
    if (inventory === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted program error module requires its closed variant inventory.");
    const projects: RustProgramErrorModuleEmission["projects"][number][] = [];
    const closedPayloadPaths = new Map<string, string>();
    for (const selected of inventory) {
      if (selected.kind === "project") {
        const identity = program.sourceOutputIdentities.get(selected.definition.fileName);
        if (identity === undefined) {
          issues.push(Object.freeze({ code: "RUST_PROGRAM_ERROR_IDENTITY_MISSING", category: "error", source: "tsonic-rust",
            message: `Project error '${selected.definition.sourceName}' has no exact generated module or variant identity.`,
            sourceNode: selected.definition.declaration, evidence: ["target.capability=rust.error.closed-program-transport"] }));
          continue;
        }
        const representation = program.records.objectRepresentation.get(selected.definition);
        if (representation === undefined) {
          issues.push(Object.freeze({ code: "RUST_PROGRAM_ERROR_REPRESENTATION_MISSING", category: "error", source: "tsonic-rust",
            message: "Native thrown-value queries require exact finalized project storage." }));
          continue;
        }
        projects.push(Object.freeze({ definition: selected.definition, name: selected.name,
          typePath: `crate::${identity.moduleName}::${selected.definition.targetName}`, representation,
          delegate: program.records.projectError.get(selected.definition)?.inherited === true }));
      } else if (selected.kind === "closed") {
        const path = rustTargetTypeRefEquals(selected.carrier, rustTsValueTargetType()) ? "tsonic_rust_runtime::TsValue"
          : rustTargetTypeRefEquals(selected.carrier, rustJsValueTargetType()) ? "tsonic_rust_js::value::JsValue" : undefined;
        if (path === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted closed error payload requires its exact native carrier identity.");
        closedPayloadPaths.set(selected.name, path);
      }
    }
    producer.module(domain.componentId, { projects: Object.freeze(projects), providerErrors, closedPayloadPaths });
  }
  return Object.freeze(issues);
}
