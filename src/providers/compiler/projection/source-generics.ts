import type {
  RustCompilerAssociatedConstraint,
  RustCompilerConstArgument,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerLifetime,
  RustCompilerTraitDispatch,
  RustCompilerType,
} from "../model/model.js";

export function referencedCallableOwnerGenericParameters(
  ownerParameters: readonly RustCompilerGenericParameter[],
  fn: RustCompilerFunction,
): readonly RustCompilerGenericParameter[] {
  const declared = new Set([
    ...ownerParameters,
    ...fn.genericParameters,
  ].map(genericParameterIdentity));
  const selected = new Set<string>();
  fn.parameters.forEach(({ type }) => visitType(type, selected));
  visitType(fn.result, selected);
  if (fn.receiver?.kind === "custom") visitType(fn.receiver.type, selected);
  if (fn.borrowedResult !== undefined) visitType(fn.borrowedResult.sourceType, selected);
  if (fn.traitDispatch !== undefined) visitTrait(fn.traitDispatch, selected);
  fn.genericParameters.forEach((parameter) =>
    parameterDependencies(parameter, declared).forEach((identity) => selected.add(identity)));
  fn.typeRequirements.forEach((parameter) => {
    selected.add(genericParameterIdentity(parameter));
    parameterDependencies(parameter, declared).forEach((identity) => selected.add(identity));
  });
  if (callableUsesOwnerType(fn)) {
    ownerParameters.forEach((parameter) => selected.add(genericParameterIdentity(parameter)));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const parameter of ownerParameters) {
      if (!selected.has(genericParameterIdentity(parameter))) continue;
      for (const dependency of parameterDependencies(parameter, declared)) {
        if (selected.has(dependency)) continue;
        selected.add(dependency);
        changed = true;
      }
    }
  }
  return Object.freeze(ownerParameters.filter((parameter) =>
    selected.has(genericParameterIdentity(parameter))));
}

function callableUsesOwnerType(fn: RustCompilerFunction): boolean {
  return fn.parameters.some(({ type }) => typeContainsSelf(type)) ||
    typeContainsSelf(fn.result) ||
    (fn.receiver?.kind === "custom" && typeContainsSelf(fn.receiver.type)) ||
    (fn.borrowedResult !== undefined && typeContainsSelf(fn.borrowedResult.sourceType)) ||
    fn.traitDispatch !== undefined ||
    fn.genericParameters.some(genericParameterContainsSelf) ||
    fn.typeRequirements.some(genericParameterContainsSelf);
}

function genericParameterContainsSelf(parameter: RustCompilerGenericParameter): boolean {
  if (parameter.kind === "lifetime") return false;
  if (parameter.kind === "const") return typeContainsSelf(parameter.type);
  return (parameter.defaultType !== undefined && typeContainsSelf(parameter.defaultType)) ||
    parameter.requirements.some((requirement) =>
      typeof requirement !== "string" && traitContainsSelf(requirement.trait));
}

export function sourceCallableGenericParameters(
  ownerParameters: readonly RustCompilerGenericParameter[],
  callableParameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerGenericParameter[] {
  const ordered = orderBySourceDependencies([...ownerParameters, ...callableParameters]);
  return stripDefaultsBeforeRequired(ordered);
}

export function sourceTypeGenericParameters(
  parameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerGenericParameter[] {
  return stripDefaultsBeforeRequired(parameters.map((parameter) =>
    parameter.kind === "type" && parameter.defaultType !== undefined &&
        typeContainsSelf(parameter.defaultType)
      ? withoutGenericDefault(parameter)
      : parameter));
}

function stripDefaultsBeforeRequired(
  parameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerGenericParameter[] {
  let lastRequired = -1;
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    if (!genericParameterHasDefault(parameters[index]!)) {
      lastRequired = index;
      break;
    }
  }
  return Object.freeze(parameters.map((parameter, index) =>
    index >= lastRequired || !genericParameterHasDefault(parameter)
      ? parameter
      : withoutGenericDefault(parameter)));
}

function typeContainsSelf(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "self":
      return true;
    case "unit":
    case "primitive":
    case "generic":
      return false;
    case "tuple":
      return type.elements.some(typeContainsSelf);
    case "array":
    case "slice":
      return typeContainsSelf(type.element);
    case "reference":
    case "raw-pointer":
      return typeContainsSelf(type.target);
    case "function-pointer":
      return type.parameters.some(typeContainsSelf) || typeContainsSelf(type.result);
    case "trait-object":
      return traitContainsSelf(type.principal) || type.autoTraits.some(traitContainsSelf);
    case "opaque":
      return type.bounds.some(traitContainsSelf) ||
        type.captures.some(argumentContainsSelf);
    case "associated-type":
      return typeContainsSelf(type.owner) || traitContainsSelf(type.trait) ||
        type.genericArguments.some(argumentContainsSelf);
    case "path":
      return type.genericArguments.some(argumentContainsSelf);
  }
}

function traitContainsSelf(trait: RustCompilerTraitDispatch): boolean {
  return trait.genericArguments.some(argumentContainsSelf) ||
    trait.associatedConstraints.some((constraint) =>
      constraint.genericArguments.some(argumentContainsSelf) ||
      (constraint.kind === "equality"
        ? typeContainsSelf(constraint.type)
        : constraint.traits.some(traitContainsSelf)));
}

function argumentContainsSelf(argument: RustCompilerGenericArgument): boolean {
  return argument.kind === "type" && typeContainsSelf(argument.type);
}

function orderBySourceDependencies(
  parameters: readonly RustCompilerGenericParameter[],
): readonly RustCompilerGenericParameter[] {
  const identities = new Set(parameters.map(genericParameterIdentity));
  const remaining = parameters.map((parameter) => Object.freeze({
    parameter,
    dependencies: parameterDependencies(parameter, identities),
  }));
  const selected = new Set<string>();
  const ordered: RustCompilerGenericParameter[] = [];
  while (remaining.length > 0) {
    const index = remaining.findIndex(({ dependencies }) =>
      [...dependencies].every((identity) => selected.has(identity)));
    if (index < 0) {
      throw new Error(
        `Rust callable generic constraints contain a source-unrepresentable dependency cycle among ${remaining.map(({ parameter }) => `'${genericParameterName(parameter)}'`).join(", ")}.`,
      );
    }
    const { parameter } = remaining.splice(index, 1)[0]!;
    const identity = genericParameterIdentity(parameter!);
    ordered.push(parameter!);
    selected.add(identity);
  }
  return Object.freeze(ordered);
}

function parameterDependencies(
  parameter: RustCompilerGenericParameter,
  declared: ReadonlySet<string>,
): ReadonlySet<string> {
  const dependencies = new Set<string>();
  if (parameter.kind === "lifetime") {
    parameter.outlives.forEach((lifetime) => visitLifetime(lifetime, dependencies));
  } else if (parameter.kind === "type") {
    parameter.requirements.forEach((requirement) => {
      if (typeof requirement !== "string") visitTrait(requirement.trait, dependencies);
    });
    parameter.outlives.forEach((lifetime) => visitLifetime(lifetime, dependencies));
    if (parameter.defaultType !== undefined) visitType(parameter.defaultType, dependencies);
  } else {
    visitType(parameter.type, dependencies);
    if (parameter.defaultValue !== undefined) visitConst(parameter.defaultValue, dependencies);
  }
  dependencies.delete(genericParameterIdentity(parameter));
  return new Set([...dependencies].filter((identity) => declared.has(identity)));
}

function visitType(type: RustCompilerType, selected: Set<string>): void {
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "self":
      return;
    case "generic":
      selected.add(type.identity.itemId);
      return;
    case "tuple":
      type.elements.forEach((element) => visitType(element, selected));
      return;
    case "array":
      visitType(type.element, selected);
      visitConst(type.length, selected);
      return;
    case "slice":
      visitType(type.element, selected);
      return;
    case "reference":
      visitLifetime(type.lifetime, selected);
      visitType(type.target, selected);
      return;
    case "raw-pointer":
      visitType(type.target, selected);
      return;
    case "function-pointer":
      type.parameters.forEach((parameter) => visitType(parameter, selected));
      visitType(type.result, selected);
      return;
    case "trait-object":
      visitTrait(type.principal, selected);
      type.autoTraits.forEach((trait) => visitTrait(trait, selected));
      visitLifetime(type.lifetime, selected);
      return;
    case "opaque":
      type.bounds.forEach((trait) => visitTrait(trait, selected));
      type.outlives.forEach((lifetime) => visitLifetime(lifetime, selected));
      type.captures.forEach((argument) => visitArgument(argument, selected));
      return;
    case "associated-type":
      visitType(type.owner, selected);
      visitTrait(type.trait, selected);
      type.genericArguments.forEach((argument) => visitArgument(argument, selected));
      return;
    case "path":
      type.genericArguments.forEach((argument) => visitArgument(argument, selected));
  }
}

function visitTrait(trait: RustCompilerTraitDispatch, selected: Set<string>): void {
  trait.genericArguments.forEach((argument) => visitArgument(argument, selected));
  trait.associatedConstraints.forEach((constraint) => visitConstraint(constraint, selected));
}

function visitConstraint(
  constraint: RustCompilerAssociatedConstraint,
  selected: Set<string>,
): void {
  constraint.genericArguments.forEach((argument) => visitArgument(argument, selected));
  if (constraint.kind === "equality") {
    visitType(constraint.type, selected);
    return;
  }
  constraint.traits.forEach((trait) => visitTrait(trait, selected));
  constraint.outlives.forEach((lifetime) => visitLifetime(lifetime, selected));
}

function visitArgument(argument: RustCompilerGenericArgument, selected: Set<string>): void {
  if (argument.kind === "type") visitType(argument.type, selected);
  else if (argument.kind === "lifetime") visitLifetime(argument.lifetime, selected);
  else visitConst(argument.value, selected);
}

function visitLifetime(lifetime: RustCompilerLifetime, selected: Set<string>): void {
  if (lifetime.kind === "parameter") selected.add(lifetime.identity.itemId);
  else if (lifetime.kind === "bound") selected.add(lifetime.identity);
}

function visitConst(value: RustCompilerConstArgument, selected: Set<string>): void {
  if (value.kind === "parameter") selected.add(value.identity.itemId);
}

function genericParameterHasDefault(parameter: RustCompilerGenericParameter): boolean {
  return parameter.kind === "type"
    ? parameter.defaultType !== undefined
    : parameter.kind === "const" && parameter.defaultValue !== undefined;
}

function withoutGenericDefault(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericParameter {
  if (parameter.kind === "type") {
    const { defaultType: _defaultType, ...required } = parameter;
    return Object.freeze(required);
  }
  if (parameter.kind === "const") {
    const { defaultValue: _defaultValue, ...required } = parameter;
    return Object.freeze(required);
  }
  return parameter;
}

function genericParameterIdentity(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime"
    ? parameter.lifetime.kind === "parameter"
      ? parameter.lifetime.identity.itemId
      : parameter.lifetime.identity
    : parameter.identity.itemId;
}

function genericParameterName(parameter: RustCompilerGenericParameter): string {
  return parameter.kind === "lifetime" ? parameter.lifetime.name : parameter.name;
}
