import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableInputTargetType, rustCallableProtocol, rustNativeCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustNativeCallableResultMatches } from "../../ownership/callable-result-contract.js";
import { selectRustParameterEntryConversion } from "../../ownership/parameter-entry-conversion.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustSourceInputLifetime } from "../../ownership/source-input-lifetimes.js";

export function resolveRustCallableInputCarrier(
  subject: SourceStorageSubject,
  logicalCarrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const logical = rustCallableProtocol(logicalCarrier);
  if (logical === undefined) return undefined;
  const borrowed = (protocol: typeof logical): TargetTypeRef => {
    const signature = rustTargetGenericReferences({ kind: "tuple", elements: [...protocol.parameters, protocol.result] });
    const lifetime = signature.hasUnnameableLifetime
      ? undefined : rustSourceInputLifetime(subject.node, context);
    return rustCallableInputTargetType(protocol.parameters, protocol.result, lifetime);
  };
  const origins = context.sourceStorage.closedOriginsFor(subject);
  if (origins.kind === "unresolved") return undefined;
  if (origins.kind === "open" || rustTargetGenericReferences(logicalCarrier).typeIdentities.length > 0)
    return borrowed(logical);
  let selected: typeof logical | undefined;
  for (const origin of origins.origins) {
    const declaration = origin.subject.node;
    const exact = origin.subject.kind === "value" && origin.subject.projection.length === 0
      ? options.callableSignatureCarrier(declaration) : undefined;
    const protocol = exact === undefined ? logical : rustCallableProtocol(exact) ?? rustNativeCallableProtocol(exact);
    if (protocol === undefined) return undefined;
    if (protocol.parameters.length !== logical.parameters.length ||
      !rustNativeCallableResultMatches(protocol.result, logical.result)) return undefined;
    const parameters = protocol.parameters.map((parameter, index) => {
      const input = logical.parameters[index]!;
      return rustTargetTypeRefEquals(parameter, input) || parameter.kind === "reference" && !parameter.mutable &&
        rustTargetTypeRefEquals(parameter.referent, input) ? parameter
        : selectRustParameterEntryConversion(input, parameter, context.typeDefinitions) === undefined ? undefined : input;
    });
    if (parameters.some(parameter => parameter === undefined)) return undefined;
    const adapted = { result: protocol.result, parameters: parameters as readonly TargetTypeRef[] };
    if (selected === undefined) selected = adapted;
    else {
      if (!rustTargetTypeRefEquals(adapted.result, selected.result)) return undefined;
      selected = { result: selected.result, parameters: selected.parameters.map((parameter, index) =>
        rustTargetTypeRefEquals(parameter, adapted.parameters[index]) ? parameter : logical.parameters[index]!) };
    }
  }
  return borrowed(selected ?? logical);
}
