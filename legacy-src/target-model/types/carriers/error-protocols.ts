import type { TargetTypeRef } from "../model.js";
import type { RustTypeDefinitions } from "../source-union-definitions.js";
import { emptyRustTypeDefinitions } from "../source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../equality.js";
import { rustJsErrorTargetType } from "./js.js";
import { rustCarrierSupportsTrait } from "./traits.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier,
  isRustRetainedErrorCarrier, isRustWritableRetainedErrorCarrier } from "./source-error.js";

export function rustCarrierProvidesErrorObservation(
  carrier: TargetTypeRef | undefined, definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  const origin = carrier === undefined ? undefined : definitions.programErrorOrigin(carrier);
  return carrier !== undefined && (rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) ||
    isRustMutableJsErrorCarrier(carrier) || isRustSourceErrorCarrier(carrier) || isRustRetainedErrorCarrier(carrier) ||
    origin?.kind === "project" && origin.sourceError ||
    rustCarrierSupportsTrait(carrier, "tsonic_rust_runtime::ErrorObject", undefined, undefined, definitions));
}

export function rustCarrierProvidesErrorMutation(
  carrier: TargetTypeRef | undefined, definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  const origin = carrier === undefined ? undefined : definitions.programErrorOrigin(carrier);
  return carrier !== undefined && (isRustMutableJsErrorCarrier(carrier) || isRustWritableSourceErrorCarrier(carrier) ||
    isRustWritableRetainedErrorCarrier(carrier) ||
    origin?.kind === "project" && origin.sourceError ||
    rustCarrierSupportsTrait(carrier, "tsonic_rust_runtime::WritableErrorObject", undefined, undefined, definitions));
}
