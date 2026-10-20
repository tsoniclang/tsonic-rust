import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustProjectUnionMappingProducer } from "../program/records/project-union-mappings.js";
import { rustProjectUnionMapConversionMatches } from "../../target-model/conversions/project-union.js";
import { rustProjectUnionUpcastRelation } from "../../target-model/conversions/project-union-relations.js";
import { rustFlowReadProjectionMatches } from "../control-flow/flow-read-projections.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { selectRustUnionMappingEmission } from "../../policy/conversions/union-mappings.js";

export function analyzeRustProjectUnionMappings(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustProjectUnionMappingProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const relation = rustProjectUnionUpcastRelation(program.projectTypes);
  for (const node of nodes) {
    const contextual = program.records.contextualValueConversion.get(node);
    if (contextual?.conversion.kind !== "project-union-map") continue;
    const conversion = contextual.conversion;
    const source = contextual.sourceCarrier;
    const target = contextual.targetCarrier;
    if (!rustProjectUnionMapConversionMatches(conversion, source, target, program.typeDefinitions, relation)) {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
        message: "Project union conversion requires its exact finalized native carrier and arm correspondence." });
      continue;
    }
    const flow = program.records.flowReadProjection.get(node);
    const upstream = flow?.kind === "union-map" && rustTargetTypeRefEquals(flow.selectedCarrier, source) ? flow : undefined;
    const requests = upstream === undefined ? [undefined] : [undefined, upstream];
    for (const before of requests) {
      if (producer.records.projectUnionMapping.get(conversion, before) !== undefined) continue;
      if (before !== undefined && (!isClosedMetadata(before) ||
        !rustTargetTypeRefEquals(rustOptionElementCarrier(before.sourceCarrier) ?? before.sourceCarrier, before.dispatchCarrier) ||
        !rustFlowReadProjectionMatches(before, program.projectTypes, program.typeDefinitions))) {
        issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "Project union conversion requires its exact preceding flow projection." });
        continue;
      }
      const mapping = selectRustUnionMappingEmission(before?.dispatchCarrier ?? source, target,
        conversion.arms.map(({ upcast: _upcast, ...arm }) => arm), before === undefined ? "source" : "target",
        before !== undefined && rustOptionElementCarrier(before.sourceCarrier) !== undefined, false, program.typeDefinitions,
        (source, target) => relation(source, target) === "related", before === undefined ? undefined : { carrier: source, arms: before.arms });
      if (mapping === undefined || mapping.arms.length !== conversion.arms.length) {
        issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "Project union conversion requires exact composed native arm and absence correspondence." });
        continue;
      }
      producer.publish(node, conversion, before, { mapping, upcasts: Object.freeze(conversion.arms.map(arm => arm.upcast)) });
    }
  }
  return Object.freeze(issues);
}
