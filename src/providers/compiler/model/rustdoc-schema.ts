import type { RustCompilerDependency } from "./model.js";
import { supportedRustdocFormatVersion } from "./model.js";

export interface RustdocDocument {
  readonly root: number | string;
  readonly crate_version: string | null;
  readonly index: Readonly<Record<string, unknown>>;
  readonly paths: Readonly<Record<string, unknown>>;
  readonly format_version: number;
}

export function parseRustdocDocument(
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


export function itemById(document: RustdocDocument, id: unknown): Readonly<Record<string, unknown>> {
  const item = document.index[String(id)];
  return requireRecord(item, `rustdoc item '${String(id)}'`);
}


export function hasInnerKind(item: Readonly<Record<string, unknown>>, kind: string): boolean {
  return isRecord(item.inner) && isRecord(item.inner[kind]);
}


export function requireInnerRecord(item: Readonly<Record<string, unknown>>, kind: string, where: string): Readonly<Record<string, unknown>> {
  const inner = requireRecord(item.inner, `${where}.inner`);
  return requireRecord(inner[kind], `${where}.${kind}`);
}


export function requireRecord(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${where} is not an object.`);
  }
  return value;
}


export function requireArray(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${where} is not an array.`);
  }
  return value;
}

export function rustdocOtherAttributes(
  item: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.freeze(requireArray(item.attrs, "rustdoc item attributes").flatMap((raw, index) => {
    if (typeof raw === "string" && raw.length > 0) return [`#[${raw}]`];
    const attribute = requireRecord(raw, `rustdoc item attribute ${index}`);
    return typeof attribute.other === "string" ? [attribute.other] : [];
  }));
}

export function rustdocItemStability(
  item: Readonly<Record<string, unknown>>,
): "stable" | "unstable" | undefined {
  const attributes = rustdocOtherAttributes(item).filter((attribute) =>
    attribute.startsWith("#[attr = Stability {"));
  if (attributes.length === 0) return undefined;
  if (attributes.length !== 1) {
    throw new Error("rustdoc item has more than one compiler stability attribute.");
  }
  const attribute = attributes[0]!;
  const stable = attribute.includes("level: Stable {");
  const unstable = attribute.includes("level: Unstable {");
  if (stable === unstable) {
    throw new Error("rustdoc item compiler stability attribute has no singular level.");
  }
  return stable ? "stable" : "unstable";
}

const moduleStabilityByDocument = new WeakMap<
  RustdocDocument,
  ReadonlyMap<string, "stable" | "unstable">
>();

export function rustdocItemEffectiveStability(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
): "stable" | "unstable" | undefined {
  let selected = rustdocItemStability(item);
  const itemPath = document.paths[String(item.id)];
  if (!isRecord(itemPath) || !Array.isArray(itemPath.path) ||
    !itemPath.path.every((segment) => typeof segment === "string")) {
    return selected;
  }
  const path = itemPath.path as string[];
  const moduleStabilities = rustdocModuleStabilities(document);
  for (let length = 1; length < path.length; length += 1) {
    const stability = moduleStabilities.get(rustdocPathKey(path.slice(0, length)));
    if (stability === "unstable") return "unstable";
    if (selected === undefined && stability === "stable") selected = "stable";
  }
  return selected;
}

function rustdocModuleStabilities(
  document: RustdocDocument,
): ReadonlyMap<string, "stable" | "unstable"> {
  const cached = moduleStabilityByDocument.get(document);
  if (cached !== undefined) return cached;
  const values = new Map<string, "stable" | "unstable">();
  for (const [id, rawPath] of Object.entries(document.paths)) {
    if (!isRecord(rawPath) || rawPath.kind !== "module" || !Array.isArray(rawPath.path) ||
      !rawPath.path.every((segment) => typeof segment === "string")) continue;
    const rawItem = document.index[id];
    if (!isRecord(rawItem)) continue;
    const stability = rustdocItemStability(rawItem);
    if (stability === undefined) continue;
    const key = rustdocPathKey(rawPath.path as string[]);
    const existing = values.get(key);
    if (existing !== undefined && existing !== stability) {
      throw new Error(`rustdoc module '${(rawPath.path as string[]).join("::")}' has contradictory compiler stability.`);
    }
    values.set(key, stability);
  }
  const result = new Map(values);
  moduleStabilityByDocument.set(document, result);
  return result;
}

function rustdocPathKey(path: readonly string[]): string {
  return path.join("\0");
}


export function requireBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${where} is not boolean.`);
  }
  return value;
}


export function normalizeAbi(value: unknown, where: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    throw new Error(`${where} has no supported ABI representation.`);
  }
  const entries = Object.entries(value);
  const entry = entries[0];
  const options = entry?.[1];
  if (entries.length !== 1 || entry === undefined) {
    throw new Error(`${where} has no unique ABI representation.`);
  }
  const [name] = entry;
  if (name === "Other") {
    if (typeof options !== "string" || options.length === 0) {
      throw new Error(`${where} has an invalid custom ABI name.`);
    }
    return options;
  }
  if (!isRecord(options)) {
    throw new Error(`${where} has no unique ABI representation.`);
  }
  if (Object.keys(options).some((key) => key !== "unwind") ||
    (options.unwind !== undefined && typeof options.unwind !== "boolean")) {
    throw new Error(`${where} has unsupported ABI options.`);
  }
  return options.unwind === true ? `${name}-unwind` : name;
}


export function requireString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where} is not a non-empty string.`);
  }
  return value;
}


export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
