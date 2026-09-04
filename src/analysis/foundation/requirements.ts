import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetGenericArgument,
  RustTargetTypeRef,
} from "../../target-model/types/model.js";
import {
  rustFixedArrayCarrierValue,
  rustBuiltInCarrierRenderPaths,
  rustCallableTargetId,
  rustFutureTargetId,
  rustNamedTypeCarrierValue,
  rustNativeScalarTargetId,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStringTargetId,
  rustStrTargetId,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import {
  maximumRustFoundation,
  type RustFoundation,
} from "../../target-model/foundation/model.js";

export function rustFoundationForCarrier(carrier: RustTargetTypeRef): RustFoundation {
  let foundation: RustFoundation = "core";
  const require = (candidate: RustFoundation): void => {
    foundation = maximumRustFoundation(foundation, candidate);
  };
  const visitArgument = (argument: RustTargetGenericArgument): void => {
    if (argument.kind === "type") visit(argument.type);
  };
  const visit = (current: RustTargetTypeRef): void => {
    switch (current.kind) {
      case "source-primitive":
      case "type-parameter":
        return;
      case "array":
        require("alloc");
        visit(current.element);
        return;
      case "slice":
        visit(current.element);
        return;
      case "tuple":
        current.elements.forEach(visit);
        return;
      case "reference":
        visit(current.referent);
        return;
      case "pointer":
        visit(current.pointee);
        return;
      case "function-pointer":
      case "closure":
        current.args.forEach(visit);
        visit(current.result);
        return;
      case "trait-ref":
        require(rustFoundationForPath(current.path));
        current.genericArguments.forEach(visitArgument);
        current.associatedConstraints.forEach((constraint) => {
          constraint.genericArguments.forEach(visitArgument);
          if (constraint.kind === "equality") visit(constraint.type);
        });
        return;
      case "trait-object":
        visit(current.principal);
        current.autoTraits.forEach(visit);
        return;
      case "impl-trait":
        current.bounds.forEach(visit);
        current.captures.forEach(visitArgument);
        return;
      case "associated-type":
        visit(current.owner);
        if (current.trait !== undefined) visit(current.trait);
        current.genericArguments?.forEach(visitArgument);
        return;
      case "target-named":
        require(rustFoundationForTargetNamedCarrier(current.id));
        current.genericArguments?.forEach(visitArgument);
        return;
      case "opaque":
        require("std");
        return;
      case "target-specific": {
        const fixedArray = rustFixedArrayCarrierValue(current);
        if (fixedArray !== undefined) {
          visit(fixedArray.element);
          return;
        }
        const named = rustNamedTypeCarrierValue(current);
        if (named !== undefined) {
          require(rustFoundationForPath(named.path));
          named.genericArguments.forEach(visitArgument);
          return;
        }
        const sourceType = rustSourceTypeCarrierValue(current);
        if (sourceType !== undefined) {
          sourceType.genericArguments.forEach(visitArgument);
          return;
        }
        const sourceUnion = rustSourceUnionCarrierValue(current);
        if (sourceUnion !== undefined) {
          sourceUnion.variants.forEach((variant) => visit(variant.carrier));
          return;
        }
        const structural = rustStructuralObjectCarrierValue(current);
        if (structural !== undefined) {
          require("alloc");
          structural.fields.forEach((field) => visit(field.type));
          return;
        }
        if (current.name !== "never" && current.name !== "source-nullish") {
          require("std");
        }
        return;
      }
    }
  };
  visit(carrier);
  return foundation;
}

function rustFoundationForTargetNamedCarrier(id: string): RustFoundation {
  const renderedPath = rustBuiltInCarrierRenderPaths[id];
  if (renderedPath !== undefined) {
    return rustFoundationForPath(renderedPath);
  }
  if (id === rustStringTargetId || id === rustCallableTargetId) {
    return "alloc";
  }
  if (id === rustStrTargetId) {
    return "core";
  }
  if (id === rustFutureTargetId || id === rustNativeScalarTargetId) {
    return "core";
  }
  return "std";
}

export function rustFoundationForSelectedCall(
  selection: RustSelectedTargetSignature,
): RustFoundation {
  let foundation = rustFoundationForPath(selection.member.targetName);
  const carriers = [
    selection.sourceSelectedReceiverCarrier,
    selection.sourceCallableCarrier,
    selection.member.returnType,
    ...selection.member.parameters.map((parameter) => parameter.type),
  ];
  for (const carrier of carriers) {
    if (carrier !== undefined) {
      foundation = maximumRustFoundation(
        foundation,
        rustFoundationForCarrier(carrier),
      );
    }
  }
  for (const argument of selection.targetGenericArguments ?? []) {
    if (argument.kind === "type") {
      foundation = maximumRustFoundation(
        foundation,
        rustFoundationForCarrier(argument.type),
      );
    }
  }
  return foundation;
}

export function rustFoundationForSelectedOperation(
  selection: RustSelectedTargetOperation,
): RustFoundation {
  return selection.resultType === undefined
    ? rustFoundationForPath(selection.targetOperation)
    : maximumRustFoundation(
        rustFoundationForPath(selection.targetOperation),
        rustFoundationForCarrier(selection.resultType),
      );
}

export function rustFoundationForPath(path: string): RustFoundation {
  const root = path.split("::", 1)[0] ?? path;
  if (root === "std" || root === "js_abi" || root === "tsonic_rust_js") {
    return "std";
  }
  if (root === "alloc" || root === "String" || root === "Vec" ||
    root === "Box" || root === "Rc" || root === "Arc") {
    return "alloc";
  }
  if (root === "rt" || root === "tsonic_rust_runtime") {
    const exportPath = path.slice(root.length + "::".length);
    return exportPath === "block_on"
      ? "std"
      : runtimeCoreExports.has(exportPath) ? "core" : "alloc";
  }
  return "core";
}

const runtimeCoreExports = new Set([
  "Null",
  "Undefined",
  "bitwise_and",
  "bitwise_not",
  "bitwise_or",
  "bitwise_xor",
  "iter_cloned",
  "iter_copied",
  "left_shift",
  "native_shift_left",
  "native_shift_right",
  "native_unsigned_shift_right",
  "option_coalesce",
  "signed_right_shift",
  "source_number_bitwise_and",
  "source_number_bitwise_or",
  "source_number_bitwise_xor",
  "source_number_shift_left",
  "source_number_shift_right",
  "source_number_unsigned_shift_right",
  "to_int32",
  "to_uint32",
  "unsigned_right_shift",
]);
