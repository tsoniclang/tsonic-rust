import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableInputTargetType, rustCallableProtocol, rustNativeCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";

export function resolveRustCallableInputCarrier(
  subject: SourceStorageSubject,
  logicalCarrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const logical = rustCallableProtocol(logicalCarrier);
  const origins = context.sourceStorage.originsFor(subject);
  if (logical === undefined || origins.kind !== "resolved") return undefined;
  let selected: typeof logical | undefined;
  for (const origin of origins.origins) {
    const declaration = origin.subject.node;
    const exact = origin.subject.kind === "value" && origin.subject.projection.length === 0
      ? options.callableSignatureCarrier(declaration) : undefined;
    const protocol = exact === undefined ? logical : rustCallableProtocol(exact) ?? rustNativeCallableProtocol(exact);
    if (protocol === undefined) return undefined;
    if (protocol.parameters.length !== logical.parameters.length ||
      !rustTargetTypeRefEquals(protocol.result, logical.result) ||
      protocol.parameters.some((parameter, index) => !rustTargetTypeRefEquals(parameter, logical.parameters[index]) &&
        !(parameter.kind === "reference" && !parameter.mutable &&
          rustTargetTypeRefEquals(parameter.referent, logical.parameters[index])))) return undefined;
    if (selected !== undefined && protocol.parameters.some((parameter, index) =>
      !rustTargetTypeRefEquals(parameter, selected!.parameters[index]))) return undefined;
    selected = protocol;
  }
  return rustCallableInputTargetType((selected ?? logical).parameters, logical.result);
}
