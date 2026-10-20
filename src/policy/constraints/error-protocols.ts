import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { emptyRustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustJsErrorTargetType } from "../../target-model/types/carriers/js.js";
import { rustCarrierSupportsTrait } from "./native-traits.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier, isRustRetainedErrorCarrier, isRustWritableRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";

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
