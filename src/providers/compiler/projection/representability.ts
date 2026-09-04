import { sourcePrimitiveByRustName } from "./model.js";
import type {
  RustCompilerAssociatedConstraint,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerTraitDispatch,
  RustCompilerType,
} from "../model/model.js";
import type { ProjectionContext } from "./model.js";
import { withProjectionGenericParameters } from "./utilities.js";

export function rustCompilerFunctionHasCarrierContracts(
  fn: RustCompilerFunction,
  context: ProjectionContext,
): boolean {
  const functionContext = withProjectionGenericParameters(context, fn.genericParameters);
  return fn.genericParameters.every((parameter) =>
    genericParameterHasCarrierContracts(parameter, functionContext)) &&
    fn.typeRequirements.every((parameter) =>
      genericParameterHasCarrierContracts(parameter, functionContext)) &&
    (fn.receiver?.kind !== "custom" || typeHasCarrierContracts(fn.receiver.type, functionContext)) &&
    fn.parameters.every(({ type }) => typeHasCarrierContracts(type, functionContext)) &&
    typeHasCarrierContracts(compilerFunctionResult(fn.result).type, functionContext) &&
    (fn.traitDispatch === undefined || traitHasCarrierContracts(fn.traitDispatch, functionContext));
}

export function compilerFunctionResult(type: RustCompilerType): {
  readonly type: RustCompilerType;
  readonly fallible: boolean;
} {
  if (type.kind === "path" && isTsonicResultPath(type)) {
    const argument = type.genericArguments[0];
    if (argument?.kind !== "type") {
      throw new Error("Rust TsonicResult must carry one exact type argument.");
    }
    return { type: argument.type, fallible: true };
  }
  return { type, fallible: false };
}

export function rustCompilerTraitHasCarrierContract(
  trait: RustCompilerTraitDispatch,
  context: ProjectionContext,
): boolean {
  return traitHasCarrierContracts(trait, context);
}

function genericParameterHasCarrierContracts(
  parameter: RustCompilerGenericParameter,
  context: ProjectionContext,
): boolean {
  if (parameter.kind === "lifetime") return true;
  if (parameter.kind === "const") {
    return typeHasCarrierContracts(parameter.type, context);
  }
  return parameter.requirements.every((requirement) =>
    typeof requirement === "string" || traitHasCarrierContracts(requirement.trait, context)) &&
    (parameter.defaultType === undefined || typeHasCarrierContracts(parameter.defaultType, context));
}

function typeHasCarrierContracts(type: RustCompilerType, context: ProjectionContext): boolean {
  switch (type.kind) {
    case "unit":
    case "self":
      return true;
    case "generic":
      return context.genericNames?.has(type.identity.itemId) === true;
    case "primitive":
      return type.name === "str" || type.name === "never" || type.name === "char" ||
        sourcePrimitiveByRustName.has(type.name);
    case "tuple":
      return type.elements.every((element) => typeHasCarrierContracts(element, context));
    case "array":
    case "slice":
      return typeHasCarrierContracts(type.element, context);
    case "reference":
    case "raw-pointer":
      return typeHasCarrierContracts(type.target, context);
    case "function-pointer":
      return type.parameters.every((parameter) => typeHasCarrierContracts(parameter, context)) &&
        typeHasCarrierContracts(type.result, context);
    case "trait-object":
      return traitHasCarrierContracts(type.principal, context) &&
        type.autoTraits.every((trait) => traitHasCarrierContracts(trait, context));
    case "opaque":
      return type.bounds.every((trait) => traitHasCarrierContracts(trait, context)) &&
        type.captures.every((argument) => argumentHasCarrierContracts(argument, context));
    case "associated-type":
      return typeHasCarrierContracts(type.owner, context) &&
        traitHasCarrierContracts(type.trait, context) &&
        type.genericArguments.every((argument) => argumentHasCarrierContracts(argument, context));
    case "path":
      return pathHasCarrierContract(type.identity.canonicalPath, context) &&
        type.genericArguments.every((argument) => argumentHasCarrierContracts(argument, context));
  }
}

function traitHasCarrierContracts(
  trait: RustCompilerTraitDispatch,
  context: ProjectionContext,
): boolean {
  return pathHasCarrierContract(trait.identity.canonicalPath, context) &&
    trait.genericArguments.every((argument) => argumentHasCarrierContracts(argument, context)) &&
    trait.associatedConstraints.every((constraint) =>
      constraintHasCarrierContracts(constraint, context));
}

function constraintHasCarrierContracts(
  constraint: RustCompilerAssociatedConstraint,
  context: ProjectionContext,
): boolean {
  return constraint.genericArguments.every((argument) =>
    argumentHasCarrierContracts(argument, context)) &&
    (constraint.kind === "equality"
      ? typeHasCarrierContracts(constraint.type, context)
      : constraint.traits.every((trait) => traitHasCarrierContracts(trait, context)));
}

function argumentHasCarrierContracts(
  argument: RustCompilerGenericArgument,
  context: ProjectionContext,
): boolean {
  return argument.kind !== "type" || typeHasCarrierContracts(argument.type, context);
}

function pathHasCarrierContract(
  canonicalPath: readonly string[],
  context: ProjectionContext,
): boolean {
  return canonicalPath[0] === context.dependency.crateName ||
    context.standardTypes.has(canonicalPath.join("\0"));
}

function isTsonicResultPath(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): boolean {
  return type.crateName === "tsonic_rust_runtime" &&
    type.modulePath.length === 1 &&
    type.modulePath[0] === "error" &&
    type.name === "TsonicResult" &&
    type.genericArguments.length === 1 &&
    type.genericArguments[0]?.kind === "type";
}
