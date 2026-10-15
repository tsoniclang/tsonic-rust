import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type {
  RustCallableParameterAbi,
  RustCallableParameterAdapter,
  RustCallableValueAdapter,
} from "../../target-model/records/callable-adapters.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { projectGenericSubstitutions } from "../../policy/types/project/generic-substitutions.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectStructuralViewImplementation } from "./project-structural-views.js";
import type { RustStructuralShapeRequest, RustStructuralShapeRequestContext } from "./structural-shape-plan.js";

export interface RustStructuralViewRequestInput {
  readonly views: readonly RustProjectStructuralViewImplementation[];
  readonly projectTypes: Pick<RustProjectTypePolicy, "definitionForDeclaration">;
  readonly representations: Pick<RustObjectRepresentationPlan, "representationFor">;
}

export function rustStructuralViewRequests(input: RustStructuralViewRequestInput): readonly RustStructuralShapeRequest[] {
  const requests: RustStructuralShapeRequest[] = [];
  for (const view of input.views) {
    const representation = input.representations.representationFor(input.projectTypes.definitionForDeclaration(view.declaration));
    if (representation === undefined) continue;
    const substitutions = projectGenericSubstitutions(representation.definition,
      rustSourceTypeCarrierValue(view.sourceCarrier)?.genericArguments);
    if (substitutions === undefined) continue;
    const context: RustStructuralShapeRequestContext = Object.freeze({ types: substitutions.types, lifetimes: substitutions.lifetimes });
    requests.push(Object.freeze({ carrier: view.targetCarrier, context, required: true }));
    for (const carrier of view.fields.flatMap(viewFieldCarriers)) requests.push(Object.freeze({ carrier, context, required: false }));
  }
  return Object.freeze(requests);
}

function viewFieldCarriers(member: RustProjectStructuralViewImplementation["fields"][number]): readonly TargetTypeRef[] {
  const field = member.field;
  const accessor = member.accessor;
  const callable = member.callable;
  return [
    ...(field === undefined ? [] : [field.receiverCarrier, field.resultCarrier,
      ...(field.dispatch === undefined ? [] : [field.dispatch.ownerCarrier])]),
    ...(accessor === undefined ? [] : [accessor.resultCarrier,
      ...(accessor.receiver.kind === "static" ? [accessor.receiver.typeCarrier] : []),
      ...(accessor.read === undefined ? [] : [accessor.read.resultCarrier]),
      ...(accessor.write === undefined ? [] : [accessor.write.valueCarrier]),
      ...(accessor.dispatch === undefined ? [] : [accessor.dispatch.ownerCarrier])]),
    ...(member.readAdapter === undefined ? [] : valueAdapterCarriers(member.readAdapter)),
    ...(callable === undefined ? [] : [callable.carrier, callable.ownerCarrier,
      ...callable.parameters.flatMap(parameterAbiCarriers),
      ...callable.parameterAdapters.flatMap(parameterAdapterCarriers),
      ...valueAdapterCarriers(callable.resultAdapter)]),
  ];
}

function parameterAbiCarriers(abi: RustCallableParameterAbi): readonly TargetTypeRef[] {
  return [abi.valueCarrier, abi.parameterCarrier];
}

function parameterAdapterCarriers(adapter: RustCallableParameterAdapter): readonly TargetTypeRef[] {
  switch (adapter.kind) {
    case "runtime-value":
    case "logical-value":
    case "rest-element":
      return [...parameterAbiCarriers(adapter.source), ...parameterAbiCarriers(adapter.target), ...valueAdapterCarriers(adapter.adapter)];
    case "omitted":
      return parameterAbiCarriers(adapter.target);
    case "rest":
      return [...parameterAbiCarriers(adapter.target), ...adapter.segments.flatMap(segment =>
        [...parameterAbiCarriers(segment.source), ...valueAdapterCarriers(segment.adapter)])];
  }
}

function valueAdapterCarriers(adapter: RustCallableValueAdapter): readonly TargetTypeRef[] {
  return [adapter.sourceCarrier, adapter.targetCarrier,
    ...(adapter.kind === "option-some" || adapter.kind === "option-map" ? valueAdapterCarriers(adapter.element) : [])];
}
