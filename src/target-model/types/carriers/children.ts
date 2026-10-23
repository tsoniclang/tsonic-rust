import type { RustTargetGenericArgument, TargetTypeRef } from "../model.js";
import { rustFixedArrayCarrierValue, rustNamedTypeCarrierValue } from "./native.js";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue, type RustStructuralObjectCarrierValue } from "./source-types.js";
import { rustGenericCallableValue } from "./generic-callables.js";
import { rustFrameCallableValue } from "./frame-callables.js";
import { rustClassConstructorFreeArguments } from "./class-constructors.js";
import { rustProducerErrorReference } from "./producer-errors.js";
import { rustNativeErrorJoinReference } from "../native-error-joins.js";

export type RustTargetTypeChildRole =
  | { readonly kind: "component" }
  | { readonly kind: "structural-field"; readonly index: number; readonly structural: RustStructuralObjectCarrierValue }
  | { readonly kind: "structural-construction"; readonly structural: RustStructuralObjectCarrierValue }
  | { readonly kind: "structural-implementation"; readonly structural: RustStructuralObjectCarrierValue };

export type RustTargetTypeChildSelector = (parent: TargetTypeRef, child: TargetTypeRef, role: RustTargetTypeChildRole) => boolean;

export const rustTargetTypeComponentRole: RustTargetTypeChildRole = Object.freeze({ kind: "component" });

export function rustTargetTypeChildren(type: TargetTypeRef, shouldVisitChild?: RustTargetTypeChildSelector): readonly TargetTypeRef[] {
  const children = targetTypeChildren(type);
  if (shouldVisitChild === undefined) return children;
  const structural = rustStructuralObjectCarrierValue(type);
  return children.filter((child, index) => {
    const fieldIndex = structural === undefined ? -1 : index - structural.bases.length;
    const role: RustTargetTypeChildRole = structural === undefined || fieldIndex < 0 ? rustTargetTypeComponentRole
      : fieldIndex < structural.fields.length ? { kind: "structural-field", index: fieldIndex, structural }
      : structural.construction !== undefined && fieldIndex === structural.fields.length
        ? { kind: "structural-construction", structural } : { kind: "structural-implementation", structural };
    return shouldVisitChild(type, child, role);
  });
}

function targetTypeChildren(type: TargetTypeRef): readonly TargetTypeRef[] {
  const arguments_ = (values: readonly RustTargetGenericArgument[] | undefined): readonly TargetTypeRef[] =>
    values?.flatMap(value => value.kind === "type" ? [value.type] : []) ?? [];
  switch (type.kind) {
    case "source-primitive":
    case "opaque": return [];
    case "type-parameter": return type.optionalStorageValue === undefined ? [] : [type.optionalStorageValue];
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
      const joinedError = rustNativeErrorJoinReference(type);
      if (joinedError !== undefined) return joinedError.errors;
      const producerError = rustProducerErrorReference(type);
      if (producerError !== undefined) return arguments_(producerError.genericArguments);
      const constructorArguments = rustClassConstructorFreeArguments(type);
      if (constructorArguments !== undefined) return arguments_(constructorArguments);
      const callable = rustGenericCallableValue(type);
      if (callable !== undefined) return [...callable.environment,
        ...arguments_(callable.physical?.arguments)];
      const frame = rustFrameCallableValue(type);
      if (frame !== undefined) return [...frame.environment, ...(frame.owner.kind === "class" ? [frame.owner.instance] : [])];
      const source = rustSourceTypeCarrierValue(type);
      if (source !== undefined) return arguments_(source.genericArguments);
      const shape = rustStructuralObjectCarrierValue(type);
      if (shape !== undefined) return [...shape.bases, ...shape.fields.map(field => field.type),
        ...(shape.construction === undefined ? [] : [shape.construction]),
        ...(shape.implementation?.methods ?? []).flatMap(method => arguments_(method.genericArguments))];
      const union = rustSourceUnionCarrierValue(type);
      if (union !== undefined) return [...arguments_(union.genericArguments),
        ...(union.payloads.kind === "physical" ? union.payloads.types : [])];
      const named = rustNamedTypeCarrierValue(type);
      if (named !== undefined) return [...arguments_(named.genericArguments), ...arguments_(named.genericDefaults), ...named.upcasts.map(upcast => upcast.target)];
      const fixed = rustFixedArrayCarrierValue(type);
      return fixed === undefined ? [] : [fixed.element];
    }
  }
}
