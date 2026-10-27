import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectUnionMappingProducer } from "../program/records/types/project-union-mappings.js";
import { rustProjectUnionMapConversionMatches } from "../../policy/conversions/project-union.js";
import { rustProjectUnionUpcastRelation } from "../../policy/model/project-union-relations.js";
import { rustFlowReadProjectionMatches } from "../control-flow/flow-read-projections.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { selectRustUnionMappingEmission } from "../../policy/conversions/union-mappings.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectUnionMapConversion } from "../../target-model/conversions/project-union.js";
import type { RustFlowReadProjectionFact } from "../../target-model/records/objects/value-projections.js";
import type { RustCallableParameterAdapter, RustCallableValueAdapter } from "../../target-model/records/callables/callable-adapters.js";

export function analyzeRustProjectUnionMappings(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustProjectUnionMappingProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const relation = rustProjectUnionUpcastRelation(program.projectTypes);
  const missing = (node: Node, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node, message });
  };
  const compose = (node: Node, conversion: RustProjectUnionMapConversion, source: TargetTypeRef, target: TargetTypeRef,
    upstream: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }> | undefined): void => {
    if (!rustProjectUnionMapConversionMatches(conversion, source, target, program.typeDefinitions, relation)) {
      missing(node, "Project union conversion requires its exact finalized native carrier and arm correspondence.");
      return;
    }
    for (const before of upstream === undefined ? [undefined] : [undefined, upstream]) {
      if (producer.records.projectUnionMapping.get(conversion, before) !== undefined) continue;
      if (before !== undefined && (!isClosedMetadata(before) ||
        !rustTargetTypeRefEquals(rustOptionElementCarrier(before.sourceCarrier) ?? before.sourceCarrier, before.dispatchCarrier) ||
        !rustFlowReadProjectionMatches(before, program.projectTypes, program.typeDefinitions))) {
        missing(node, "Project union conversion requires its exact preceding flow projection.");
        continue;
      }
      const mapping = selectRustUnionMappingEmission(before?.dispatchCarrier ?? source, target,
        conversion.arms.map(({ upcast: _upcast, ...arm }) => arm), before === undefined ? "source" : "target",
        before !== undefined && rustOptionElementCarrier(before.sourceCarrier) !== undefined, false, program.typeDefinitions,
        (source, target) => relation(source, target) === "related", before === undefined ? undefined : { carrier: source, arms: before.arms });
      if (mapping === undefined || mapping.arms.length !== conversion.arms.length) {
        missing(node, "Project union conversion requires exact composed native arm and absence correspondence.");
        continue;
      }
      producer.publish(node, conversion, before, { mapping, upcasts: Object.freeze(conversion.arms.map(arm => arm.upcast)) });
    }
  };
  // Callable adapters (parameter adapters, class-value callables, object-literal contract methods) apply the same project union conversion as a
  // contextual conversion; their composition is sealed by the same decision.
  const adapter = (node: Node, selected: RustCallableValueAdapter | undefined, depth = 0): void => {
    if (selected === undefined || depth > 128) return;
    if (selected.kind === "option-some" || selected.kind === "option-map") adapter(node, selected.element, depth + 1);
    else if (selected.kind === "conversion" && selected.conversion.kind === "project-union-map")
      compose(node, selected.conversion, selected.upcast?.targetCarrier ?? selected.sourceCarrier, selected.targetCarrier, undefined);
  };
  const callable = (node: Node, selected: { readonly resultAdapter: RustCallableValueAdapter;
    readonly parameterAdapters: readonly RustCallableParameterAdapter[] }): void => {
    adapter(node, selected.resultAdapter);
    for (const parameter of selected.parameterAdapters) {
      if (parameter.kind === "rest") for (const segment of parameter.segments) adapter(node, segment.adapter);
      else if (parameter.kind === "rest-element") { adapter(node, parameter.adapter); adapter(node, parameter.optionalAdapter); }
      else if (parameter.kind !== "omitted") adapter(node, parameter.adapter);
    }
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const contextual = program.records.contextualValueConversion.get(node);
    if (contextual?.conversion.kind === "project-union-map") {
      const flow = program.records.flowReadProjection.get(node);
      const upstream = flow?.kind === "union-map" && rustTargetTypeRefEquals(flow.selectedCarrier, contextual.sourceCarrier) ? flow : undefined;
      compose(node, contextual.conversion, contextual.sourceCarrier, contextual.targetCarrier, upstream);
    }
    const classValue = program.records.classValue.get(node);
    const view = classValue === undefined ? undefined
      : program.classValues.viewFor(classValue.declaration, classValue.sourceCarrier, classValue.carrier);
    for (const selected of [view?.construction, ...(view?.fields.map(field => field.callable) ?? [])])
      if (selected !== undefined) callable(node, selected);
    for (const dispatch of program.records.objectLiteralMethodAdapter.get(node)?.dispatches ?? []) callable(node, dispatch);
  }
  for (const definition of program.projectTypes.definitions)
    for (const selected of program.records.projectCallableAdapters.get(definition.declaration) ?? []) callable(definition.declaration, selected);
  for (const view of program.classValues.constructorViewImplementations)
    for (const selected of [view.construction, ...view.fields.map(field => field.callable)])
      if (selected !== undefined) callable(view.declaration, selected);
  return Object.freeze(issues);
}
