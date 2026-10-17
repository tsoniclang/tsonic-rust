import type { Node } from "@tsonic/tsts";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";
import { rustValueConversionContract, type RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustReadTransferRequirement, type RustOwnershipFlow } from "../ownership/flow.js";
import type { RustReadOwnershipRequirements } from "../ownership/reads.js";
import type { RustGenericRequirement } from "./generic-requirements.js";

export function createRustConversionRequirementCollector(
  input: { readonly typeDefinitions: RustTypeDefinitions; readonly readRequirements: RustReadOwnershipRequirements;
    readonly ownershipFlow: RustOwnershipFlow },
  addUse: (node: Node, carrier: TargetTypeRef, requirements: readonly RustGenericRequirement[]) => string | undefined,
): {
  conversion(node: Node, conversion: RustContextualValueConversion): string | undefined;
  finalized(node: Node, conversion: RustFinalizedValueConversion): string | undefined;
} {
  const requireConversionContract = (node: Node, selected: RustValueConversionContract): string | undefined => {
    const children: RustValueConversionContract[] = [];
    const required: { readonly carrier: TargetTypeRef; readonly requirements: readonly RustGenericRequirement[] }[] = [];
    switch (selected.lowering) {
      case "project-closed-value":
        required.push({ carrier: selected.source, requirements: ["static"] });
        break;
      case "call":
        if (selected.path === "js_abi::js_value_from_closed") required.push({ carrier: selected.source, requirements: ["clone", "static"] });
        else if (/^(rt::TsValue|js_abi::JsValue)::from_(closed|identity|shared_identity|error)$/u.test(selected.path))
          required.push({ carrier: selected.source, requirements: ["static"] });
        break;
      case "rest-sequence":
        required.push(...selected.cloneSources.map(carrier => ({ carrier, requirements: ["clone"] as const })));
        children.push(...selected.elementConversions.flatMap(conversion => conversion === null ? [] : [conversion]));
        break;
      case "js-array-backing":
        required.push({ carrier: selected.element, requirements: ["static"] });
        break;
      case "js-value-from-array":
        required.push({ carrier: selected.element, requirements: ["clone", "static"] });
        children.push(selected.elementConversion);
        break;
      case "closed-value-from-option": children.push(selected.elementConversion); break;
      case "option-map": children.push(selected.element); break;
      case "option-some": if (selected.element !== null) children.push(selected.element); break;
      case "source-union-variant": if (selected.payloadConversion !== null) children.push(selected.payloadConversion); break;
      case "union-fold": children.push(...selected.arms.map(arm => arm.conversion)); break;
      case "js-value-from-structural-to-json": children.push(selected.resultConversion); break;
      case "js-value-from-properties":
      case "js-value-from-structural-object":
        for (const field of selected.fields) {
          required.push({ carrier: field.sourceCarrier, requirements: ["clone"] });
          children.push(field.conversion);
        }
        break;
      case "program-error": {
        const visitRoute = (route: typeof selected.route): string | undefined => {
          if (route.kind === "closed-admission") return requireConversion(node, route.admission);
          for (const arm of route.kind === "union" ? route.arms : []) {
            const error = visitRoute(arm.route);
            if (error !== undefined) return error;
          }
          return undefined;
        };
        const error = visitRoute(selected.route);
        if (error !== undefined) return error;
        break;
      }
    }
    for (const { carrier, requirements } of required) {
      const error = addUse(node, carrier, requirements);
      if (error !== undefined) return error;
    }
    for (const child of children) {
      const error = requireConversionContract(node, child);
      if (error !== undefined) return error;
    }
    return undefined;
  };
  const requireConversion = (node: Node, conversion: RustContextualValueConversion): string | undefined => {
    if (conversion.kind === "provider-record-copy") {
      for (const field of conversion.fields) {
        const error = addUse(node, field.sourceCarrier, ["clone"]) ??
          (field.conversion === undefined ? undefined : requireConversion(node, field.conversion));
        if (error !== undefined) return error;
      }
      return undefined;
    }
    if (conversion.kind === "project-union-map") {
      const projection = input.readRequirements.storageReads.get(node)?.projection;
      const moving = projection?.flowConversionInput === "borrow-unless-moving" &&
        rustReadTransferRequirement(input.ownershipFlow, node) === "transfer";
      if (!moving) for (const arm of conversion.arms) {
        if (arm.source[arm.source.length - 1]?.variant.kind !== "payload") continue;
        const error = addUse(node, arm.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
      return undefined;
    }
    if (conversion.kind === "callable-adapter") {
      for (const value of [...conversion.parameters, conversion.result]) {
        if (value.kind !== "value") continue;
        const error = requireConversion(node, value.conversion);
        if (error !== undefined) return error;
      }
      return undefined;
    }
    if (conversion.kind === "native-trait-object-upcast" || conversion.kind === "reference-reborrow" ||
      conversion.kind === "generic-callable-flow" || conversion.kind === "empty-record" || conversion.kind === "integer-truncation") return undefined;
    const selected = rustValueConversionContract(conversion, input.typeDefinitions);
    return selected === undefined ? "A selected native conversion lost its exact physical requirement contract."
      : requireConversionContract(node, selected);
  };
  const requireFinalizedConversion = (node: Node, conversion: RustFinalizedValueConversion): string | undefined => {
    if (conversion.kind === "identity") return undefined;
    for (const step of conversion.kind === "sequence" ? conversion.steps : [conversion]) {
      const error = requireConversion(node, step.conversion);
      if (error !== undefined) return error;
    }
    return undefined;
  };
  return { conversion: requireConversion, finalized: requireFinalizedConversion };
}
