import { isAbsolute } from "node:path";
import { hasExactObjectKeys, isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { validateRustNativeSourceLimits, type RustNativeSourceLimits } from "./limits.js";

export const maximumRustNativeRequestBytes = 64 * 1024 * 1024;

export interface RustNativeSourceFile {
  readonly path: string;
  readonly text: string;
}

export type RustNativeCompilation =
  | { readonly kind: "compiler"; readonly arguments: readonly string[] }
  | {
      readonly kind: "cargo";
      readonly manifestPath: string;
      readonly packageId: string;
      readonly target: { readonly kind: "library" } | { readonly kind: "binary"; readonly name: string };
    };

export interface RustNativeSourceRequest {
  readonly compilation: RustNativeCompilation;
  readonly sources: readonly RustNativeSourceFile[];
}

export function snapshotRustNativeSourceRequest(
  input: RustNativeSourceRequest,
  limits: RustNativeSourceLimits,
): RustNativeSourceRequest {
  validateRustNativeSourceLimits(limits);
  if (typeof input !== "object" || input === null || !hasExactObjectKeys(input, ["compilation", "sources"]) ||
      !isDenseDataArray(input.sources)) {
    throw new Error("Native Rust source input requires an exact compilation selection and source-file array.");
  }
  let bytes = 0;
  const reserve = (value: string): void => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > maximumRustNativeRequestBytes) throw new Error("Native Rust source request exceeds the byte limit.");
  };
  const compilation = snapshotCompilation(input.compilation, reserve);
  const compilationRows = compilation.kind === "compiler" ? compilation.arguments.length : 3;
  if (compilationRows + input.sources.length > limits.maximumRows) {
    throw new Error("Native Rust source input exceeds the row limit.");
  }
  const paths = new Set<string>();
  const sources = input.sources.map(file => {
    if (typeof file !== "object" || file === null || !hasExactObjectKeys(file, ["path", "text"]) ||
        !isUnicodeText(file.path) || !isAbsolute(file.path) || file.path.includes("\0") || !isUnicodeText(file.text)) {
      throw new Error("Native Rust source files require absolute Unicode paths and exact Unicode text.");
    }
    if (paths.has(file.path)) throw new Error("Native Rust source input has a duplicate filename.");
    paths.add(file.path);
    reserve(file.path);
    reserve(file.text);
    return Object.freeze({ path: file.path, text: file.text });
  });
  return Object.freeze({ compilation, sources: Object.freeze(sources) });
}

function snapshotCompilation(input: RustNativeCompilation, reserve: (value: string) => void): RustNativeCompilation {
  if (typeof input !== "object" || input === null) throw new Error("Native Rust compilation requires an exact selection.");
  const kind = Object.getOwnPropertyDescriptor(input, "kind");
  if (kind === undefined || !("value" in kind)) throw new Error("Native Rust compilation requires an exact selection.");
  if (kind.value === "compiler" && hasExactObjectKeys(input, ["kind", "arguments"]) && input.kind === "compiler") {
    if (!isDenseDataArray(input.arguments) || input.arguments.length === 0) {
      throw new Error("Native Rust compiler arguments require a nonempty data array.");
    }
    for (const argument of input.arguments) {
      if (!isUnicodeText(argument) || argument.includes("\0")) {
        throw new Error("Native Rust compiler arguments must be Unicode strings without NUL.");
      }
      reserve(argument);
    }
    return Object.freeze({ kind: "compiler", arguments: Object.freeze([...input.arguments]) });
  }
  if (kind.value !== "cargo" || !hasExactObjectKeys(input, ["kind", "manifestPath", "packageId", "target"]) || input.kind !== "cargo" ||
      !isUnicodeText(input.manifestPath) || !isAbsolute(input.manifestPath) || input.manifestPath.includes("\0") ||
      !isUnicodeText(input.packageId) || input.packageId.length === 0 || input.packageId.includes("\0")) {
    throw new Error("Native Rust Cargo selection requires an absolute Unicode manifest path and exact target.");
  }
  reserve(input.manifestPath);
  reserve(input.packageId);
  const target = input.target;
  if (target !== null && typeof target === "object" && hasExactObjectKeys(target, ["kind"]) && target.kind === "library") {
    return Object.freeze({ kind: "cargo", manifestPath: input.manifestPath, packageId: input.packageId,
      target: Object.freeze({ kind: "library" }) });
  }
  if (target === null || typeof target !== "object" || !hasExactObjectKeys(target, ["kind", "name"]) ||
      target.kind !== "binary" || !isUnicodeText(target.name) || target.name.length === 0 || target.name.includes("\0")) {
    throw new Error("Native Rust Cargo target must select its library or one exact binary name.");
  }
  reserve(target.name);
  return Object.freeze({ kind: "cargo", manifestPath: input.manifestPath, packageId: input.packageId,
    target: Object.freeze({ kind: "binary", name: target.name }) });
}

function isUnicodeText(value: unknown): value is string {
  return typeof value === "string" && !/[\ud800-\udfff]/u.test(value);
}
