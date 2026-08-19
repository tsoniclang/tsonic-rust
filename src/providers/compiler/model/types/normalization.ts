import {
  compareText,
  isRecord,
  requireArray,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import { normalizePathArguments, normalizeType, typeRequirementKey } from "./substitution.js";
import type {
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function standardTypePathKind(value: unknown): boolean {
  return value === "struct" || value === "enum" || value === "union" || value === "type_alias";
}


export function canonicalCompilerTypePathKey(
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): string {
  return canonicalPathKey([type.crateName, ...type.modulePath, type.name]);
}


export function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}


export function normalizeTraitDispatch(
  document: RustdocDocument,
  raw: unknown,
  resolvingAliases: ReadonlySet<string> = new Set(),
): RustCompilerTraitDispatch {
  const trait = requireRecord(raw, "Rust trait reference");
  const pathRecord = requireRecord(
    document.paths[String(trait.id)],
    `Rust trait reference '${String(trait.id)}'`,
  );
  const path = requireArray(pathRecord.path, "Rust trait path");
  if (pathRecord.kind !== "trait" || path.length < 2 ||
    path.some((segment) => typeof segment !== "string")) {
    throw new Error(`Rust trait reference '${String(trait.id)}' has no canonical crate-qualified identity.`);
  }
  return Object.freeze({
    path: (path as string[]).join("::"),
    typeArguments: normalizePathArguments(document, trait.args, resolvingAliases),
  });
}


export function normalizeTypeParameters(
  document: RustdocDocument,
  generics: Readonly<Record<string, unknown>>,
): readonly RustCompilerTypeParameter[] {
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  const defaults = new Map<string, RustCompilerType>();
  const names: string[] = [];
  for (const raw of requireArray(generics.params, "Rust generic parameters")) {
    const parameter = requireRecord(raw, "Rust generic parameter");
    const kind = requireRecord(parameter.kind, "Rust generic parameter kind");
    if (!isRecord(kind.type)) {
      throw new Error(`Rust lifetime and const generic parameters are not representable by the current source contract.`);
    }
    const name = requireString(parameter.name, "Rust type parameter name");
    if (names.includes(name) || kind.type.is_synthetic !== false) {
      throw new Error(`Rust type parameter '${name}' has an unsupported duplicate or synthetic contract.`);
    }
    names.push(name);
    if (kind.type.default !== null && kind.type.default !== undefined) {
      defaults.set(name, normalizeType(document, kind.type.default));
    }
    addNormalizedBounds(
      document,
      requireArray(kind.type.bounds, `Rust type parameter '${name}' bounds`),
      name,
      requirements,
    );
  }
  for (const rawPredicate of requireArray(generics.where_predicates, "Rust generic where predicates")) {
    const predicate = requireRecord(rawPredicate, "Rust generic where predicate");
    const bounded = isRecord(predicate.bound_predicate)
      ? predicate.bound_predicate
      : undefined;
    if (bounded === undefined || requireArray(
      bounded.generic_params,
      "Rust generic where predicate parameters",
    ).length !== 0) {
      throw new Error("Rust lifetime, equality, and higher-ranked where predicates are not representable by the current provider contract.");
    }
    const type = requireRecord(bounded.type, "Rust generic where predicate type");
    const name = typeof type.generic === "string" ? type.generic : undefined;
    if (name === undefined || !names.includes(name)) {
      throw new Error("Rust where predicates must constrain one declared type parameter directly.");
    }
    addNormalizedBounds(
      document,
      requireArray(bounded.bounds, `Rust where predicate '${name}' bounds`),
      name,
      requirements,
    );
  }
  return Object.freeze(names.map((name) => Object.freeze({
    name,
    requirements: Object.freeze([...requirements.get(name)?.entries() ?? []]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, requirement]) => requirement)),
    ...(defaults.has(name) ? { defaultType: defaults.get(name)! } : {}),
  })));
}


export function normalizeTypeParameterShape(
  document: RustdocDocument,
  generics: Readonly<Record<string, unknown>>,
): readonly RustCompilerTypeParameter[] {
  const names = new Set<string>();
  return Object.freeze(requireArray(generics.params, "Rust generic parameters").map((raw) => {
    const parameter = requireRecord(raw, "Rust generic parameter");
    const kind = requireRecord(parameter.kind, "Rust generic parameter kind");
    if (!isRecord(kind.type)) {
      throw new Error("Rust lifetime and const generic parameters are not representable by the current source contract.");
    }
    const name = requireString(parameter.name, "Rust type parameter name");
    if (names.has(name) || kind.type.is_synthetic !== false) {
      throw new Error(`Rust type parameter '${name}' has an unsupported duplicate or synthetic contract.`);
    }
    names.add(name);
    return Object.freeze({
      name,
      requirements: Object.freeze([]),
      ...(kind.type.default === null || kind.type.default === undefined
        ? {}
        : { defaultType: normalizeType(document, kind.type.default) }),
    });
  }));
}


export function sourceVisibleTypeParameterCount(
  parameters: readonly RustCompilerTypeParameter[],
): number {
  const firstDefault = parameters.findIndex((parameter) => parameter.defaultType !== undefined);
  if (firstDefault < 0) {
    return parameters.length;
  }
  if (parameters.slice(firstDefault).some((parameter) => parameter.defaultType === undefined)) {
    throw new Error("Rust default type parameters must form one trailing source-omittable suffix.");
  }
  return firstDefault;
}


function addNormalizedBounds(
  document: RustdocDocument,
  bounds: readonly unknown[],
  parameterName: string,
  requirements: Map<string, Map<string, RustCompilerTypeRequirement>>,
): void {
  const selected = requirements.get(parameterName) ?? new Map<string, RustCompilerTypeRequirement>();
  requirements.set(parameterName, selected);
  for (const rawBound of bounds) {
    const bound = requireRecord(rawBound, `Rust type parameter '${parameterName}' bound`);
    const traitBound = isRecord(bound.trait_bound) ? bound.trait_bound : undefined;
    if (traitBound === undefined ||
      requireArray(traitBound.generic_params, `Rust type parameter '${parameterName}' higher-ranked bounds`).length !== 0) {
      throw new Error(`Rust type parameter '${parameterName}' has a non-trait, lifetime, or higher-ranked bound that is not representable.`);
    }
    const trait = requireRecord(traitBound.trait, `Rust type parameter '${parameterName}' trait bound`);
    if (trait.args !== null) {
      throw new Error(`Rust type parameter '${parameterName}' has a parameterized trait bound that is not representable.`);
    }
    const requirement = rustCompilerTraitRequirement(document, trait.id);
    if (requirement === undefined) {
      throw new Error(`Rust type parameter '${parameterName}' requires unsupported trait '${String(trait.path)}'.`);
    }
    if (traitBound.modifier === "maybe") {
      if (typeRequirementKey(requirement) !== "trait:core::marker::Sized") {
        throw new Error(`Rust type parameter '${parameterName}' has unsupported optional trait bound '${String(trait.path)}'.`);
      }
      continue;
    }
    if (traitBound.modifier !== "none" && traitBound.modifier !== "maybe_const") {
      throw new Error(`Rust type parameter '${parameterName}' has unsupported trait-bound modifier '${String(traitBound.modifier)}'.`);
    }
    selected.set(typeRequirementKey(requirement), requirement);
  }
}


export function rustCompilerTraitRequirement(
  document: RustdocDocument,
  traitId: unknown,
): RustCompilerTypeRequirement | undefined {
  const candidate = document.paths[String(traitId)];
  const path = isRecord(candidate) ? candidate : undefined;
  if (path?.kind !== "trait" || !Array.isArray(path.path) ||
    path.path.length === 0 || path.path.some((segment) => typeof segment !== "string")) {
    return undefined;
  }
  const segments = path.path;
  if (segments.length === 3 && segments[0] === "core" && segments[1] === "clone" && segments[2] === "Clone") {
    return "clone";
  }
  if (segments.length === 3 && segments[0] === "core" && segments[1] === "marker" && segments[2] === "Copy") {
    return "copy";
  }
  return { kind: "trait", path: (segments as string[]).join("::") };
}


export function mergeTypeParameterRequirements(
  ...groups: readonly (readonly RustCompilerTypeParameter[])[]
): readonly RustCompilerTypeParameter[] {
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  for (const group of groups) {
    for (const parameter of group) {
      const selected = requirements.get(parameter.name) ?? new Map<string, RustCompilerTypeRequirement>();
      requirements.set(parameter.name, selected);
      for (const requirement of parameter.requirements) {
        selected.set(typeRequirementKey(requirement), requirement);
      }
    }
  }
  return Object.freeze([...requirements.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, selected]) => Object.freeze({
      name,
      requirements: Object.freeze([...selected.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([, requirement]) => requirement)),
    })));
}
