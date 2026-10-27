import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { rustProgramErrorOwner } from "../../../target-model/types/carriers/program-errors.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType, rustCallableTargetId, rustOptionTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function selectRustStructuralPhysicalDestinations(
  carrier: TargetTypeRef,
  errorForFile: (fileName: string) => TargetTypeRef | undefined,
  methodFor: (carrier: TargetTypeRef, index: number) => TargetTypeRef | undefined,
): TargetTypeRef {
  const children = new Map<TargetTypeRef, TargetTypeRef>();
  const selected = mapRustTargetTypes(carrier, (current, source) => {
    if (source.kind === "type-parameter" && source.optionalStorageValue !== undefined) {
      const payload = children.get(source.optionalStorageValue);
      if (payload === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A structural optional binder requires its one completed original payload.");
      const selected = replaceOptionalPayload(source, payload);
      children.set(source, selected);
      return selected;
    }
    const shape = rustStructuralObjectCarrierValue(current);
    if (shape === undefined) {
      children.set(source, current);
      return current;
    }
    let changed = false;
    const fields = shape.fields.map((field, index) => {
      if (field.method === true) {
        const method = methodFor(source, index);
        if (method === undefined) return field;
        const type = selectRustStructuralPhysicalDestinations(method, errorForFile, methodFor);
        if (rustTargetTypeRefEquals(type, field.type)) return field;
        changed = true;
        return Object.freeze({ ...field, type });
      }
      const element = rustOptionElementCarrier(field.type);
      const value = element ?? field.type;
      if (value.kind !== "target-named" || value.id !== rustCallableTargetId) return field;
      const protocol = rustCallableProtocol(value);
      if (rustProgramErrorOwner(protocol?.error)?.kind !== "logical") return field;
      const error = errorForFile(shape.ownerFileName);
      if (protocol?.lifetime === undefined || error === undefined || rustProgramErrorOwner(error)?.kind !== "physical")
        failTargetAnalysisInvariant("tsonic-rust", "A structural callable destination requires its exact declared component's physical error owner.");
      const selected = rustCallableTargetType(protocol.parameters, protocol.result, protocol.lifetime, error);
      changed = true;
      return Object.freeze({ ...field, type: element === undefined ? selected : replaceOptionalPayload(field.type, selected) });
    });
    const selected = !changed ? current : rustStructuralObjectTargetType(shape.ownerFileName, Object.freeze(fields),
      shape.representation, shape.construction, shape.bases, shape.implementation);
    children.set(source, selected);
    return selected;
  });
  return rustTargetTypeRefEquals(selected, carrier) ? carrier : selected;
}

function replaceOptionalPayload(carrier: TargetTypeRef, payload: TargetTypeRef): TargetTypeRef {
  if (carrier.kind === "type-parameter" && carrier.optionalStorageValue !== undefined)
    return rustTargetTypeRefEquals(carrier.optionalStorageValue, payload) ? carrier : Object.freeze({ ...carrier, optionalStorageValue: payload });
  if (carrier.kind === "target-named" && carrier.id === rustOptionTargetId && carrier.genericArguments?.length === 1) {
    const argument = carrier.genericArguments[0];
    if (argument?.kind === "type") return rustTargetTypeRefEquals(argument.type, payload) ? carrier : Object.freeze({
      ...carrier, genericArguments: Object.freeze([Object.freeze({ ...argument, type: payload })]),
    });
  }
  return failTargetAnalysisInvariant("tsonic-rust", "A structural optional destination requires its exact original native container.");
}
