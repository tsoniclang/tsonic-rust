import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustReachability } from "../../target-model/records/program/reachability.js";
import type { RustProjectClassProducer } from "../program/records/objects/project-classes.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";

export function analyzeRustProjectPolymorphicEmission(program: Omit<RustAnalysisProgram, "reachability">,
  definition: RustProjectTypeDefinition, reachability: RustReachability, producer: RustProjectClassProducer): void {
  const carrier = program.projectTypes.openCarrier(definition);
  const representation = program.objectRepresentations.representationFor(definition);
  const dispatch = producer.records.projectDispatchEmission.get(definition);
  const root = producer.records.projectRootEmission.get(carrier);
  const native = program.records.nativeClass.get(definition.declaration);
  if (representation === undefined || dispatch === undefined || definition.kind === "class" && native === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted polymorphic native declaration requires its exact representation and dispatch metadata.", definition.declaration);
  const publiclyReachable = dispatch.publiclyReachable;
  const environment = program.classValues.forDeclaration(definition.declaration)?.environment;
  const stateUsed = program.records.projectError.get(definition)?.inherited === true || root?.contracts.some(contract =>
    [...contract.fields.values()].some(field => field.implementation.kind === "stored") ||
      contract.methods.some(method => method.overridePath !== undefined || method.write !== undefined)) === true;
  producer.polymorphic(definition.declaration, { definition, carrier, representation,
    programError: program.projectTypes.programErrorVariant(definition) !== undefined, publiclyReachable,
    visibility: publiclyReachable || program.source.ast.hasModifierKind(definition.declaration, "export") ? "public" : "crate",
    wrapperDeadCode: publiclyReachable ? undefined : reachability.suppressedDeclarations.has(definition.declaration)
      ? "authored-declaration" : reachability.constructedProjectTypes.has(definition.declaration) || reachability.reifiedProjectTypes.has(definition.declaration)
        ? undefined : "generated-unconstructed-instance",
    baseStateDeadCode: publiclyReachable || reachability.usedProjectFields.get(definition.declaration)?.has("base-state") === true
      ? undefined : "generated-unused-storage",
    rootStateDeadCode: stateUsed ? undefined : "generated-unused-storage",
    environment: environment?.instancesUseEnvironment === true ? environment : undefined });
}
