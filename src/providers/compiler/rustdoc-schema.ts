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
