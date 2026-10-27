import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustStructuralEmissionProducer } from "../program/records/objects/structural-emission.js";
import type { RustProjectEmissionProducer } from "../program/records/program/project-emission.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustCarrierSupportsTrait } from "../../policy/constraints/native-traits.js";
import { selectRustStructuralEmission } from "../../policy/types/objects/structural-emission.js";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustStructuralShapeDefinition } from "../../target-model/records/objects/structural-shapes.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustStructuralEmission(
  program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustStructuralEmissionProducer,
  projects: Pick<RustProjectEmissionProducer, "structuralShapes">,
): readonly TargetDiagnostic[] {
  projects.structuralShapes(program.structuralShapes.definitionForCarrier);
  const issues: TargetDiagnostic[] = [];
  const templates = new Set(program.structuralShapes.definitions);
  const constructors = new Map<RustStructuralShapeDefinition, Set<"value" | "identity">>(
    [...templates].map(template => [template, new Set()]));
  const retainConstructor = (carrier: TargetTypeRef, mode: "value" | "identity"): void => {
    const definition = program.structuralShapes.definitionForCarrier(carrier);
    if (definition === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "A structural construction requires its completed native owner.");
    const template = templates.has(definition) ? definition : program.structuralShapes.templateForCarrier(carrier);
    if (template === undefined || !constructors.has(template))
      failTargetAnalysisInvariant("tsonic-rust", "A structural constructor requires its canonical native template.");
    if (template.contextConstructor !== undefined) constructors.get(template)!.add(mode);
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "record-literal" && operation.storage === "structural-object")
      retainConstructor(operation.resultCarrier, "value");
    const view = program.records.objectReferenceEmission.get(node);
    if (view !== undefined && view.kind !== "identity")
      retainConstructor(view.view.targetCarrier, "identity");
  }
  for (const definition of new Set([...program.structuralShapes.definitions, ...program.structuralShapes.instances])) {
    const value = rustStructuralObjectCarrierValue(definition.carrier)?.representation === "value";
    const template = templates.has(definition) ? definition : program.structuralShapes.templateForCarrier(definition.carrier);
    if (template === undefined || !templates.has(template))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural instance requires its canonical native template.");
    const genericRequirements = program.records.structuralGenerics.get(template.carrier);
    if (genericRequirements === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural emission requires its completed generic contract.");
    const selectedConstructors = constructors.get(template);
    if (selectedConstructors === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "A structural emission requires its complete constructor-use selection.");
    const selection = selectRustStructuralEmission({ definition, template, genericRequirements,
      contextConstructors: [...selectedConstructors],
      clone: value && rustCarrierSupportsTrait(definition.carrier, "core::clone::Clone", () => true, undefined, program.typeDefinitions),
      copy: value && rustCarrierSupportsTrait(definition.carrier, "core::marker::Copy", () => true, undefined, program.typeDefinitions),
      default: value && rustCarrierSupportsTrait(definition.carrier, "core::default::Default", () => true, undefined, program.typeDefinitions) });
    if (selection.kind === "unsupported") issues.push({ code: selection.code, category: "error", source: "tsonic-rust", message: selection.message, evidence: [`target.capability=${selection.capability}`] });
    else producer.publish(definition, selection.value);
  }
  return Object.freeze(issues);
}
