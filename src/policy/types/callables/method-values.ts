import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustCallableProtocol, rustCallableTargetType, rustCallableInputProtocol, rustCallableInputTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustGenericCallableTargetType, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";

export function rebindRustCallableCarrier(
  carrier: TargetTypeRef,
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  options: {
    readonly typeParameters?: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
    readonly environment?: readonly TargetTypeRef[];
  } = {},
): TargetTypeRef | undefined {
  if (typeof options !== "object" || options === null) return undefined;
  const keys = Reflect.ownKeys(options);
  if (keys.some(key => key !== "typeParameters" && key !== "environment") ||
    !hasExactObjectKeys(options, keys as string[]) ||
    options.typeParameters !== undefined && (!isDenseDataArray(options.typeParameters) ||
      options.typeParameters.some(parameter => !isRustTargetTypeRef(parameter) || parameter.kind !== "type-parameter")) ||
    options.environment !== undefined && (!isDenseDataArray(options.environment) ||
      options.environment.some(type => !isRustTargetTypeRef(type)))) return undefined;
  if (!isRustTargetTypeRef(carrier) || !isDenseDataArray(parameters) ||
    parameters.some(parameter => !isRustTargetTypeRef(parameter)) || !isRustTargetTypeRef(result)) return undefined;
  if (carrier.kind === "function-pointer" || carrier.kind === "closure") {
    if (options.environment !== undefined || options.typeParameters !== undefined && options.typeParameters.length !== 0)
      return undefined;
    return snapshotClosedMetadata({ ...carrier, args: parameters, result });
  }
  const generic = rustGenericCallableValue(carrier);
  if (generic !== undefined) return rustGenericCallableTargetType(options.typeParameters ?? generic.signature.typeParameters,
    parameters, result, generic.origin, options.environment ?? generic.environment);
  const frame = rustFrameCallableValue(carrier);
  if (frame !== undefined) {
    if (options.environment !== undefined || options.typeParameters !== undefined && options.typeParameters.length !== 0)
      return undefined;
    const protocol = rustCallableProtocol(carrier);
    if (protocol !== undefined && protocol.parameters.length === parameters.length &&
      protocol.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, parameters[index])) &&
      rustTargetTypeRefEquals(protocol.result, result)) return carrier;
    return rustFrameCallableTargetType(parameters, result, frame.owner, frame.environment);
  }
  return rustCallableProtocol(carrier) === undefined || options.environment !== undefined ||
    options.typeParameters !== undefined && options.typeParameters.length !== 0 ? undefined
    : snapshotClosedMetadata(rustCallableInputProtocol(carrier) === undefined
      ? rustCallableTargetType(parameters, result, rustCallableProtocol(carrier)?.lifetime,
        rustCallableProtocol(carrier)?.error) : rustCallableInputTargetType(parameters, result,
        carrier.kind === "reference" ? carrier.lifetime : undefined));
}
