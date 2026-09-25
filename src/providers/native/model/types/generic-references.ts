import type { RustCompilerGenericArgument, RustCompilerTraitDispatch, RustCompilerType } from "../model.js";

export function compilerTypeGenericIdentities(type: RustCompilerType): ReadonlySet<string> {
  const identities = new Set<string>();
  const argument = (value: RustCompilerGenericArgument): void => {
    if (value.kind === "type") visit(value.type);
  };
  const trait = (value: RustCompilerTraitDispatch): void => {
    value.genericArguments.forEach(argument);
    for (const constraint of value.associatedConstraints) {
      constraint.genericArguments.forEach(argument);
      if (constraint.kind === "equality") visit(constraint.type);
      else constraint.traits.forEach(trait);
    }
  };
  const visit = (value: RustCompilerType): void => {
    switch (value.kind) {
      case "unit": case "primitive": case "self": return;
      case "generic": identities.add(value.identity.itemId); return;
      case "tuple": value.elements.forEach(visit); return;
      case "array": case "slice": visit(value.element); return;
      case "reference": case "raw-pointer": visit(value.target); return;
      case "function-pointer": value.parameters.forEach(visit); visit(value.result); return;
      case "path": value.genericArguments.forEach(argument); return;
      case "associated-type": visit(value.owner); trait(value.trait); value.genericArguments.forEach(argument); return;
      case "trait-object": trait(value.principal); value.autoTraits.forEach(trait); return;
      case "opaque": value.bounds.forEach(trait); value.captures.forEach(argument); return;
    }
  };
  visit(type);
  return identities;
}
