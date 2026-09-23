import type { JsOperationRequest, JsOperationSelection } from "./model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { isRustNumberArrayUnion } from "../../../target-model/types/carriers/array-unions.js";
import { rustJsArrayTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustUndefinedTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustSourceValueConversion } from "../../conversions/selection.js";

export function selectRustNumberArrayUnionOperation(request: JsOperationRequest, definitions: RustTypeDefinitions): JsOperationSelection | undefined {
  const number = rustSourcePrimitiveTargetType("float64");
  const argument = request.argumentCarriers?.[0];
  if (request.ownerName === "ArrayConstructor" && request.memberName === "from" && request.operationKind === "call" &&
    request.argumentCarriers?.length === 1 && isRustNumberArrayUnion(argument, definitions) &&
    request.selectedMethodTypeArgumentCarriers?.length === 1 && rustTargetTypeRefEquals(request.selectedMethodTypeArgumentCarriers[0], number)) {
    const resultCarrier = rustJsArrayTargetType(number);
    return { resultCarrier, parameterCarriers: [argument!], fact: {
      kind: "provider-operation", operationId: "rust.js.Array.from.number-array-union", operationKind: "method",
      target: { form: "call", path: "js_abi::number_array_from", argModes: ["ref"] },
      parameterCarriers: [argument!], resultCarrier, isAsync: false, isFallible: false, errorBoundary: "none",
    } };
  }
  if (!isRustNumberArrayUnion(request.receiverCarrier, definitions) ||
    !["Array", "ReadonlyArray", "TypedArray"].includes(request.ownerName)) return undefined;
  if (request.memberName === "length" && request.operationKind === "property") {
    const length = rustSourcePrimitiveTargetType("native-uint");
    return { resultCarrier: length, fact: {
      kind: "provider-operation", operationId: "rust.js.number-array-union.length", operationKind: "property",
      target: { form: "free-call", path: "js_abi::number_array_length", receiverMode: "ref" },
      resultCarrier: length, isAsync: false, isFallible: false, errorBoundary: "none", evaluation: "pure",
    } };
  }
  if (request.memberName !== "index" || request.operationKind !== "indexer" || request.argumentCarriers?.length !== 1 || argument === undefined) return undefined;
  const conversion = rustTargetTypeRefEquals(argument, number) ? undefined : selectRustSourceValueConversion(argument, number, definitions);
  if (!rustTargetTypeRefEquals(argument, number) && conversion === undefined) return undefined;
  const resultCarrier = rustOptionTargetType(number);
  return { resultCarrier, parameterCarriers: [argument], fact: {
    kind: "provider-operation", operationId: "rust.js.number-array-union.index", operationKind: "indexer",
    target: { form: "free-call", path: "js_abi::number_array_get", receiverMode: "ref", argModes: ["value"],
      ...(conversion === undefined ? {} : { argConversions: [conversion] }) },
    parameterCarriers: [argument], resultCarrier, sourceResultCarrier: number, sourceAbsenceCarrier: rustUndefinedTargetType(),
    isAsync: false, isFallible: false, errorBoundary: "none", evaluation: "pure",
  } };
}
