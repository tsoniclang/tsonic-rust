import type { Node } from "@tsonic/tsts";
import type { RustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustArrayValueConversion(
  contract: Extract<RustValueConversionContract, { readonly lowering: "js-value-from-array" }>,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
  convert: (contract: RustValueConversionContract, value: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  const element = rustTypeFromCarrierInContext(contract.element, context);
  if (element === undefined) return undefined;
  registerAliasFromPath(context, "js_abi::js_value_from_array");
  registerAliasFromPath(context, "js_abi::JsArrayElement");
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast,
    node ?? context.sourceFile, []);
  const arrayName = allocateRustSyntheticName(names, "array_backing");
  const keyName = allocateRustSyntheticName(names, "array_key");
  const visitorName = allocateRustSyntheticName(names, "array_visitor");
  const valueName = allocateRustSyntheticName(names, "array_element");
  const selectedName = allocateRustSyntheticName(names, "array_selected");
  const pointerArguments: readonly { readonly kind: "type"; readonly type: RustType }[] = [
    { kind: "type", type: element }, { kind: "type", type: { kind: "infer" } },
  ];
  const selected: RustExpr = { kind: "path", path: selectedName };
  const conversion = contract.elementConversion;
  const borrowed = contract.projection !== "owned";
  const projected = borrowed
    ? { kind: "call" as const,
        path: contract.projection === "string" ? "js_abi::JsArrayElement::String" : "js_abi::JsArrayElement::Value",
        args: [selected] }
    : convert(conversion, selected);
  if (projected === undefined) return undefined;
  const invocation: RustExpr = { kind: "invoke", callee: { kind: "path", path: visitorName },
    args: [borrowed ? projected : { kind: "call", path: "js_abi::JsArrayElement::Value",
      args: [{ kind: "reference", expr: projected }] }] };
  const visit: RustStmt = { kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: selectedName }] }, expression: { kind: "path", path: valueName }, whenTrue: { kind: "block", body: { statements: [{ kind: "expr", expr: invocation }] } } } };
  const read: RustExpr = { kind: "method-call", receiver: { kind: "path", path: arrayName },
    method: borrowed ? "with_native_element" : "get_native_element",
    genericArguments: borrowed ? pointerArguments : pointerArguments.slice(0, 1),
    args: [{ kind: "path", path: keyName }, ...(borrowed ? [{ kind: "closure-block" as const, move: false, async: false,
      params: [{ name: valueName }], body: { statements: [visit] } }] : [])] };
  const projection: RustExpr = borrowed
    ? { kind: "closure", params: [{ name: arrayName }, { name: keyName }, { name: visitorName }], body: read }
    : { kind: "closure-block", move: false, async: false, params: [{ name: arrayName }, { name: keyName }, { name: visitorName }],
        body: { statements: [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: selectedName }] }, expression: read, whenTrue: { kind: "block", body: { statements: [{ kind: "expr", expr: invocation }] } } } }] } };
  return { kind: "call", path: "js_abi::js_value_from_array", args: [source, projection] };
}
