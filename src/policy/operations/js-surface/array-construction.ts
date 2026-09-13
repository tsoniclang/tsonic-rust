import {
  isRustNumericCarrier,
  rustJsArrayTargetType,
  rustJsErrorTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { JsOperationSelection } from "./model.js";

export function selectJsArrayConstruction(
  typeArguments: readonly (TargetTypeRef | undefined)[],
  arguments_: readonly (TargetTypeRef | undefined)[],
  operationKind: "constructor" | "method" = "constructor",
  soleArgumentNumberKind?: "number" | "non-number",
): JsOperationSelection | undefined {
  const element = typeArguments[0];
  if (typeArguments.length !== 1 || element === undefined ||
    arguments_.some(argument => argument === undefined)) {
    return undefined;
  }
  if (arguments_.length === 1 && soleArgumentNumberKind === undefined) return undefined;
  const lengthConstruction = arguments_.length === 1 && soleArgumentNumberKind === "number";
  if (lengthConstruction && !isRustNumericCarrier(arguments_[0])) return undefined;
  if (!lengthConstruction && arguments_.some(argument => !rustTargetTypeRefEquals(argument, element))) {
    return undefined;
  }
  const resultCarrier = rustJsArrayTargetType(element);
  return {
    resultCarrier,
    parameterCarriers: arguments_,
    fact: {
      kind: "provider-operation",
      operationId: `tsonic.rust.js.Array.constructor.${lengthConstruction ? "length" : "items"}`,
      operationKind,
      target: lengthConstruction
        ? { form: "call", path: "js_abi::array_construct_length" }
        : { form: "call-value-array", path: "js_abi::array_of", leadingArguments: [], elementCarrier: element },
      parameterCarriers: arguments_,
      ...(lengthConstruction ? { targetGenericArguments: [{ kind: "type" as const, type: element }] } : {}),
      resultCarrier,
      isAsync: false,
      isFallible: lengthConstruction,
      errorBoundary: lengthConstruction ? "provider-native" : "none",
      ...(lengthConstruction ? { errorCarrier: rustJsErrorTargetType() } : {}),
    },
  };
}
