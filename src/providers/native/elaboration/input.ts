import { isAbsolute } from "node:path";
import { hasExactObjectKeys, isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { validateRustNativeSourceLimits, type RustNativeSourceLimits } from "./limits.js";

export const maximumRustNativeRequestBytes = 64 * 1024 * 1024;

export type RustNativeCompilation =
  | { readonly kind: "compiler"; readonly directory: string; readonly arguments: readonly string[] }
  | {
      readonly kind: "cargo";
      readonly manifestPath: string;
      readonly packageId: string;
      readonly target: { readonly kind: "library" } | { readonly kind: "binary"; readonly name: string };
    };

export interface RustNativeSourceRequest {
  readonly compilation: RustNativeCompilation;
}

export function snapshotRustNativeSourceRequest(
  input: RustNativeSourceRequest,
  limits: RustNativeSourceLimits,
): RustNativeSourceRequest {
  validateRustNativeSourceLimits(limits);
  if (typeof input !== "object" || input === null || !hasExactObjectKeys(input, ["compilation"])) {
    throw new Error("Native Rust source input requires an exact compilation selection.");
  }
  let bytes = 0;
  const reserve = (value: string): void => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > maximumRustNativeRequestBytes) throw new Error("Native Rust source request exceeds the byte limit.");
  };
  const compilation = snapshotCompilation(input.compilation, reserve);
  const compilationRows = compilation.kind === "compiler" ? compilation.arguments.length + 1 : 3;
  if (compilationRows > limits.maximumRows) {
    throw new Error("Native Rust source input exceeds the row limit.");
  }
  return Object.freeze({ compilation });
}

function snapshotCompilation(input: RustNativeCompilation, reserve: (value: string) => void): RustNativeCompilation {
  if (typeof input !== "object" || input === null) throw new Error("Native Rust compilation requires an exact selection.");
  const kind = Object.getOwnPropertyDescriptor(input, "kind");
  if (kind === undefined || !("value" in kind)) throw new Error("Native Rust compilation requires an exact selection.");
  if (kind.value === "compiler" && hasExactObjectKeys(input, ["kind", "directory", "arguments"]) && input.kind === "compiler") {
    if (!isUnicodeText(input.directory) || !isAbsolute(input.directory) || input.directory.includes("\0")) {
      throw new Error("Native Rust compiler directory must be an absolute Unicode path without NUL.");
    }
    reserve(input.directory);
    if (!isDenseDataArray(input.arguments) || input.arguments.length === 0) {
      throw new Error("Native Rust compiler arguments require a nonempty data array.");
    }
    for (const argument of input.arguments) {
      if (!isUnicodeText(argument) || argument.includes("\0")) {
        throw new Error("Native Rust compiler arguments must be Unicode strings without NUL.");
      }
      reserve(argument);
    }
    return Object.freeze({ kind: "compiler", directory: input.directory, arguments: Object.freeze([...input.arguments]) });
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
