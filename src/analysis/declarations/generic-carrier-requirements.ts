import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement } from "./generic-requirements.js";
import { rustCarrierSupportsSourceNumeric } from "../../target-model/types/carriers/source-numeric.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { isRustNeverCarrier, rustCarrierSupportsTrait, rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue, rustSourceTypeCarrierValue, rustTargetGenericTypeArguments,
  rustTargetLifetimeArguments, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

export function classifyCarrierRequirements(
  carrier: TargetTypeRef,
  required: readonly RustGenericRequirement[],
  declared: ReadonlySet<string>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
  associatedSupports: (carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, requirement: RustGenericRequirement) => boolean,
  definitions: RustTypeDefinitions,
): boolean {
  if (isRustNeverCarrier(carrier)) {
    return true;
  }
  for (const requirement of required) {
    if (carrier.kind === "associated-type") {
      if (!associatedSupports(carrier, requirement)) return false;
      continue;
    }
    if (requirement === "source-numeric") {
      if (carrier.kind === "type-parameter") {
        if (!declared.has(carrier.name)) return false;
        byParameter.get(carrier.name)!.add(requirement);
      } else if (!rustCarrierSupportsSourceNumeric(carrier)) return false;
      continue;
    }
    if (requirement === "static") {
      if (!classifyStaticCarrier(carrier, declared, byParameter, associatedSupports)) return false;
      continue;
    }
    const traitPath = requirement === "clone"
      ? "core::clone::Clone"
      : "core::default::Default";
    if (!rustCarrierSupportsTrait(carrier, traitPath, (name, selectedTrait) => {
      if (!declared.has(name) || selectedTrait !== traitPath) return false;
      byParameter.get(name)!.add(requirement);
      return true;
    }, (projection, selectedTrait) => selectedTrait === traitPath && associatedSupports(projection, requirement), definitions)) {
      return false;
    }
  }
  return true;
}


function classifyStaticCarrier(
  carrier: TargetTypeRef,
  declared: ReadonlySet<string>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
  associatedSupports: (carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, requirement: RustGenericRequirement) => boolean,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      if (declared.has(carrier.name)) {
        byParameter.get(carrier.name)!.add("static");
      }
      return true;
    case "array":
      return classifyStaticCarrier(carrier.element, declared, byParameter, associatedSupports);
    case "slice":
      return false;
    case "tuple":
      return carrier.elements.every((element) =>
        classifyStaticCarrier(element, declared, byParameter, associatedSupports));
    case "target-named": {
      if (rustTargetLifetimeArguments(carrier.genericArguments).some((lifetime) =>
        lifetime.kind !== "static")) {
        return false;
      }
      const arguments_ = rustTargetGenericTypeArguments(carrier.genericArguments);
      return arguments_.every((argument) =>
        classifyStaticCarrier(argument, declared, byParameter, associatedSupports));
    }
    case "target-specific": {
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray !== undefined) {
        return classifyStaticCarrier(fixedArray.element, declared, byParameter, associatedSupports);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      if (named !== undefined) {
        if (rustTargetLifetimeArguments(named.genericArguments).some((lifetime) =>
          lifetime.kind !== "static")) return false;
        return rustTargetGenericTypeArguments(named.genericArguments).every((argument) =>
          classifyStaticCarrier(argument, declared, byParameter, associatedSupports));
      }
      const structural = rustStructuralObjectCarrierValue(carrier);
      if (structural !== undefined) return [...structural.bases, ...structural.fields.map(field => field.type),
        ...(structural.construction === undefined ? [] : [structural.construction])].every(type =>
          classifyStaticCarrier(type, declared, byParameter, associatedSupports));
      const sourceType = rustSourceTypeCarrierValue(carrier);
      return sourceType === undefined ||
        rustTargetLifetimeArguments(sourceType.genericArguments).every((lifetime) =>
          lifetime.kind === "static") &&
        rustTargetGenericTypeArguments(sourceType.genericArguments).every((argument) =>
          classifyStaticCarrier(argument, declared, byParameter, associatedSupports));
    }
    case "reference":
      return carrier.lifetime?.kind === "static" &&
        classifyStaticCarrier(carrier.referent, declared, byParameter, associatedSupports);
    case "pointer":
      return classifyStaticCarrier(carrier.pointee, declared, byParameter, associatedSupports);
    case "function-pointer":
      return carrier.args.every((argument) =>
        classifyStaticCarrier(argument, declared, byParameter, associatedSupports)) &&
        classifyStaticCarrier(carrier.result, declared, byParameter, associatedSupports);
    case "trait-object":
      return carrier.lifetime?.kind === "static" &&
        classifyStaticCarrier(carrier.principal, declared, byParameter, associatedSupports) &&
        carrier.autoTraits.every((trait) =>
          classifyStaticCarrier(trait, declared, byParameter, associatedSupports));
    case "impl-trait":
      return carrier.captures.every((capture) => {
        if (capture.kind === "const") return true;
        if (capture.kind === "lifetime") return capture.lifetime.kind === "static";
        return classifyStaticCarrier(capture.type, declared, byParameter, associatedSupports);
      }) &&
        carrier.bounds.every((bound) =>
          classifyStaticCarrier(bound, declared, byParameter, associatedSupports));
    case "closure":
      return !rustTargetTypeParameterNames(carrier).some(name => declared.has(name));
    case "associated-type":
      return associatedSupports(carrier, "static");
    default:
      return true;
  }
}
