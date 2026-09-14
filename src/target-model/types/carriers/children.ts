import type { RustTargetGenericArgument, TargetTypeRef } from "../model.js";
import { rustFixedArrayCarrierValue, rustNamedTypeCarrierValue } from "./native.js";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "./source-types.js";

export function rustTargetTypeChildren(type: TargetTypeRef): readonly TargetTypeRef[] {
  const arguments_ = (values: readonly RustTargetGenericArgument[] | undefined): readonly TargetTypeRef[] =>
    values?.flatMap(value => value.kind === "type" ? [value.type] : []) ?? [];
  switch (type.kind) {
    case "source-primitive":
    case "type-parameter":
    case "opaque": return [];
    case "target-named": return arguments_(type.genericArguments);
    case "array":
    case "slice": return [type.element];
    case "tuple": return type.elements;
    case "reference": return [type.referent];
    case "pointer": return [type.pointee];
    case "function-pointer":
    case "closure": return [...type.args, type.result];
    case "associated-type": return [type.owner, ...(type.trait === undefined ? [] : [type.trait]), ...arguments_(type.genericArguments)];
    case "trait-ref": return [...arguments_(type.genericArguments), ...type.associatedConstraints.flatMap(constraint => [
      ...arguments_(constraint.genericArguments), ...(constraint.kind === "equality" ? [constraint.type] : constraint.traits),
    ])];
    case "trait-object": return [type.principal, ...type.autoTraits];
    case "impl-trait": return [...type.bounds, ...arguments_(type.captures)];
    case "target-specific": {
      const source = rustSourceTypeCarrierValue(type);
      if (source !== undefined) return arguments_(source.genericArguments);
      const shape = rustStructuralObjectCarrierValue(type);
      if (shape !== undefined) return shape.fields.map(field => field.type);
      const union = rustSourceUnionCarrierValue(type);
      if (union !== undefined) return [...arguments_(union.genericArguments), ...union.variants.map(variant => variant.carrier)];
      const named = rustNamedTypeCarrierValue(type);
      if (named !== undefined) return [...arguments_(named.genericArguments), ...arguments_(named.genericDefaults), ...named.upcasts.map(upcast => upcast.target)];
      const fixed = rustFixedArrayCarrierValue(type);
      return fixed === undefined ? [] : [fixed.element];
    }
  }
}
