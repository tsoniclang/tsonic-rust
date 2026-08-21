import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  rustCarrierSupportsTrait,
  rustFixedArrayCarrierValue,
  rustLocationTargetId,
  rustNamedTypeCarrierValue,
  rustOptionTargetId,
  rustSourceTypeCarrierValue,
  substituteRustTargetTypeParameters,
} from "../../../policy/types/target-types.js";
import type { RustTypeParameter } from "../../target-ast/nodes.js";
import { unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";

export type RustGenericRequirement = "clone" | "default" | "static";

export interface RustGenericRequirementSet {
  readonly declared: ReadonlySet<string>;
  readonly byParameter: Map<string, Set<RustGenericRequirement>>;
}

export function createRustGenericRequirementSet(
  typeParameterNames: readonly string[],
): RustGenericRequirementSet {
  return {
    declared: new Set(typeParameterNames),
    byParameter: new Map(),
  };
}

export function requireRustLocationValueCarrier(
  carrier: TargetTypeRef,
  node: Node,
  context: RustPlanContext,
): boolean {
  return requireRustCarrierRequirements(
    carrier,
    ["clone", "static"],
    node,
    context,
  );
}

export function requireRustDefaultValueCarrier(
  carrier: TargetTypeRef,
  node: Node,
  context: RustPlanContext,
): boolean {
  const selectedCarrier = context.typeParameterSubstitutions === undefined
    ? carrier
    : substituteRustTargetTypeParameters(carrier, context.typeParameterSubstitutions);
  const requirements = context.genericRequirements;
  const supported = rustCarrierSupportsTrait(
    selectedCarrier,
    "core::default::Default",
    (name, traitPath) => {
      if (traitPath !== "core::default::Default" ||
        requirements === undefined || !requirements.declared.has(name)) {
        return false;
      }
      addRequirements(name, new Set(["default"]), requirements);
      return true;
    },
  );
  if (supported) {
    return true;
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.default-value-requirement",
    "defaultValue<T>() requires an exact Rust Default implementation for its selected target carrier.",
  ));
  return false;
}

export function requireRustCarrierRequirements(
  carrier: TargetTypeRef,
  required: readonly RustGenericRequirement[],
  node: Node,
  context: RustPlanContext,
): boolean {
  const requirements = context.genericRequirements;
  if (requirements === undefined || requirements.declared.size === 0 ||
    required.length === 0) {
    return true;
  }
  const result = requireCarrier(
    carrier,
    new Set(required),
    requirements,
  );
  if (result) {
    return true;
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.typed-location-generic-requirement",
    "A generated Rust operation contains a function type parameter behind a carrier whose exact target obligations are not declared by the carrier contract.",
  ));
  return false;
}

export function applyRustGenericRequirements(
  typeParameters: readonly RustTypeParameter[],
  requirements: RustGenericRequirementSet,
): readonly RustTypeParameter[] {
  return typeParameters.map((parameter) => {
    const required = requirements.byParameter.get(parameter.name);
    if (required === undefined || required.size === 0) {
      return parameter;
    }
    return {
      ...parameter,
      bounds: [
        ...(required.has("clone")
          ? [{ kind: "trait" as const, path: "Clone" }]
          : []),
        ...(required.has("default")
          ? [{ kind: "trait" as const, path: "Default" }]
          : []),
        ...(required.has("static")
          ? [{ kind: "lifetime" as const, name: "static" }]
          : []),
      ],
    };
  });
}

function requireCarrier(
  carrier: TargetTypeRef,
  required: ReadonlySet<RustGenericRequirement>,
  requirements: RustGenericRequirementSet,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      if (!requirements.declared.has(carrier.name)) {
        return true;
      }
      addRequirements(carrier.name, required, requirements);
      return true;
    case "array":
      return requireCarrier(
        carrier.element,
        withoutRequirement(required, "default"),
        requirements,
      );
    case "slice":
      return false;
    case "tuple":
      return carrier.elements.every((element) =>
        requireCarrier(element, required, requirements));
    case "target-named": {
      const arguments_ = carrier.typeArguments ?? [];
      if (arguments_.length === 0) {
        return true;
      }
      if (carrier.id === rustOptionTargetId) {
        return arguments_.every((argument) =>
          requireCarrier(argument, withoutRequirement(required, "default"), requirements));
      }
      if (carrier.id === rustLocationTargetId) {
        const nestedRequirements = new Set<RustGenericRequirement>();
        if (required.has("static")) {
          nestedRequirements.add("static");
        }
        return arguments_.every((argument) =>
          requireCarrier(argument, nestedRequirements, requirements));
      }
      return !arguments_.some((argument) =>
        containsDeclaredTypeParameter(argument, requirements.declared));
    }
    case "target-specific": {
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray !== undefined) {
        return requireCarrier(fixedArray.element, required, requirements);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      if (named !== undefined) {
        return !named.typeArguments.some((argument) =>
          containsDeclaredTypeParameter(argument, requirements.declared));
      }
      const sourceType = rustSourceTypeCarrierValue(carrier);
      return sourceType === undefined || !sourceType.typeArguments.some((argument) =>
        containsDeclaredTypeParameter(argument, requirements.declared));
    }
    case "reference":
      if (required.has("default") || required.has("clone") && carrier.mutable ||
        required.has("static") && carrier.lifetime !== "static") {
        return false;
      }
      return !required.has("static") || requireCarrier(
        carrier.referent,
        new Set(["static"]),
        requirements,
      );
    case "pointer":
      return !required.has("default") && (!required.has("static") || requireCarrier(
        carrier.pointee,
        new Set(["static"]),
        requirements,
      ));
    case "function-pointer":
      return !required.has("default") && (!required.has("static") ||
        carrier.args.every((argument) => requireCarrier(
          argument,
          new Set(["static"]),
          requirements,
        )) && requireCarrier(carrier.result, new Set(["static"]), requirements));
    case "closure":
    case "associated-type":
      return !containsDeclaredTypeParameter(carrier, requirements.declared);
    default:
      return true;
  }
}

function withoutRequirement(
  required: ReadonlySet<RustGenericRequirement>,
  omitted: RustGenericRequirement,
): ReadonlySet<RustGenericRequirement> {
  if (!required.has(omitted)) {
    return required;
  }
  const result = new Set(required);
  result.delete(omitted);
  return result;
}

function containsDeclaredTypeParameter(
  carrier: TargetTypeRef,
  declared: ReadonlySet<string>,
): boolean {
  switch (carrier.kind) {
    case "type-parameter":
      return declared.has(carrier.name);
    case "target-named":
      return carrier.typeArguments?.some((argument) =>
        containsDeclaredTypeParameter(argument, declared)) === true;
    case "array":
      return containsDeclaredTypeParameter(carrier.element, declared);
    case "slice":
      return containsDeclaredTypeParameter(carrier.element, declared);
    case "tuple":
      return carrier.elements.some((element) =>
        containsDeclaredTypeParameter(element, declared));
    case "reference":
      return containsDeclaredTypeParameter(carrier.referent, declared);
    case "pointer":
      return containsDeclaredTypeParameter(carrier.pointee, declared);
    case "function-pointer":
      return carrier.args.some((argument) =>
        containsDeclaredTypeParameter(argument, declared)) ||
        containsDeclaredTypeParameter(carrier.result, declared);
    case "closure":
      return carrier.args.some((argument) =>
        containsDeclaredTypeParameter(argument, declared)) ||
        containsDeclaredTypeParameter(carrier.result, declared);
    case "associated-type":
      return containsDeclaredTypeParameter(carrier.owner, declared);
    case "target-specific": {
      const fixedArray = rustFixedArrayCarrierValue(carrier);
      if (fixedArray !== undefined) {
        return containsDeclaredTypeParameter(fixedArray.element, declared);
      }
      const named = rustNamedTypeCarrierValue(carrier);
      return named?.typeArguments.some((argument) =>
        containsDeclaredTypeParameter(argument, declared)) === true;
    }
    default:
      return false;
  }
}

function addRequirements(
  name: string,
  required: ReadonlySet<RustGenericRequirement>,
  requirements: RustGenericRequirementSet,
): void {
  const existing = requirements.byParameter.get(name) ?? new Set();
  for (const requirement of required) {
    existing.add(requirement);
  }
  requirements.byParameter.set(name, existing);
}
