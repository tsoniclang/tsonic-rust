import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustStructuralMethodStorageSelection } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustStructuralShapeLayout } from "./structural-shape-plan.js";
import { instantiateStructuralDefinition } from "../../../policy/types/objects/structural-storage.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier, rustOptionTargetType } from "../../../target-model/types/carriers/optional.js";

export function createRustStructuralMethodDestinationReader(
  selections: ReadonlyMap<RustStructuralShapeLayout, ReadonlyMap<number, RustStructuralMethodStorageSelection>>,
  originFor: (carrier: TargetTypeRef) => RustStructuralShapeLayout | undefined,
  templateFor: (origin: RustStructuralShapeLayout) => RustStructuralShapeLayout | undefined,
): (carrier: TargetTypeRef, index: number) => TargetTypeRef | undefined {
  const templates = new Map<RustStructuralShapeLayout, RustStructuralShapeLayout>();
  const instances = new Map<TargetTypeRef, RustStructuralShapeLayout>();
  const prepare = (template: RustStructuralShapeLayout,
    fields: ReadonlyMap<number, RustStructuralMethodStorageSelection>): RustStructuralShapeLayout => {
    const existing = templates.get(template);
    if (existing !== undefined) return existing;
    const selected = Object.freeze({ ...template, fields: Object.freeze(template.fields.map((field, index) => {
      const method = fields.get(index);
      if (method === undefined) return field;
      if (field.methodPlan === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A selected physical method destination requires its original method field.");
      return Object.freeze({ ...field, methodPlan: Object.freeze({ ...field.methodPlan, carrier: method.carrier }) });
    })) });
    templates.set(template, selected);
    return selected;
  };
  return (carrier, index) => {
    const origin = originFor(carrier);
    const fields = origin === undefined ? undefined : selections.get(origin);
    if (origin === undefined || fields === undefined || !fields.has(index)) return undefined;
    let instance = instances.get(carrier);
    if (instance === undefined) {
      const template = templateFor(origin);
      instance = instantiateStructuralDefinition(prepare(origin, fields), carrier) ??
        (template === undefined || template === origin ? undefined
          : instantiateStructuralDefinition(prepare(template, fields), carrier));
      if (instance === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A selected physical method destination requires its exact original template application.");
      instances.set(carrier, instance);
    }
    const field = instance.fields[index];
    const method = field?.methodPlan;
    if (field === undefined || method === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "A selected physical method destination requires its complete native invocation protocol.");
    const protocol = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(method.carrier) : method.carrier);
    if (protocol === undefined || method.receiver === "included" && protocol.parameters.length === 0)
      failTargetAnalysisInvariant("tsonic-rust", "A selected physical method destination requires its complete native invocation protocol.");
    const parameters = method.receiver === "included" ? protocol.parameters.slice(1) : protocol.parameters;
    const value = rustCallableTargetType(parameters, protocol.result, protocol.lifetime, protocol.error);
    return field.presence === "optional" ? rustOptionTargetType(value) : value;
  };
}
