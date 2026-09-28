import { isAbsolute } from "node:path";
import { hasExactObjectKeys, isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { validateRustNativeSourceLimits, type RustNativeSourceLimits } from "./limits.js";

export const maximumRustNativeRequestBytes = 64 * 1024 * 1024;

export interface RustNativeSourceFile {
  readonly path: string;
  readonly text: string;
}

export interface RustNativeSourceRequest {
  readonly arguments: readonly string[];
  readonly sources: readonly RustNativeSourceFile[];
}

export function snapshotRustNativeSourceRequest(
  input: RustNativeSourceRequest,
  limits: RustNativeSourceLimits,
): RustNativeSourceRequest {
  validateRustNativeSourceLimits(limits);
  if (typeof input !== "object" || input === null || !hasExactObjectKeys(input, ["arguments", "sources"]) ||
      !isDenseDataArray(input.arguments) || !isDenseDataArray(input.sources) || input.arguments.length === 0) {
    throw new Error("Native Rust source input requires exact arguments and source-file arrays.");
  }
  if (input.arguments.length + input.sources.length > limits.maximumRows) {
    throw new Error("Native Rust source input exceeds the row limit.");
  }
  let bytes = 0;
  const reserve = (value: string): void => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > maximumRustNativeRequestBytes) throw new Error("Native Rust source request exceeds the byte limit.");
  };
  for (const argument of input.arguments) {
    if (!isUnicodeText(argument) || argument.includes("\0")) {
      throw new Error("Native Rust compiler arguments must be Unicode strings without NUL.");
    }
    reserve(argument);
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
  return Object.freeze({ arguments: Object.freeze([...input.arguments]), sources: Object.freeze(sources) });
}

function isUnicodeText(value: unknown): value is string {
  return typeof value === "string" && !/[\ud800-\udfff]/u.test(value);
}
