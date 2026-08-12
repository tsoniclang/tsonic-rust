import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  RustCompilerDependency,
  RustCompilerEnumVariant,
  RustCompilerExport,
  RustCompilerField,
  RustCompilerFunction,
  RustCompilerModuleModel,
  RustCompilerParameter,
  RustCompilerProjectSnapshot,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerUnsupportedExport,
  RustCompilerUnsupportedMember,
} from "./model.js";
import {
  rustCompilerProviderProtocolVersion,
  supportedRustdocFormatVersion,
} from "./model.js";
import { verifyRustCompilerDependencySource } from "./cargo-snapshot.js";

const commandBufferLimit = 64 * 1024 * 1024;
const rustdocJsonByteLimit = 128 * 1024 * 1024;
const rustdocTimeoutMilliseconds = 540_000;

interface RustdocArtifactMarker {
  readonly protocolVersion: typeof rustCompilerProviderProtocolVersion;
  readonly projectDigest: string;
  readonly dependencyAlias: string;
  readonly dependencySourceDigest: string;
  readonly compilerIdentity: string;
  readonly outputDigest: string;
}

interface RustdocDocument {
  readonly root: number | string;
  readonly crate_version: string | null;
  readonly index: Readonly<Record<string, unknown>>;
  readonly paths: Readonly<Record<string, unknown>>;
  readonly format_version: number;
}

export function loadRustCompilerModule(options: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly requestedExports?: readonly string[];
  readonly targetDirectory: string;
}): RustCompilerModuleModel {
  validateDependencyBelongsToSnapshot(options.snapshot, options.dependency);
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  const document = loadRustdocDocument(options);
  const model = normalizeModule(document, options);
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  return model;
}

function loadRustdocDocument(options: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly dependency: RustCompilerDependency;
  readonly targetDirectory: string;
}): RustdocDocument {
  const outputPath = rustdocOutputPath(options);
  const markerPath = `${outputPath}.tsonic-provider.json`;
  const cached = readCachedRustdocDocument(options, outputPath, markerPath);
  if (cached !== undefined) {
    return cached;
  }
  const args = [
    "rustdoc",
    "--manifest-path",
    options.snapshot.manifestPath,
    "--package",
    options.dependency.packageId,
    "--lib",
    "--target-dir",
    options.targetDirectory,
    "--",
    "-Z",
    "unstable-options",
    "--output-format",
    "json",
  ];
  const result = spawnSync("cargo", args, {
    cwd: options.dependency.sourceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RUSTC_BOOTSTRAP: "1",
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
    },
    maxBuffer: commandBufferLimit,
    timeout: rustdocTimeoutMilliseconds,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed (${String(result.status)}): ${result.stderr.trim()}`);
  }
  const outputText = readBoundedRustdocOutput(outputPath);
  const parsed = parseRustdocDocument(outputText, options.dependency);
  writeJsonAtomically(markerPath, {
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: options.snapshot.digest,
    dependencyAlias: options.dependency.alias,
    dependencySourceDigest: options.dependency.sourceDigest,
    compilerIdentity: options.snapshot.compiler.rustcVerboseVersion,
    outputDigest: digestText(outputText),
  } satisfies RustdocArtifactMarker);
  return parsed;
}

function readCachedRustdocDocument(
  options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
  },
  outputPath: string,
  markerPath: string,
): RustdocDocument | undefined {
  if (!existsSync(outputPath) || !existsSync(markerPath)) {
    return undefined;
  }
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(marker) ||
    marker.protocolVersion !== rustCompilerProviderProtocolVersion ||
    marker.projectDigest !== options.snapshot.digest ||
    marker.dependencyAlias !== options.dependency.alias ||
    marker.dependencySourceDigest !== options.dependency.sourceDigest ||
    marker.compilerIdentity !== options.snapshot.compiler.rustcVerboseVersion ||
    typeof marker.outputDigest !== "string") {
    return undefined;
  }
  const outputText = readBoundedRustdocOutput(outputPath);
  if (digestText(outputText) !== marker.outputDigest) {
    return undefined;
  }
  try {
    return parseRustdocDocument(outputText, options.dependency);
  } catch {
    return undefined;
  }
}

function parseRustdocDocument(
  text: string,
  dependency: RustCompilerDependency,
): RustdocDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || (typeof parsed.root !== "number" && typeof parsed.root !== "string") ||
    !isRecord(parsed.index) || !isRecord(parsed.paths) || parsed.format_version !== supportedRustdocFormatVersion) {
    throw new Error(`rustdoc emitted an unsupported JSON contract for '${dependency.alias}'; expected format ${supportedRustdocFormatVersion}.`);
  }
  if (parsed.crate_version !== dependency.packageVersion) {
    throw new Error(`rustdoc crate version '${String(parsed.crate_version)}' does not match Cargo package version '${dependency.packageVersion}'.`);
  }
  return parsed as unknown as RustdocDocument;
}

function rustdocOutputPath(options: {
  readonly dependency: RustCompilerDependency;
  readonly targetDirectory: string;
}): string {
  return join(options.targetDirectory, "doc", `${options.dependency.crateName.replace(/-/gu, "_")}.json`);
}

function readBoundedRustdocOutput(path: string): string {
  const size = statSync(path).size;
  if (!Number.isSafeInteger(size) || size < 0 || size > rustdocJsonByteLimit) {
    throw new Error(`rustdoc JSON '${path}' exceeds the ${rustdocJsonByteLimit}-byte compiler-provider limit.`);
  }
  return readFileSync(path, "utf8");
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value));
  renameSync(temporaryPath, path);
}

function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeModule(
  document: RustdocDocument,
  options: {
    readonly snapshot: RustCompilerProjectSnapshot;
    readonly dependency: RustCompilerDependency;
    readonly modulePath: readonly string[];
    readonly requestedExports?: readonly string[];
  },
): RustCompilerModuleModel {
  const moduleItem = findModule(document, options.modulePath);
  const moduleInner = requireInnerRecord(moduleItem, "module", "requested Rust module");
  const itemIds = requireArray(moduleInner.items, "requested Rust module items");
  const publicItems = itemIds
    .map((rawId) => itemById(document, rawId))
    .filter((item) => item.visibility === "public" && typeof item.name === "string");
  const publicItemsByName = new Map<string, Readonly<Record<string, unknown>>>();
  const ambiguousNames = new Set<string>();
  for (const item of publicItems) {
    const name = item.name as string;
    if (publicItemsByName.has(name)) {
      publicItemsByName.delete(name);
      ambiguousNames.add(name);
    } else if (!ambiguousNames.has(name)) {
      publicItemsByName.set(name, item);
    }
  }
  const requested = new Set(options.requestedExports ?? publicItemsByName.keys());
  const exports: RustCompilerExport[] = [];
  const unsupported: RustCompilerUnsupportedExport[] = [];
  const pending = [...requested].sort(compareText);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const name = pending.shift()!;
    if (!visited.add(name)) {
      continue;
    }
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
      const normalized = normalizeExport(document, item, options.dependency);
      exports.push(normalized);
      for (const dependencyName of sameModuleExportDependencies(
        normalized,
        options.dependency,
        options.modulePath,
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
  });
}

function sameModuleExportDependencies(
  exported: RustCompilerExport,
  dependency: RustCompilerDependency,
  modulePath: readonly string[],
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
        if (type.crateName === dependency.crateName &&
          type.modulePath.length === modulePath.length &&
          type.modulePath.every((segment, index) => segment === modulePath[index])) {
          names.add(type.name);
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
  }
  names.delete(exported.name);
  return Object.freeze([...names].sort(compareText));
}

function findModule(document: RustdocDocument, modulePath: readonly string[]): Readonly<Record<string, unknown>> {
  let module = itemById(document, document.root);
  for (const segment of modulePath) {
    const inner = requireInnerRecord(module, "module", `Rust module '${segment}' parent`);
    const child = requireArray(inner.items, `Rust module '${segment}' parent items`)
      .map((id) => itemById(document, id))
      .filter((item) => item.visibility === "public" && item.name === segment && hasInnerKind(item, "module"));
    if (child.length !== 1) {
      throw new Error(`Rust module path '${modulePath.join("::")}' does not resolve uniquely at '${segment}'.`);
    }
    module = child[0]!;
  }
  return module;
}

function normalizeExport(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): RustCompilerExport {
  const name = requireString(item.name, "Rust export name");
  const id = canonicalItemId(dependency, item);
  if (hasInnerKind(item, "constant")) {
    const constant = requireInnerRecord(item, "constant", `Rust constant '${name}'`);
    return Object.freeze({
      kind: "constant",
      id,
      name,
      type: normalizeType(document, constant.type),
    });
  }
  if (hasInnerKind(item, "function")) {
    return Object.freeze({
      kind: "function",
      id,
      name,
      function: normalizeFunction(document, item, dependency, undefined),
    });
  }
  if (hasInnerKind(item, "struct")) {
    const struct = requireInnerRecord(item, "struct", `Rust struct '${name}'`);
    const typeParameters = normalizeTypeParameters(requireRecord(struct.generics, `${name}.generics`));
    const fields = normalizeFields(document, struct, dependency);
    const methods = normalizeMethods(document, struct, dependency);
    return Object.freeze({
      kind: "struct",
      id,
      name,
      typeParameters,
      fields: fields.values,
      methods: methods.values,
      unsupportedMembers: Object.freeze([...fields.unsupported, ...methods.unsupported]
        .sort((left, right) => compareText(`${left.kind}\0${left.name}`, `${right.kind}\0${right.name}`))),
    });
  }
  if (hasInnerKind(item, "type_alias")) {
    const alias = requireInnerRecord(item, "type_alias", `Rust type alias '${name}'`);
    const generics = requireRecord(alias.generics, `${name}.generics`);
    if (requireArray(generics.where_predicates, `${name}.where_predicates`).length > 0 ||
      genericParametersHaveBounds(generics)) {
      throw new Error(`Rust type alias '${name}' has generic constraints that are not representable by the current source contract.`);
    }
    return Object.freeze({
      kind: "type-alias",
      id,
      name,
      typeParameters: normalizeTypeParameters(generics),
      type: normalizeType(document, alias.type),
    });
  }
  if (hasInnerKind(item, "enum")) {
    const enum_ = requireInnerRecord(item, "enum", `Rust enum '${name}'`);
    if (enum_.has_stripped_variants !== false) {
      throw new Error(`Rust enum '${name}' does not expose one complete variant set.`);
    }
    const generics = requireRecord(enum_.generics, `${name}.generics`);
    if (requireArray(generics.where_predicates, `${name}.where_predicates`).length > 0 ||
      genericParametersHaveBounds(generics)) {
      throw new Error(`Rust enum '${name}' has generic constraints that are not representable by the current source contract.`);
    }
    const methods = normalizeMethods(document, enum_, dependency);
    return Object.freeze({
      kind: "enum",
      id,
      name,
      typeParameters: normalizeTypeParameters(generics),
      variants: normalizeEnumVariants(document, enum_, dependency),
      methods: methods.values,
      unsupportedMembers: methods.unsupported,
    });
  }
  throw new Error(`Rust export '${name}' has no supported provider representation.`);
}

function normalizeEnumVariants(
  document: RustdocDocument,
  enum_: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): readonly RustCompilerEnumVariant[] {
  return Object.freeze(requireArray(enum_.variants, "Rust enum variants").map((variantId) => {
    const item = itemById(document, variantId);
    const name = requireString(item.name, "Rust enum variant name");
    const variant = requireInnerRecord(item, "variant", `Rust enum variant '${name}'`);
    if (variant.kind === "plain") {
      return Object.freeze({
        kind: "plain" as const,
        id: canonicalItemId(dependency, item),
        name,
        fields: Object.freeze([]),
      });
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
    return Object.freeze({
      kind: "tuple" as const,
      id: canonicalItemId(dependency, item),
      name,
      fields: Object.freeze(fields),
    });
  }).sort((left, right) => compareText(left.name, right.name)));
}

function normalizeFields(
  document: RustdocDocument,
  struct: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
): {
  readonly values: readonly RustCompilerField[];
  readonly unsupported: readonly RustCompilerUnsupportedMember[];
} {
  const kind = requireRecord(struct.kind, "Rust struct kind");
  const plain = isRecord(kind.plain) ? kind.plain : undefined;
  if (plain === undefined) {
    return { values: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  const fields: RustCompilerField[] = [];
  const unsupported: RustCompilerUnsupportedMember[] = [];
  for (const id of requireArray(plain.fields, "Rust struct fields")) {
    const item = itemById(document, id);
    if (item.visibility !== "public") {
      continue;
    }
    const name = typeof item.name === "string" ? item.name : `<field:${String(id)}>`;
    try {
      const inner = requireInnerRecord(item, "struct_field", "Rust struct field");
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
    if (requireArray(implGenerics.where_predicates, "Rust impl where predicates").length > 0 ||
      genericParametersHaveBounds(implGenerics)) {
      continue;
    }
    for (const methodId of requireArray(impl.items, "Rust impl items")) {
      const item = itemById(document, methodId);
      if (item.visibility !== "public" || !hasInnerKind(item, "function")) {
        continue;
      }
      const name = typeof item.name === "string" ? item.name : `<method:${String(methodId)}>`;
      try {
        methods.push(normalizeFunction(document, item, dependency, true));
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

function normalizeFunction(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  allowReceiver: true | undefined,
): RustCompilerFunction {
  const name = requireString(item.name, "Rust function name");
  const fn = requireInnerRecord(item, "function", `Rust function '${name}'`);
  const signature = requireRecord(fn.sig, `${name}.sig`);
  if (signature.is_c_variadic !== false) {
    throw new Error(`Rust function '${name}' is variadic and has no closed source signature.`);
  }
  const header = requireRecord(fn.header, `${name}.header`);
  const unsafe = requireBoolean(header.is_unsafe, `${name}.header.is_unsafe`);
  const abi = normalizeAbi(header.abi, `${name}.header.abi`);
  const generics = requireRecord(fn.generics, `${name}.generics`);
  if (requireArray(generics.where_predicates, `${name}.where_predicates`).length > 0 || genericParametersHaveBounds(generics)) {
    throw new Error(`Rust function '${name}' has generic constraints that are not representable by the current source contract.`);
  }
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
  if (result.kind === "reference" || result.kind === "slice") {
    throw new Error(`Rust function '${name}' returns a borrowed or unsized value with no closed target carrier.`);
  }
  return Object.freeze({
    id: canonicalItemId(dependency, item),
    name,
    parameters: Object.freeze(parameters),
    result,
    typeParameters: normalizeTypeParameters(generics),
    ...(receiver === undefined ? {} : { receiver }),
    asynchronous: header.is_async === true,
    unsafe,
    abi,
  });
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

function normalizeTypeParameters(generics: Readonly<Record<string, unknown>>): readonly RustCompilerTypeParameter[] {
  const parameters: RustCompilerTypeParameter[] = [];
  for (const raw of requireArray(generics.params, "Rust generic parameters")) {
    const parameter = requireRecord(raw, "Rust generic parameter");
    const kind = requireRecord(parameter.kind, "Rust generic parameter kind");
    if (!isRecord(kind.type)) {
      throw new Error(`Rust lifetime and const generic parameters are not representable by the current source contract.`);
    }
    parameters.push(Object.freeze({ name: requireString(parameter.name, "Rust type parameter name") }));
  }
  return Object.freeze(parameters);
}

function genericParametersHaveBounds(generics: Readonly<Record<string, unknown>>): boolean {
  return requireArray(generics.params, "Rust generic parameters").some((raw) => {
    const parameter = requireRecord(raw, "Rust generic parameter");
    const kind = requireRecord(parameter.kind, "Rust generic parameter kind");
    return isRecord(kind.type) && requireArray(kind.type.bounds, "Rust generic parameter bounds").length > 0;
  });
}

function normalizeType(
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
    return Object.freeze({
      kind: "reference",
      mutable: type.borrowed_ref.is_mutable === true,
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
      const parameters = normalizeTypeParameters(generics);
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

function normalizePathArguments(
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

function substituteRustCompilerType(
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
  }
}

function canonicalItemId(dependency: RustCompilerDependency, item: Readonly<Record<string, unknown>>): string {
  const id = item.id;
  if (typeof id !== "number" && typeof id !== "string") {
    throw new Error(`Rust item has no stable rustdoc identifier.`);
  }
  return `${dependency.packageId}#${String(id)}`;
}

function validateDependencyBelongsToSnapshot(
  snapshot: RustCompilerProjectSnapshot,
  dependency: RustCompilerDependency,
): void {
  if (snapshot.protocolVersion !== rustCompilerProviderProtocolVersion ||
    snapshot.compiler.rustdocFormatVersion !== supportedRustdocFormatVersion) {
    throw new Error(`Rust compiler-provider snapshot uses an unsupported contract.`);
  }
  const exact = snapshot.dependencies.find((candidate) => candidate.alias === dependency.alias);
  if (exact === undefined || JSON.stringify(exact) !== JSON.stringify(dependency)) {
    throw new Error(`Rust compiler-provider dependency '${dependency.alias}' does not belong to snapshot '${snapshot.digest}'.`);
  }
}

function itemById(document: RustdocDocument, id: unknown): Readonly<Record<string, unknown>> {
  const item = document.index[String(id)];
  return requireRecord(item, `rustdoc item '${String(id)}'`);
}

function hasInnerKind(item: Readonly<Record<string, unknown>>, kind: string): boolean {
  return isRecord(item.inner) && isRecord(item.inner[kind]);
}

function requireInnerRecord(item: Readonly<Record<string, unknown>>, kind: string, where: string): Readonly<Record<string, unknown>> {
  const inner = requireRecord(item.inner, `${where}.inner`);
  return requireRecord(inner[kind], `${where}.${kind}`);
}

function requireRecord(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${where} is not an object.`);
  }
  return value;
}

function requireArray(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${where} is not an array.`);
  }
  return value;
}

function requireBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${where} is not boolean.`);
  }
  return value;
}

function normalizeAbi(value: unknown, where: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    throw new Error(`${where} has no supported ABI representation.`);
  }
  const entries = Object.entries(value);
  const entry = entries[0];
  const options = entry?.[1];
  if (entries.length !== 1 || entry === undefined || !isRecord(options)) {
    throw new Error(`${where} has no unique ABI representation.`);
  }
  const [name] = entry;
  if (Object.keys(options).some((key) => key !== "unwind") ||
    (options.unwind !== undefined && typeof options.unwind !== "boolean")) {
    throw new Error(`${where} has unsupported ABI options.`);
  }
  return options.unwind === true ? `${name}-unwind` : name;
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where} is not a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
