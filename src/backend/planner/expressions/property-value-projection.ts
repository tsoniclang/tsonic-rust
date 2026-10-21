import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueConversionContract } from "../../../target-model/conversions/contracts.js";

import { allocateRustSyntheticName } from "../names/synthetic.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { readRustStoredObjectField } from "../objects/project-storage.js";
import { readRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRole } from "../objects/project-field-dispatch.js";
import { planRustSourceAccessorCall, finishRustSourceAccessorEffect } from "./properties.js";

export function planRustPropertyValueProjection(
  contract: Extract<RustValueConversionContract, { readonly lowering: "js-value-from-properties" }>,
  expression: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
  convert: (conversion: RustValueConversionContract, source: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  if (node === undefined) failRustPlannerInvariant("An admitted native property projection requires its source subject.", context.sourceFile);
  const selected = context.input.program.records.propertyValueProjection.get(node, contract.source);
  if (selected === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted native property projection requires its sealed member reads and native bindings.", node);
  const { projection } = selected;
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "property_source");
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const entries: RustExpr[] = [];
  for (const [index, field] of selected.contract.fields.entries()) {
    const read = projection.reads[index]!;
    let value: RustExpr | undefined;
    if (read.kind === "source-accessor") {
      const selectedRead = read.read;
      const raw = selectedRead === undefined ? undefined
        : planRustSourceAccessorCall(node, read, "read", [], context, receiver);
      value = raw === undefined || selectedRead === undefined ? undefined
        : finishRustSourceAccessorEffect(node, selectedRead.declaration, raw, context,
          context.input.program.records.fallible.get(selectedRead.declaration)?.fallible === true ? "fallible" : "infallible");
    } else if (read.dispatch !== undefined) {
      const plan = read.declaration === undefined ? undefined : context.input.program.records.projectFieldDispatch.get(read.declaration);
      const role = plan === undefined ? undefined : planRustProjectFieldDispatchRole(plan, "read", context);
      value = role === undefined ? undefined : readRustProjectDispatchedField(receiver, read.dispatch.read, role);
    } else {
      value = readRustStoredObjectField(read.storage, contract.source, receiver, read.storageIndex, read.resultCarrier, context, [], true);
    }
    if (value === undefined) return undefined;
    const valueName = allocateRustSyntheticName(context.syntheticNames, "property_value");
    const source: RustExpr = field.presence === "optional" ? { kind: "path", path: valueName } : value;
    const converted = convert(field.conversion, source);
    if (converted === undefined) return undefined;
    const pair: RustExpr = { kind: "tuple-literal", elements: [{ kind: "str-literal", value: field.sourceName }, converted] };
    entries.push(field.presence === "optional" ? { kind: "method-call", receiver: value, method: "map",
      args: [{ kind: "closure", params: [{ name: valueName, byRefCopy: false }], body: pair }] }
      : { kind: "call", path: "Some", args: [pair] });
  }
  registerAliasFromPath(context, "js_abi::js_value_from_optional_pairs");
  return rustValueBlock([{ name: receiverName, value: expression }], { kind: "call", path: "js_abi::js_value_from_optional_pairs",
    genericArguments: [{ kind: "type", type: { kind: "reference", referent: { kind: "str" }, mutable: false } }],
    args: [{ kind: "vec-literal", elements: entries }] });
}
