import type {
  RustCompilerDependency,
  RustCompilerEnumVariant,
  RustCompilerExport,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerParameter,
  RustCompilerProjectSnapshot,
  RustCompilerStandardTypeLocation,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeRequirement,
  RustCompilerUnsupportedExport,
  RustCompilerUnsupportedMember,
} from "./model.js";
import { rustCompilerProviderProtocolVersion } from "./model.js";
import {
  authoredPublicCanonicalPath,
  authoredPublicIdentity,
  authoredPublicKind,
  authoredPublicName,
  canonicalItemId,
  canonicalItemPath,
  expandedPublicModuleItems,
  isGlobUse,
  type ResolvedRustdocItem,
  type RustdocItemResolver,
} from "./rustdoc-items.js";
import {
  compareText,
  hasInnerKind,
  isRecord,
  itemById,
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
  type RustdocDocument,
} from "./rustdoc-schema.js";
import {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  compilerTypeSupportsRequirement,
  directImplementationTypeParameterPositions,
  mergeTypeParameterRequirements,
  normalizeType,
  normalizeTypeParameters,
  normalizeTypeTraits,
  rustStaticValueCanBeCopied,
  sourceVisibleTypeParameterCount,
  typeParameterGuaranteesRequirement,
  typeRequirementKey,
} from "./rustdoc-types.js";

export function normalizeModule(
  document: RustdocDocument,
  options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
    readonly modulePath: readonly string[];
    readonly requestedExports?: readonly string[];
  },
  resolveItem?: RustdocItemResolver,
): RustCompilerModuleModel {
  const module = findModule(document, options.dependency, options.modulePath, resolveItem);
  const items = expandedPublicModuleItems(
    module,
    "requested Rust module",
    resolveItem,
  );
  const publicItemsByName = new Map<string, ResolvedRustdocItem>();
  const publicItemIdentitiesByName = new Map<string, string>();
  const publicNameByCanonicalPath = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  for (const item of items) {
    const authored = item.item;
    if (authored.visibility !== "public" || isGlobUse(authored) ||
      !providerExportKind(authoredPublicKind(item.document, authored))) {
      continue;
    }
    const name = authoredPublicName(authored);
    if (name === undefined) {
      continue;
    }
    const identity = authoredPublicIdentity(item.document, item.dependency, authored);
    const existingIdentity = publicItemIdentitiesByName.get(name);
    if (existingIdentity === identity) {
      continue;
    }
    if (existingIdentity !== undefined) {
      publicItemsByName.delete(name);
      publicItemIdentitiesByName.delete(name);
      ambiguousNames.add(name);
    } else if (!ambiguousNames.has(name)) {
      publicItemsByName.set(name, item);
      publicItemIdentitiesByName.set(name, identity);
      const canonicalPath = authoredPublicCanonicalPath(item.document, authored);
      if (canonicalPath !== undefined) {
        publicNameByCanonicalPath.set(canonicalPathKey(canonicalPath), name);
      }
    }
  }
  const requested = new Set(options.requestedExports ?? publicItemsByName.keys());
  const exports: RustCompilerExport[] = [];
  const unsupported: RustCompilerUnsupportedExport[] = [];
  const pending = [...requested].sort(compareText);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const name = pending.shift()!;
    if (visited.has(name)) {
      continue;
    }
    visited.add(name);
    if (ambiguousNames.has(name)) {
      unsupported.push({ name, reason: `Rust module exports more than one public item named '${name}'.` });
      continue;
    }
    const item = publicItemsByName.get(name);
    if (item === undefined) {
      unsupported.push({ name, reason: `Rust module does not export public item '${name}'.` });
      continue;
    }
    try {
      const authored = item.item;
      const resolved = resolveItem?.(item.document, item.dependency, authored.id) ?? {
        document: item.document,
        item: authored,
        dependency: item.dependency,
        publicName: name,
      };
      const normalized = normalizeExport(
        resolved.document,
        resolved.item,
        resolved.dependency,
        name,
        [options.dependency.targetCrateName, ...options.modulePath, name],
      );
      exports.push(normalized);
      for (const dependencyName of sameModuleExportDependencies(
        normalized,
        publicNameByCanonicalPath,
      )) {
        if (!visited.has(dependencyName)) {
          pending.push(dependencyName);
        }
      }
      pending.sort(compareText);
    } catch (error) {
      unsupported.push({
        name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  exports.sort((left, right) => compareText(left.name, right.name));
  unsupported.sort((left, right) => compareText(left.name, right.name));
  return Object.freeze({
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: options.snapshot.digest,
    dependency: options.dependency,
    modulePath: Object.freeze([...options.modulePath]),
    exports: Object.freeze(exports),
    unsupportedExports: Object.freeze(unsupported),
    standardTypeLocations: Object.freeze([]) as readonly RustCompilerStandardTypeLocation[],
  });
}

function sameModuleExportDependencies(
  exported: RustCompilerExport,
  publicNameByCanonicalPath: ReadonlyMap<string, string>,
): readonly string[] {
  const names = new Set<string>();
  const visitType = (type: RustCompilerType): void => {
    switch (type.kind) {
      case "unit":
      case "primitive":
      case "generic":
      case "self":
        return;
      case "tuple":
        type.elements.forEach(visitType);
        return;
      case "array":
      case "slice":
        visitType(type.element);
        return;
      case "reference":
      case "raw-pointer":
        visitType(type.target);
        return;
      case "function-pointer":
        type.parameters.forEach(visitType);
        visitType(type.result);
        return;
      case "path":
        type.typeArguments.forEach(visitType);
        {
          const publicName = publicNameByCanonicalPath.get(canonicalCompilerTypePathKey(type));
          if (publicName !== undefined) {
            names.add(publicName);
          }
        }
        return;
    }
  };
  const visitFunction = (fn: RustCompilerFunction): void => {
    fn.parameters.forEach((parameter) => visitType(parameter.type));
    visitType(fn.result);
  };
  switch (exported.kind) {
    case "constant":
    case "static":
      visitType(exported.type);
      break;
    case "function":
      visitFunction(exported.function);
      break;
    case "struct":
      exported.fields.forEach((field) => visitType(field.type));
      exported.methods.forEach(visitFunction);
      break;
    case "type-alias":
      visitType(exported.type);
      break;
    case "enum":
      exported.variants.forEach((variant) => variant.fields.forEach(visitType));
      exported.methods.forEach(visitFunction);
      break;
    case "union":
      exported.fields.forEach((field) => visitType(field.type));
      exported.methods.forEach(visitFunction);
      break;
  }
  names.delete(exported.name);
  return Object.freeze([...names].sort(compareText));
}

function findModule(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  modulePath: readonly string[],
  resolveItem?: RustdocItemResolver,
): ResolvedRustdocItem {
  let module: ResolvedRustdocItem = {
    document,
    item: itemById(document, document.root),
    dependency,
  };
  for (const segment of modulePath) {
    const childrenByIdentity = new Map(expandedPublicModuleItems(
      module,
      `Rust module '${segment}' parent`,
      resolveItem,
    )
      .filter((child) => {
        const authored = child.item;
        return authored.visibility === "public" && !isGlobUse(authored) &&
          authoredPublicName(authored) === segment &&
          authoredPublicKind(child.document, authored) === "module";
      })
      .map((child) => [
        authoredPublicIdentity(child.document, child.dependency, child.item),
        child,
      ] as const));
    const children = [...childrenByIdentity.values()];
    if (children.length !== 1) {
      throw new Error(`Rust module path '${modulePath.join("::")}' does not resolve uniquely at '${segment}'.`);
    }
    const authoredChild = children[0]!;
    const authored = authoredChild.item;
    const child = resolveItem?.(
      authoredChild.document,
      authoredChild.dependency,
      authored.id,
    ) ?? {
      document: authoredChild.document,
      item: authored,
      dependency: authoredChild.dependency,
      publicName: segment,
    };
    if (!hasInnerKind(child.item, "module")) {
      throw new Error(`Rust item '${segment}' in module path '${modulePath.join("::")}' is not a module.`);
    }
    module = child;
  }
  return module;
}

function providerExportKind(kind: string | undefined): boolean {
  return kind === "constant" || kind === "enum" || kind === "function" ||
    kind === "static" || kind === "struct" || kind === "type_alias" || kind === "union";
}

function normalizeExport(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  publicName: string,
  targetPath: readonly string[],
): RustCompilerExport {
  const name = requireString(publicName, "Rust export name");
  const id = canonicalItemId(dependency, item);
  const canonicalPath = canonicalItemPath(document, item);
  const identity = { id, name, canonicalPath, targetPath: Object.freeze([...targetPath]) };
  if (hasInnerKind(item, "constant")) {
    const constant = requireInnerRecord(item, "constant", `Rust constant '${name}'`);
    return Object.freeze({
      kind: "constant",
      ...identity,
      type: normalizeType(document, constant.type),
    });
  }
  if (hasInnerKind(item, "static")) {
    const static_ = requireInnerRecord(item, "static", `Rust static '${name}'`);
    const mutable = requireBoolean(static_.is_mutable, `${name}.static.is_mutable`);
    const type = normalizeType(document, static_.type);
    if (!rustStaticValueCanBeCopied(type)) {
      throw new Error(`Rust static '${name}' has a value type that is not structurally proven Copy.`);
    }
    return Object.freeze({
      kind: "static",
      ...identity,
      type,
      unsafe: requireBoolean(static_.is_unsafe, `${name}.static.is_unsafe`),
      mutable,
    });
  }
  if (hasInnerKind(item, "function")) {
    return Object.freeze({
      kind: "function",
      ...identity,
      function: normalizeFunction(document, item, dependency, undefined),
    });
  }
  if (hasInnerKind(item, "struct")) {
    const struct = requireInnerRecord(item, "struct", `Rust struct '${name}'`);
    const typeParameters = normalizeTypeParameters(document, requireRecord(struct.generics, `${name}.generics`));
    const fields = normalizeFields(document, struct, dependency);
    const methods = normalizeMethods(document, struct, dependency, typeParameters);
    return Object.freeze({
      kind: "struct",
      ...identity,
      typeParameters,
      fields: fields.values,
      methods: methods.values,
      unsupportedMembers: Object.freeze([...fields.unsupported, ...methods.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
      traits: normalizeTypeTraits(document, struct, typeParameters),
    });
  }
  if (hasInnerKind(item, "type_alias")) {
    const alias = requireInnerRecord(item, "type_alias", `Rust type alias '${name}'`);
    const generics = requireRecord(alias.generics, `${name}.generics`);
    return Object.freeze({
      kind: "type-alias",
      ...identity,
      typeParameters: normalizeTypeParameters(document, generics),
      type: normalizeType(document, alias.type),
    });
  }
  if (hasInnerKind(item, "enum")) {
    const enum_ = requireInnerRecord(item, "enum", `Rust enum '${name}'`);
    const generics = requireRecord(enum_.generics, `${name}.generics`);
    const typeParameters = normalizeTypeParameters(document, generics);
    const methods = normalizeMethods(document, enum_, dependency, typeParameters);
    const variantsComplete = enum_.has_stripped_variants === false;
    const variants = variantsComplete
      ? normalizeEnumVariants(document, enum_, dependency)
      : { values: Object.freeze([]), unsupported: Object.freeze([]) };
    return Object.freeze({
      kind: "enum",
      ...identity,
      typeParameters,
      variantsComplete,
      variants: variants.values,
      methods: methods.values,
      unsupportedMembers: Object.freeze([...variants.unsupported, ...methods.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
      traits: normalizeTypeTraits(document, enum_, typeParameters),
    });
  }
  if (hasInnerKind(item, "union")) {
    const union = requireInnerRecord(item, "union", `Rust union '${name}'`);
    const typeParameters = normalizeTypeParameters(
      document,
      requireRecord(union.generics, `${name}.generics`),
    );
    const fields = normalizePublicFields(
      document,
      requireArray(union.fields, `${name}.fields`),
      dependency,
      "union",
    );
    const methods = normalizeMethods(document, union, dependency, typeParameters);
    return Object.freeze({
      kind: "union",
      ...identity,
      typeParameters,
      fields: fields.values,
      methods: methods.values,
      unsupportedMembers: Object.freeze([...fields.unsupported, ...methods.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
      traits: normalizeTypeTraits(document, union, typeParameters),
    });
  }
  throw new Error(`Rust export '${name}' has no supported provider representation.`);
}

function normalizeEnumVariants(
  document: RustdocDocument,
  enum_: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): {
  readonly values: readonly RustCompilerEnumVariant[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const values: RustCompilerEnumVariant[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const variantId of requireArray(enum_.variants, "Rust enum variants")) {
    const item = itemById(document, variantId);
    const name = requireString(item.name, "Rust enum variant name");
    try {
      const variant = requireInnerRecord(item, "variant", `Rust enum variant '${name}'`);
      if (variant.kind === "plain") {
        values.push(Object.freeze({
          kind: "plain" as const,
          id: canonicalItemId(dependency, item),
          name,
          fields: Object.freeze([]),
        }));
        continue;
      }
      const kind = requireRecord(variant.kind, `Rust enum variant '${name}' kind`);
      if (!Array.isArray(kind.tuple)) {
        throw new Error(`Rust enum variant '${name}' has a struct payload with no canonical source-call contract.`);
      }
      const fields = kind.tuple.map((fieldId) => {
        const field = itemById(document, fieldId);
        return normalizeType(
          document,
          requireInnerRecord(field, "struct_field", `Rust enum variant '${name}' field`),
        );
      });
      values.push(Object.freeze({
        kind: "tuple" as const,
        id: canonicalItemId(dependency, item),
        name,
        fields: Object.freeze(fields),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "variant",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    values: Object.freeze(values.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function normalizeFields(
  document: RustdocDocument,
  struct: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  if (struct.kind === "unit") {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  const kind = requireRecord(struct.kind, "Rust struct kind");
  const plain = isRecord(kind.plain) ? kind.plain : undefined;
  if (plain === undefined) {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  return normalizePublicFields(
    document,
    requireArray(plain.fields, "Rust struct fields"),
    dependency,
    "struct",
  );
}

function normalizePublicFields(
  document: RustdocDocument,
  fieldIds: readonly unknown[],
  dependency: RustCompilerDependency,
  ownerKind: "struct" | "union",
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const fields: RustCompilerField[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const id of fieldIds) {
    const item = itemById(document, id);
    if (item.visibility !== "public") {
      continue;
    }
    const name = typeof item.name === "string" ? item.name : `<field:${String(id)}>`;
    try {
      const inner = requireInnerRecord(item, "struct_field", `Rust ${ownerKind} field`);
      fields.push(Object.freeze({
        id: canonicalItemId(dependency, item),
        name: requireString(item.name, "Rust field name"),
        type: normalizeType(document, inner),
      }));
    } catch (error) {
      unsupported.push(Object.freeze({
        kind: "field",
        name,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return {
    values: Object.freeze(fields.sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function normalizeMethods(
  document: RustdocDocument,
  struct: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
): {
  readonly values: readonly RustCompilerFunction[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const methods: RustCompilerFunction[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const implId of requireArray(struct.impls, "Rust struct impls")) {
    const implItem = itemById(document, implId);
    const impl = requireInnerRecord(implItem, "impl", "Rust impl");
    if (impl.trait !== null || impl.blanket_impl !== null) {
      continue;
    }
    const implGenerics = requireRecord(impl.generics, "Rust impl generics");
    let implTypeParameters: readonly RustCompilerTypeParameter[];
    try {
      implTypeParameters = normalizeTypeParameters(document, implGenerics);
      const sourceRequirements = sourceImplementationRequirements(
        document,
        impl,
        implTypeParameters,
        declaredTypeParameters,
      );
      if (sourceRequirements === undefined) {
        throw new Error("Rust inherent impl requirements cannot be projected onto the source-visible type arguments.");
      }
      implTypeParameters = sourceRequirements;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const methodId of requireArray(impl.items, "Rust impl items")) {
        const item = itemById(document, methodId);
        if (item.visibility === "public" && hasInnerKind(item, "function")) {
          unsupported.push(Object.freeze({
            kind: "method",
            name: typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`,
            reason,
          }));
        }
      }
      continue;
    }
    for (const methodId of requireArray(impl.items, "Rust impl items")) {
      const item = itemById(document, methodId);
      if (item.visibility !== "public" || !hasInnerKind(item, "function")) {
        continue;
      }
      const name = typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`;
      try {
        methods.push(normalizeFunction(document, item, dependency, true, implTypeParameters));
      } catch (error) {
        unsupported.push(Object.freeze({
          kind: "method",
          name,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }
  const names = new Set<string>();
  for (const method of methods) {
    if (names.has(method.name)) {
      unsupported.push(Object.freeze({
        kind: "method",
        name: method.name,
        reason: `Rust struct exposes ambiguous inherent method '${method.name}'.`,
      }));
      continue;
    }
    names.add(method.name);
  }
  const ambiguousNames = new Set(unsupported
    .filter((entry) => entry.reason.includes("ambiguous inherent method"))
    .map((entry) => entry.name));
  return {
    values: Object.freeze(methods
      .filter((method) => !ambiguousNames.has(method.name))
      .sort((left, right) => compareText(left.name, right.name))),
    unsupported: Object.freeze(unsupported.sort((left, right) => compareText(left.name, right.name))),
  };
}

function sourceImplementationRequirements(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationParameters: readonly RustCompilerTypeParameter[],
  declaredTypeParameters: readonly RustCompilerTypeParameter[],
): readonly RustCompilerTypeParameter[] | undefined {
  const positions = directImplementationTypeParameterPositions(
    document,
    impl,
    declaredTypeParameters,
  );
  if (positions === undefined) {
    return undefined;
  }
  const sourceTypeArgumentCount = sourceVisibleTypeParameterCount(declaredTypeParameters);
  const requirements = new Map<string, Map<string, RustCompilerTypeRequirement>>();
  for (const parameter of implementationParameters) {
    const typeArgumentIndex = positions.get(parameter.name);
    if (typeArgumentIndex === undefined) {
      if (parameter.requirements.length !== 0) {
        return undefined;
      }
      continue;
    }
    const declared = declaredTypeParameters[typeArgumentIndex];
    if (declared === undefined) {
      return undefined;
    }
    for (const requirement of parameter.requirements) {
      if (typeParameterGuaranteesRequirement(declared, requirement)) {
        continue;
      }
      if (typeArgumentIndex < sourceTypeArgumentCount) {
        const selected = requirements.get(declared.name) ?? new Map<string, RustCompilerTypeRequirement>();
        selected.set(typeRequirementKey(requirement), requirement);
        requirements.set(declared.name, selected);
        continue;
      }
      if (declared.defaultType === undefined || !compilerTypeSupportsRequirement(
        document,
        declared.defaultType,
        requirement,
        new Set(),
      )) {
        return undefined;
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

function normalizeFunction(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  allowReceiver: true | undefined,
  inheritedRequirements: readonly RustCompilerTypeParameter[] = Object.freeze([]),
): RustCompilerFunction {
  const name = requireString(item.name, "Rust function name");
  const fn = requireInnerRecord(item, "function", `Rust function '${name}'`);
  const signature = requireRecord(fn.sig, `${name}.sig`);
  const variadic = requireBoolean(signature.is_c_variadic, `${name}.sig.is_c_variadic`);
  const header = requireRecord(fn.header, `${name}.header`);
  const unsafe = requireBoolean(header.is_unsafe, `${name}.header.is_unsafe`);
  const abi = normalizeAbi(header.abi, `${name}.header.abi`);
  const generics = requireRecord(fn.generics, `${name}.generics`);
  const typeParameters = normalizeTypeParameters(document, generics);
  const rawInputs = requireArray(signature.inputs, `${name}.inputs`);
  let receiver: RustCompilerFunction["receiver"];
  const parameters: RustCompilerParameter[] = [];
  for (let index = 0; index < rawInputs.length; index += 1) {
    const pair = rawInputs[index];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
      throw new Error(`Rust function '${name}' input ${index} has an invalid rustdoc shape.`);
    }
    const type = normalizeType(document, pair[1]);
    if (index === 0 && pair[0] === "self") {
      if (allowReceiver !== true) {
        throw new Error(`Free Rust function '${name}' unexpectedly declares a self receiver.`);
      }
      receiver = receiverKind(type, name);
      continue;
    }
    parameters.push(Object.freeze({ name: pair[0], type }));
  }
  const output = signature.output;
  const result = output === null
    ? Object.freeze({ kind: "unit" as const })
    : normalizeType(document, output);
  if (!rustResultTypeHasClosedCarrier(result)) {
    throw new Error(`Rust function '${name}' returns a borrowed or unsized value with no closed target carrier.`);
  }
  return Object.freeze({
    id: canonicalItemId(dependency, item),
    name,
    parameters: Object.freeze(parameters),
    result,
    typeParameters,
    typeRequirements: mergeTypeParameterRequirements(inheritedRequirements, typeParameters),
    ...(receiver === undefined ? {} : { receiver }),
    asynchronous: header.is_async === true,
    unsafe,
    abi,
    variadic,
  });
}

function rustResultTypeHasClosedCarrier(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "reference":
    case "slice":
      return false;
    case "tuple":
      return type.elements.every(rustResultTypeHasClosedCarrier);
    case "array":
      return rustResultTypeHasClosedCarrier(type.element);
    case "raw-pointer":
      return true;
    case "function-pointer":
      return type.parameters.every(rustResultTypeHasClosedCarrier) &&
        rustResultTypeHasClosedCarrier(type.result);
    case "path":
      return type.typeArguments.every(rustResultTypeHasClosedCarrier);
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return true;
  }
}

function receiverKind(type: RustCompilerType, functionName: string): "value" | "shared" | "mutable" {
  if (type.kind === "self") {
    return "value";
  }
  if (type.kind === "reference" && type.target.kind === "self") {
    return type.mutable ? "mutable" : "shared";
  }
  throw new Error(`Rust method '${functionName}' has an unsupported receiver type.`);
}
