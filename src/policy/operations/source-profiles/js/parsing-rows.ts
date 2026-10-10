import { rustInt32ToFloat64ValueConversion } from "../../../../target-model/conversions/model.js";
import type { JsCarrierRef, JsOperationRowData } from "./model.js";

interface ParsingRadixForm {
  readonly variant: string;
  readonly path: string;
  readonly carrier?: JsCarrierRef;
  readonly conversion?: typeof rustInt32ToFloat64ValueConversion;
}

const radixForms: readonly ParsingRadixForm[] = [
  { variant: "default", path: "js_abi::number_parse_int" },
  { variant: "float64-radix", path: "js_abi::number_parse_int_radix", carrier: { ref: "float64" } },
  { variant: "int32-radix", path: "js_abi::number_parse_int_radix", carrier: { ref: "int32" },
    conversion: rustInt32ToFloat64ValueConversion },
  { variant: "optional-radix", path: "js_abi::number_parse_int_optional", carrier: { ref: "option-of-float64" } },
];

export const parsingOperationRows: readonly JsOperationRowData[] = (
  [["NumberConstructor", "number"], ["Global", "global"]] as const
).flatMap(([owner, lane]) => radixForms.map(({ variant, path, carrier, conversion }): JsOperationRowData => ({
  owner, member: "parseInt", operationKind: "call", lane, variant,
  shape: {
    op: "operation", evaluation: "pure", operationKind: "method",
    target: {
      form: "call", path, argModes: carrier === undefined ? ["value"] : ["value", "value"],
      ...(conversion === undefined ? {} : { argConversions: [undefined, conversion] }),
    },
    result: { ref: "float64" },
    params: [{ ref: "borrowed-str" }, ...(carrier === undefined ? [] : [carrier])],
  },
})));
