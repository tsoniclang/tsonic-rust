import type { RustTokenDelimiter, RustLexicalTokenTree } from "../../../target-model/syntax/token-tree.js";
import { validateRustNativeSourceLimits } from "./limits.js";
import type { RustNativeSourceLimits } from "./limits.js";

export function decodeNativeTokenResponse(
  response: unknown,
  limits: RustNativeSourceLimits,
): readonly RustLexicalTokenTree[] {
  validateRustNativeSourceLimits(limits);
  if (!isRecord(response) || response.kind !== "tokens" || response.protocolVersion !== 1 || !Array.isArray(response.tokens)) {
    throw new Error("Native Rust token service returned an invalid response.");
  }
  let rows = 0;
  const decode = (values: readonly unknown[], depth: number): readonly RustLexicalTokenTree[] => {
    if (depth > limits.maximumDepth) throw new Error("Native Rust token response exceeds the depth limit.");
    return Object.freeze(values.map((value): RustLexicalTokenTree => {
      rows += 1;
      if (rows > limits.maximumRows) throw new Error("Native Rust token response exceeds the row limit.");
      if (!isRecord(value)) throw new Error("Native Rust token must be a structured object.");
      const range = value.source;
      if (!isRecord(range) || !isOffset(range.start) || !isOffset(range.end) || range.start > range.end) {
        throw new Error("Native Rust token has an invalid source range.");
      }
      const source = Object.freeze({ start: range.start, end: range.end });
      switch (value.kind) {
        case "identifier":
          if (typeof value.text === "string" && value.text.length > 0 && typeof value.raw === "boolean") {
            return Object.freeze({ kind: "identifier", text: value.text, raw: value.raw, source });
          }
          break;
        case "literal":
          if (typeof value.text === "string" && value.text.length > 0) return Object.freeze({ kind: "literal", text: value.text, source });
          break;
        case "punctuation":
          if (typeof value.text === "string" && value.text.length > 0 && typeof value.joint === "boolean") {
            return Object.freeze({ kind: "punctuation", text: value.text, joint: value.joint, source });
          }
          break;
        case "group":
          if (isDelimiter(value.delimiter) && Array.isArray(value.tokens)) {
            return Object.freeze({ kind: "group", delimiter: value.delimiter, tokens: decode(value.tokens, depth + 1), source });
          }
          break;
      }
      throw new Error("Native Rust token has an invalid kind or payload.");
    }));
  };
  return decode(response.tokens, 0);
}

function isDelimiter(value: unknown): value is RustTokenDelimiter {
  return value === "parentheses" || value === "brackets" || value === "braces";
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
