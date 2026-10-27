import type { RustTargetGenericArgument, RustTargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetOperation, RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";
import {
  rustFixedArrayCarrierValue,
  rustBuiltInCarrierDefinitions,
  rustCallableTargetId,
  rustAbsenceTargetId,
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
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustNativeRootFoundations, rustRuntimeExportFoundations } from "../../target-model/foundation/native-paths.js";

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
        const callable = rustGenericCallableValue(current);
        if (callable !== undefined) {
          require("alloc");
          callable.environment.forEach(visit);
          callable.signature.parameters.forEach(visit);
          visit(callable.signature.result);
          return;
        }
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
          sourceUnion.genericArguments.forEach(visitArgument);
          if (sourceUnion.payloads.kind === "physical") sourceUnion.payloads.types.forEach(visit);
          return;
        }
        const structural = rustStructuralObjectCarrierValue(current);
        if (structural !== undefined) {
          require("alloc");
          structural.fields.forEach((field) => visit(field.type));
          return;
        }
        if (current.name !== "never") require("std");
        return;
      }
    }
  };
  visit(carrier);
  return foundation;
}

function rustFoundationForTargetNamedCarrier(id: string): RustFoundation {
  const renderedPath = rustBuiltInCarrierDefinitions[id]?.renderPath;
  if (renderedPath !== undefined) {
    return rustFoundationForPath(renderedPath);
  }
  if (id === rustStringTargetId || id === rustCallableTargetId) {
    return "alloc";
  }
  if (id === rustAbsenceTargetId || id === rustStrTargetId) {
    return "core";
  }
  if (id === rustFutureTargetId || id === rustNativeScalarTargetId) {
    return "core";
  }
  // A target-named carrier without a built-in definition (for example a provider type) is not known to be no_std.
  return "std";
}

export function rustFoundationForSelectedCall(
  selection: RustSelectedTargetSignature,
): RustFoundation {
  let foundation = rustFoundationForPath(selection.member.targetName);
  const carriers = [
    selection.sourceSelectedOwnerCarrier,
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
  const [root = path, member] = path.split("::", 2);
  const native = Object.prototype.hasOwnProperty.call(rustNativeRootFoundations, root) ? rustNativeRootFoundations[root] : undefined;
  if (native !== undefined) return native;
  if (root === "rt" || root === "tsonic_rust_runtime") {
    const selected = member === undefined || !Object.prototype.hasOwnProperty.call(rustRuntimeExportFoundations, member)
      ? undefined : rustRuntimeExportFoundations[member];
    if (selected === undefined) return failTargetAnalysisInvariant("tsonic-rust",
      "A selected runtime path requires its registered native feature requirement.");
    return selected;
  }
  return "core";
}
