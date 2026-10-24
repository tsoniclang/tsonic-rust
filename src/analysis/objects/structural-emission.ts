import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustStructuralEmissionProducer } from "../program/records/structural-emission.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustCarrierSupportsTrait } from "../../policy/constraints/native-traits.js";
import { selectRustStructuralEmission } from "../../policy/types/objects/structural-emission.js";

export function analyzeRustStructuralEmission(program: Omit<RustAnalysisProgram, "reachability">, producer: RustStructuralEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const templates = new Set(program.structuralShapes.definitions);
  for (const definition of new Set([...program.structuralShapes.definitions, ...program.structuralShapes.instances])) {
    const value = rustStructuralObjectCarrierValue(definition.carrier)?.representation === "value";
    const template = templates.has(definition) ? definition : program.structuralShapes.templateForCarrier(definition.carrier);
    if (template === undefined || !templates.has(template))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural instance requires its canonical native template.");
    const genericRequirements = program.records.structuralGenerics.get(template.carrier);
    if (genericRequirements === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural emission requires its completed generic contract.");
    const selection = selectRustStructuralEmission({ definition, template, genericRequirements,
      clone: value && rustCarrierSupportsTrait(definition.carrier, "core::clone::Clone", () => true, undefined, program.typeDefinitions),
      copy: value && rustCarrierSupportsTrait(definition.carrier, "core::marker::Copy", () => true, undefined, program.typeDefinitions),
      default: value && rustCarrierSupportsTrait(definition.carrier, "core::default::Default", () => true, undefined, program.typeDefinitions) });
    if (selection.kind === "unsupported") issues.push({ code: selection.code, category: "error", source: "tsonic-rust", message: selection.message, evidence: [`target.capability=${selection.capability}`] });
    else producer.publish(definition, selection.value);
  }
  return Object.freeze(issues);
}
