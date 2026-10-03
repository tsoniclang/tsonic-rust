import { rustValueBlock } from "../../target-ast/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustCarrierHasCloneContract, rustCarrierHasCopyContract } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

type SequenceContract = Extract<RustValueConversionContract, { readonly lowering: "rest-sequence" }>;
type ConvertElement = (contract: RustValueConversionContract, value: RustExpr) => RustExpr | undefined;

export function planRustSequenceValue(
  contract: SequenceContract,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
  convert: ConvertElement,
): RustExpr | undefined {
  const type = rustTypeFromCarrierInContext(contract.target, context);
  if (type === undefined) return undefined;
  if (contract.collection === "tuple" && contract.source.kind === "tuple" && contract.source.elements.length === 0) {
    return { kind: "evaluate-then", discard: "value", effect: source,
      value: { kind: "associated-call", owner: type, method: "new", args: [] } };
  }
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node ?? context.sourceFile, []);
  const name = allocateRustSyntheticName(names, "spread_result");
  const destination: RustExpr = { kind: "path", path: name };
  const effect = planRustSequenceAppend(contract, source, destination, context, node, convert);
  return effect === undefined ? undefined : rustValueBlock([{ name, type, mutable: true, value: { kind: "vec-literal", elements: [] } }], { kind: "evaluate-then", discard: "unit", effect, value: destination });
}

export function planRustSequenceAppend(
  contract: SequenceContract,
  source: RustExpr,
  destination: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
  convert: ConvertElement,
): RustExpr | undefined {
  if (contract.cloneSources.some(carrier => !rustCarrierHasCloneContract(carrier, context))) return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node ?? context.sourceFile, []);
  if (contract.collection === "tuple") {
    if (contract.source.kind !== "tuple") return undefined;
    if (contract.source.elements.length === 0) return { kind: "evaluate-then", discard: "value", effect: source,
      value: { kind: "tuple-literal", elements: [] } };
    const name = allocateRustSyntheticName(names, "spread_tuple");
    let effect: RustExpr = { kind: "tuple-literal", elements: [] };
    for (let index = contract.source.elements.length - 1; index >= 0; index -= 1) {
      const field: RustExpr = { kind: "field", receiver: { kind: "path", path: name }, name: String(index) };
      const selected: RustExpr = rustCarrierHasCopyContract(contract.source.elements[index]!, context)
        ? field : { kind: "method-call", receiver: field, method: "clone", args: [] };
      const conversion = contract.elementConversions[index];
      if (conversion === undefined) return undefined;
      const value = conversion === null ? selected : convert(conversion, selected);
      if (value === undefined) return undefined;
      effect = { kind: "evaluate-then", discard: "unit", effect: {
        kind: "method-call", receiver: destination, method: "push", args: [value],
      }, value: effect };
    }
    return rustValueBlock([{ name, value: source }], effect);
  }
  const sliceName = allocateRustSyntheticName(names, "spread_slice");
  const slice: RustExpr = contract.collection === "js-array" ? { kind: "path", path: sliceName } : source;
  const conversion = contract.elementConversions[0];
  if (conversion === undefined) return undefined;
  let effect: RustExpr;
  if (conversion === null) {
    effect = { kind: "method-call", receiver: destination, method: "extend_from_slice", args: [slice] };
  } else {
    const itemName = allocateRustSyntheticName(names, "spread_value");
    const value = convert(conversion, { kind: "path", path: itemName });
    if (value === undefined) return undefined;
    const iterator: RustExpr = { kind: "method-call", receiver: {
      kind: "method-call", receiver: { kind: "method-call", receiver: slice.kind === "reference" ? slice.expr : slice, method: "iter", args: [] },
      method: "cloned", args: [],
    }, method: "map", args: [{ kind: "closure", params: [{ name: itemName, byRefCopy: false }], body: value }] };
    effect = { kind: "method-call", receiver: destination, method: "extend", args: [iterator] };
  }
  return contract.collection === "js-array" ? { kind: "method-call",
    receiver: source.kind === "reference" ? source.expr : source, method: "with_values",
    args: [{ kind: "closure", params: [{ name: sliceName, byRefCopy: false }], body: effect }],
  } : effect;
}
