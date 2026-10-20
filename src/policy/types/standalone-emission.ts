import type { TargetTypeRef, RustTargetGenericArgument } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustNamedTypeCarrierValue, rustFixedArrayCarrierValue, rustBuiltInCarrierDefinitions,
  rustPrimitiveTypeName, isRustNeverCarrier, isRustAbsenceCarrier, rustStringTargetId, rustStrTargetId,
  rustProgramErrorTargetId, rustCallableInputTargetId, rustCallableTargetId } from "../../target-model/types/index.js";
import { rustTargetGenericArgumentEquals } from "../../target-model/types/equality.js";

export function selectRustStandaloneTypeIdentity(carrier: TargetTypeRef): string | undefined {
  const argumentsFor = (values: readonly RustTargetGenericArgument[]): readonly string[] | undefined => {
    const arguments_: string[] = [];
    for (const value of values) {
      const selected = value.kind === "type" ? selectRustStandaloneTypeIdentity(value.type) : closedMetadataKey(value);
      if (selected === undefined) return undefined;
      arguments_.push(selected);
    }
    return arguments_;
  };
  const named = (path: string, arguments_: readonly RustTargetGenericArgument[]): string | undefined => {
    const values = argumentsFor(arguments_);
    return values === undefined ? undefined : closedMetadataKey(["named", path, values]);
  };
  const traitFor = (trait: Extract<TargetTypeRef, { readonly kind: "trait-ref" }>): string | undefined => {
    if (trait.sourceItem !== undefined) return undefined;
    const arguments_ = argumentsFor(trait.genericArguments);
    if (arguments_ === undefined) return undefined;
    const constraints: string[] = [];
    for (const constraint of trait.associatedConstraints) {
      const parameters = argumentsFor(constraint.genericArguments);
      if (parameters === undefined) return undefined;
      if (constraint.kind === "equality") {
        const type = selectRustStandaloneTypeIdentity(constraint.type);
        if (type === undefined) return undefined;
        constraints.push(closedMetadataKey(["equality", constraint.name, parameters, type]));
      } else {
        const traits = constraint.traits.map(traitFor);
        if (traits.some(value => value === undefined)) return undefined;
        constraints.push(closedMetadataKey(["bounds", constraint.name, parameters, traits, constraint.outlives]));
      }
    }
    return closedMetadataKey(["trait", trait.path, arguments_, constraints, trait.lifetimeBinder ?? null]);
  };
  if (isRustNeverCarrier(carrier)) return named("core::convert::Infallible", []);
  if (isRustAbsenceCarrier(carrier)) return closedMetadataKey(["unit"]);
  if (carrier.kind === "source-primitive") {
    const name = rustPrimitiveTypeName(carrier.name);
    return name === undefined ? undefined : closedMetadataKey(["primitive", name]);
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustProgramErrorTargetId || carrier.id === rustCallableInputTargetId || carrier.id === rustCallableTargetId) return undefined;
    if (carrier.id === rustStringTargetId) return closedMetadataKey(["string"]);
    if (carrier.id === rustStrTargetId) return closedMetadataKey(["str"]);
    const path = rustBuiltInCarrierDefinitions[carrier.id]?.renderPath;
    return path === undefined ? undefined : named(path, carrier.genericArguments ?? []);
  }
  const native = rustNamedTypeCarrierValue(carrier);
  if (native !== undefined) {
    let count = native.genericArguments.length;
    const offset = count - native.genericDefaults.length;
    while (count > offset && rustTargetGenericArgumentEquals(native.genericArguments[count - 1], native.genericDefaults[count - 1 - offset])) count--;
    return named(native.path, native.genericArguments.slice(0, count));
  }
  const fixed = rustFixedArrayCarrierValue(carrier);
  if (fixed !== undefined) {
    const element = selectRustStandaloneTypeIdentity(fixed.element);
    return element === undefined ? undefined : closedMetadataKey(["fixed-array", element, fixed.length]);
  }
  switch (carrier.kind) {
    case "array": return named("Vec", [{ kind: "type", type: carrier.element }]);
    case "tuple": {
      const elements = carrier.elements.map(selectRustStandaloneTypeIdentity);
      return elements.some(element => element === undefined) ? undefined : closedMetadataKey(elements.length === 0 ? ["unit"] : ["tuple", elements]);
    }
    case "reference": {
      const element = selectRustStandaloneTypeIdentity(carrier.referent);
      return element === undefined ? undefined : closedMetadataKey(["reference", carrier.mutable, carrier.lifetime ?? null, element]);
    }
    case "slice": {
      const element = selectRustStandaloneTypeIdentity(carrier.element);
      return element === undefined ? undefined : closedMetadataKey(["slice", element]);
    }
    case "pointer": {
      const element = selectRustStandaloneTypeIdentity(carrier.pointee);
      return element === undefined || carrier.mutability !== "const" && carrier.mutability !== "mut" ? undefined
        : closedMetadataKey(["pointer", carrier.mutability, element]);
    }
    case "type-parameter": return closedMetadataKey(["parameter", carrier.identity]);
    case "function-pointer": {
      const parameters = carrier.args.map(selectRustStandaloneTypeIdentity);
      const result = isRustNeverCarrier(carrier.result) ? closedMetadataKey(["never-return"]) : selectRustStandaloneTypeIdentity(carrier.result);
      return parameters.some(parameter => parameter === undefined) || result === undefined ? undefined
        : closedMetadataKey(["function-pointer", parameters, result, carrier.lifetimeBinder ?? null, carrier.abi ?? null, carrier.isUnsafe === true]);
    }
    case "trait-ref": {
      return (carrier.lifetimeBinder?.parameters.length ?? 0) === 0 ? traitFor(carrier) : undefined;
    }
    case "trait-object": {
      const principal = traitFor(carrier.principal);
      const auto = carrier.autoTraits.map(traitFor);
      return principal === undefined || auto.some(trait => trait === undefined) ? undefined
        : closedMetadataKey(["trait-object", principal, auto, carrier.lifetime ?? null]);
    }
    case "associated-type": {
      const owner = selectRustStandaloneTypeIdentity(carrier.owner);
      const trait = carrier.trait === undefined ? null : (carrier.trait.lifetimeBinder?.parameters.length ?? 0) === 0 ? traitFor(carrier.trait) : undefined;
      const arguments_ = argumentsFor(carrier.genericArguments ?? []);
      return owner === undefined || trait === undefined || arguments_ === undefined ? undefined
        : closedMetadataKey(["associated", owner, trait, carrier.name, arguments_]);
    }
    case "closure":
    case "impl-trait":
    case "target-specific": return undefined;
  }
}
