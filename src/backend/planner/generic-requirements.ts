import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustFixedArrayCarrierValue,
  rustLocationTargetId,
  rustNamedTypeCarrierValue,
  rustOptionTargetId,
} from "../../source/rust-target-types.js";
import type { RustTypeParameter } from "../rust-ast/nodes.js";
import { unsupportedConstructDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";

export type RustGenericRequirement = "clone" | "static";

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
      return requireCarrier(carrier.element, required, requirements);
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
          requireCarrier(argument, required, requirements));
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
      return named === undefined || !named.typeArguments.some((argument) =>
        containsDeclaredTypeParameter(argument, requirements.declared));
    }
    case "pointer":
    case "function-pointer":
    case "associated-type":
      return !containsDeclaredTypeParameter(carrier, requirements.declared);
    default:
      return true;
  }
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
    case "tuple":
      return carrier.elements.some((element) =>
        containsDeclaredTypeParameter(element, declared));
    case "pointer":
      return containsDeclaredTypeParameter(carrier.pointee, declared);
    case "function-pointer":
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
