import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { rustPropertyProjectionFactKey } from "../../../analysis/facts/property-projections.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput, registerAliasFromPath } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
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
  const fact = node === undefined ? undefined : context.input.program.facts.getFact(node, rustPropertyProjectionFactKey);
  const candidates = fact?.cases.filter(projection => rustTargetTypeRefEquals(projection.source, contract.source));
  const projection = candidates?.length === 1 ? candidates[0] : undefined;
  const selected = projection === undefined ? undefined : rustValueConversionContract(projection.conversion, context.input.program.typeDefinitions);
  if (node === undefined || projection === undefined || selected === undefined ||
    !closedMetadataEquals(selected, contract) || projection.reads.length !== contract.fields.length || context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.property-projection", "Native property projection requires its exact sealed selected-parameter member reads."));
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "property_source");
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const entries: RustExpr[] = [];
  for (const [index, field] of contract.fields.entries()) {
    const read = projection.reads[index]!;
    const readCarrier = field.presence === "optional" ? rustOptionElementCarrier(read.resultCarrier) : read.resultCarrier;
    if (readCarrier === undefined || !rustTargetTypeRefEquals(readCarrier, field.sourceCarrier) ||
      read.kind === "source-field" && !rustTargetTypeRefEquals(read.receiverCarrier, contract.source) ||
      read.kind === "source-accessor" && (read.receiver.kind !== "instance" || read.read === undefined ||
        !rustTargetTypeRefEquals(read.read.resultCarrier, read.resultCarrier))) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.property-projection-member", "Selected native property read conflicts with its exact projection carrier."));
      return undefined;
    }
    let value: RustExpr | undefined;
    if (read.kind === "source-accessor") {
      const selectedRead = read.read;
      const raw = selectedRead === undefined ? undefined
        : planRustSourceAccessorCall(node, read, "read", [], context, receiver, contract.source);
      value = raw === undefined || selectedRead === undefined ? undefined
        : finishRustSourceAccessorEffect(node, selectedRead.declaration, raw, context,
          context.input.program.facts.getFact(selectedRead.declaration, rustFallibleFactKey)?.fallible === true ? "fallible" : "infallible");
    } else if (read.dispatch !== undefined) {
      const plan = read.declaration === undefined ? undefined : context.input.program.projectFieldDispatch.planFor(read.declaration);
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
