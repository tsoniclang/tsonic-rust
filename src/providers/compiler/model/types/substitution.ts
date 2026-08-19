import {
  hasInnerKind,
  isRecord,
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import { normalizeTraitDispatch, normalizeTypeParameters } from "./normalization.js";
import type { RustCompilerType, RustCompilerTypeRequirement } from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function normalizeType(
  document: RustdocDocument,
  raw: unknown,
  resolvingAliases: ReadonlySet<string> = new Set(),
): RustCompilerType {
  const type = requireRecord(raw, "Rust type");
  if (typeof type.primitive === "string") {
    return Object.freeze({ kind: "primitive", name: type.primitive });
  }
  if (typeof type.generic === "string") {
    return Object.freeze(type.generic === "Self"
      ? { kind: "self" as const }
      : { kind: "generic" as const, name: type.generic });
  }
  if (Array.isArray(type.tuple)) {
    return Object.freeze({ kind: "tuple", elements: Object.freeze(type.tuple.map((element) => normalizeType(document, element, resolvingAliases))) });
  }
  if (type.slice !== undefined) {
    return Object.freeze({ kind: "slice", element: normalizeType(document, type.slice, resolvingAliases) });
  }
  if (isRecord(type.array)) {
    const length = Number(type.array.len);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`Rust array length '${String(type.array.len)}' is not a non-negative integer.`);
    }
    return Object.freeze({ kind: "array", element: normalizeType(document, type.array.type, resolvingAliases), length });
  }
  if (isRecord(type.borrowed_ref)) {
    const lifetime = type.borrowed_ref.lifetime;
    if (lifetime !== null && typeof lifetime !== "string") {
      throw new Error("Rust reference lifetime has no stable rustdoc representation.");
    }
    return Object.freeze({
      kind: "reference",
      mutable: type.borrowed_ref.is_mutable === true,
      ...(lifetime === null ? {} : { lifetime }),
      target: normalizeType(document, type.borrowed_ref.type, resolvingAliases),
    });
  }
  if (isRecord(type.raw_pointer)) {
    return Object.freeze({
      kind: "raw-pointer",
      mutable: type.raw_pointer.is_mutable === true,
      target: normalizeType(document, type.raw_pointer.type, resolvingAliases),
    });
  }
  if (isRecord(type.function_pointer)) {
    const signature = requireRecord(type.function_pointer.sig, "Rust function pointer signature");
    if (signature.is_c_variadic !== false) {
      throw new Error("Variadic Rust function-pointer types have no closed source signature.");
    }
    const genericParameters = requireArray(
      type.function_pointer.generic_params,
      "Rust function pointer generic parameters",
    );
    if (genericParameters.length !== 0) {
      throw new Error("Generic Rust function-pointer types have no closed source signature.");
    }
    const header = requireRecord(
      type.function_pointer.header,
      "Rust function pointer header",
    );
    const inputs = requireArray(signature.inputs, "Rust function pointer inputs").map(
      (input, index) => {
        if (!Array.isArray(input) || input.length !== 2) {
          throw new Error(`Rust function pointer input ${index} has an invalid rustdoc shape.`);
        }
        return normalizeType(document, input[1], resolvingAliases);
      },
    );
    return Object.freeze({
      kind: "function-pointer",
      parameters: Object.freeze(inputs),
      result: signature.output === null
        ? Object.freeze({ kind: "unit" as const })
        : normalizeType(document, signature.output, resolvingAliases),
      abi: normalizeAbi(header.abi, "Rust function pointer ABI"),
      unsafe: requireBoolean(
        header.is_unsafe,
        "Rust function pointer safety",
      ),
    });
  }
  if (isRecord(type.qualified_path)) {
    const qualified = type.qualified_path;
    const associatedArguments = normalizePathArguments(
      document,
      qualified.args,
      resolvingAliases,
    );
    if (associatedArguments.length !== 0) {
      throw new Error("Generic associated Rust types have no closed provider type contract.");
    }
    return Object.freeze({
      kind: "associated-type",
      owner: normalizeType(document, qualified.self_type, resolvingAliases),
      trait: normalizeTraitDispatch(document, qualified.trait, resolvingAliases),
      name: requireString(qualified.name, "Rust associated type name"),
    });
  }
  if (isRecord(type.resolved_path)) {
    const id = String(type.resolved_path.id);
    const pathRecord = requireRecord(document.paths[id], `Rust resolved path '${id}'`);
    const path = requireArray(pathRecord.path, `Rust resolved path '${id}' segments`);
    if (path.some((segment) => typeof segment !== "string") || path.length < 2) {
      throw new Error(`Rust resolved path '${id}' has no canonical crate-qualified path.`);
    }
    const args = normalizePathArguments(document, type.resolved_path.args, resolvingAliases);
    const resolvedItem = document.index[id];
    if (isRecord(resolvedItem) && hasInnerKind(resolvedItem, "type_alias")) {
      if (resolvingAliases.has(id)) {
        throw new Error(`Rust type alias '${id}' is recursively referenced while computing its canonical target type.`);
      }
      const alias = requireInnerRecord(resolvedItem, "type_alias", `Rust type alias '${id}'`);
      const generics = requireRecord(alias.generics, `Rust type alias '${id}' generics`);
      const parameters = normalizeTypeParameters(document, generics);
      if (parameters.length !== args.length) {
        throw new Error(`Rust type alias '${id}' received ${args.length} type arguments for ${parameters.length} parameters.`);
      }
      const nextResolving = new Set(resolvingAliases);
      nextResolving.add(id);
      const target = normalizeType(document, alias.type, nextResolving);
      return substituteRustCompilerType(
        target,
        new Map(parameters.map((parameter, index) => [parameter.name, args[index]!])),
      );
    }
    return Object.freeze({
      kind: "path",
      crateName: path[0] as string,
      modulePath: Object.freeze((path.slice(1, -1) as string[])),
      name: path[path.length - 1] as string,
      typeArguments: args,
    });
  }
  throw new Error(`Rust type has no supported closed representation.`);
}


export function normalizePathArguments(
  document: RustdocDocument,
  raw: unknown,
  resolvingAliases: ReadonlySet<string>,
): readonly RustCompilerType[] {
  if (raw === null || raw === undefined) {
    return Object.freeze([]);
  }
  const args = requireRecord(raw, "Rust path arguments");
  const angle = isRecord(args.angle_bracketed) ? args.angle_bracketed : undefined;
  if (angle === undefined) {
    throw new Error(`Rust parenthesized path arguments are not supported.`);
  }
  const result: RustCompilerType[] = [];
  for (const rawArgument of requireArray(angle.args, "Rust path type arguments")) {
    const argument = requireRecord(rawArgument, "Rust path type argument");
    if (argument.type === undefined) {
      throw new Error(`Rust lifetime and const path arguments are not supported.`);
    }
    result.push(normalizeType(document, argument.type, resolvingAliases));
  }
  if (requireArray(angle.constraints, "Rust path associated constraints").length > 0) {
    throw new Error(`Rust associated type constraints are not supported.`);
  }
  return Object.freeze(result);
}


export function substituteRustCompilerType(
  type: RustCompilerType,
  bindings: ReadonlyMap<string, RustCompilerType>,
): RustCompilerType {
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "self":
      return type;
    case "generic":
      return bindings.get(type.name) ?? type;
    case "tuple":
      return Object.freeze({
        kind: "tuple",
        elements: Object.freeze(type.elements.map((element) => substituteRustCompilerType(element, bindings))),
      });
    case "array":
      return Object.freeze({
        kind: "array",
        element: substituteRustCompilerType(type.element, bindings),
        length: type.length,
      });
    case "slice":
      return Object.freeze({
        kind: "slice",
        element: substituteRustCompilerType(type.element, bindings),
      });
    case "reference":
    case "raw-pointer":
      return Object.freeze({
        kind: type.kind,
        mutable: type.mutable,
        ...(type.kind === "reference" && type.lifetime !== undefined
          ? { lifetime: type.lifetime }
          : {}),
        target: substituteRustCompilerType(type.target, bindings),
      });
    case "function-pointer":
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) =>
          substituteRustCompilerType(parameter, bindings))),
        result: substituteRustCompilerType(type.result, bindings),
      });
    case "path":
      return Object.freeze({
        ...type,
        typeArguments: Object.freeze(type.typeArguments.map((argument) =>
          substituteRustCompilerType(argument, bindings))),
      });
    case "associated-type":
      return Object.freeze({
        ...type,
        owner: substituteRustCompilerType(type.owner, bindings),
        trait: Object.freeze({
          ...type.trait,
          typeArguments: Object.freeze(type.trait.typeArguments.map((argument) =>
            substituteRustCompilerType(argument, bindings))),
        }),
      });
  }
}


export function rustStaticValueCanBeCopied(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "raw-pointer":
    case "function-pointer":
      return type.kind !== "primitive" || type.name !== "str";
    case "tuple":
      return type.elements.every(rustStaticValueCanBeCopied);
    case "array":
      return rustStaticValueCanBeCopied(type.element);
    case "reference":
      return type.mutable === false;
    case "generic":
    case "self":
    case "associated-type":
    case "slice":
    case "path":
      return false;
  }
}


export function typeRequirementKey(requirement: RustCompilerTypeRequirement): string {
  return typeof requirement === "string" ? requirement : `trait:${requirement.path}`;
}
