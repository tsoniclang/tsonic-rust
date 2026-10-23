import type { RustConstArgument, RustGenericArgument, RustTraitReference, RustType, RustTypeBound } from "./nodes.js";

export function qualifyRustReferencePath(source: string, references: ReadonlyMap<string, string>): string {
  const separator = source.indexOf("::");
  if (separator < 0) return source;
  const owner = references.get(source.slice(0, separator));
  return owner === undefined ? source : `${owner}${source.slice(separator)}`;
}

export function qualifyRustReferenceType(source: RustType, references: ReadonlyMap<string, string>): RustType {
  const path = (value: string): string => qualifyRustReferencePath(value, references);
  const constant = (value: RustConstArgument): RustConstArgument => value.kind === "path"
    ? { ...value, path: path(value.path) } : value;
  const trait = (value: RustTraitReference): RustTraitReference => ({ ...value, trait: type(value.trait) });
  const bound = (value: RustTypeBound): RustTypeBound => {
    switch (value.kind) {
      case "trait": return { ...value, path: path(value.path) };
      case "trait-type": return { ...value, reference: trait(value.reference) };
      case "callable": return { ...value, parameters: value.parameters.map(type), result: type(value.result) };
      case "lifetime":
      case "maybe-sized": return value;
    }
  };
  const argument = (value: RustGenericArgument): RustGenericArgument => {
    switch (value.kind) {
      case "lifetime": return value;
      case "type": return { ...value, type: type(value.type) };
      case "const": return { ...value, value: constant(value.value) };
      case "associated-equality": return { ...value,
        genericArguments: value.genericArguments.map(argument), type: type(value.type) };
      case "associated-bounds": return { ...value,
        genericArguments: value.genericArguments.map(argument), bounds: value.bounds.map(bound) };
    }
  };
  const type = (value: RustType): RustType => {
    switch (value.kind) {
      case "named": return { ...value, path: path(value.path),
        ...(value.genericArguments === undefined ? {} : { genericArguments: value.genericArguments.map(argument) }) };
      case "qualified": return { ...value, owner: type(value.owner),
        ...(value.trait === undefined ? {} : { trait: type(value.trait) }),
        ...(value.genericArguments === undefined ? {} : { genericArguments: value.genericArguments.map(argument) }) };
      case "trait-object": return { ...value, principal: trait(value.principal), autoTraits: value.autoTraits.map(trait) };
      case "impl-trait": return { ...value, bounds: value.bounds.map(bound),
        ...(value.captures === undefined ? {} : { captures: value.captures.map(argument) }) };
      case "reference": return { ...value, referent: type(value.referent) };
      case "raw-pointer": return { ...value, pointee: type(value.pointee) };
      case "fixed-array": return { ...value, element: type(value.element), length: constant(value.length) };
      case "slice": return { ...value, element: type(value.element) };
      case "callable-trait":
      case "function-pointer": return { ...value, parameters: value.parameters.map(type), result: type(value.result) };
      case "tuple": return { ...value, elements: value.elements.map(type) };
      case "infer":
      case "primitive":
      case "string":
      case "str":
      case "unit":
      case "never": return value;
    }
  };
  return type(source);
}
