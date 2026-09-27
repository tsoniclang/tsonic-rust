import type { RustLexicalTokenTree } from "../../../target-model/syntax/token-tree.js";
import { validateRustNativeSourceLimits } from "./limits.js";
import type { RustNativeSourceLimits } from "./limits.js";
import { array, boolean, choice, index, record, shape, text } from "./decode-values.js";

export function decodeNativeTokenResponse(
  response: unknown,
  sourceByteLength: number,
  limits: RustNativeSourceLimits,
): readonly RustLexicalTokenTree[] {
  validateRustNativeSourceLimits(limits);
  index(sourceByteLength);
  const envelope = shape(response, ["kind", "protocolVersion", "tokens"]);
  if (envelope.kind !== "tokens" || envelope.protocolVersion !== 1) {
    throw new Error("Native Rust token service returned an invalid response.");
  }
  let rows = 0;
  const decode = (values: unknown, depth: number): readonly RustLexicalTokenTree[] => {
    if (depth > limits.maximumDepth) throw new Error("Native Rust token response exceeds the depth limit.");
    return array(values, (input): RustLexicalTokenTree => {
      rows += 1;
      if (rows > limits.maximumRows) throw new Error("Native Rust token response exceeds the row limit.");
      const value = record(input);
      const range = shape(value.source, ["start", "end"]);
      const source = Object.freeze({ start: index(range.start), end: index(range.end) });
      if (source.start > source.end || source.end > sourceByteLength) {
        throw new Error("Native Rust token has an invalid source range.");
      }
      switch (value.kind) {
        case "identifier":
          shape(value, ["kind", "text", "raw", "source"]);
          return Object.freeze({ kind: "identifier", text: tokenText(value.text), raw: boolean(value.raw), source });
        case "literal":
          shape(value, ["kind", "text", "source"]);
          return Object.freeze({ kind: "literal", text: tokenText(value.text), source });
        case "punctuation":
          shape(value, ["kind", "text", "joint", "source"]);
          return Object.freeze({ kind: "punctuation", text: tokenText(value.text), joint: boolean(value.joint), source });
        case "group":
          shape(value, ["kind", "delimiter", "tokens", "source"]);
          return Object.freeze({ kind: "group", delimiter: choice(value.delimiter, ["parentheses", "brackets", "braces"]),
            tokens: decode(value.tokens, depth + 1), source });
      }
      throw new Error("Native Rust token has an invalid kind or payload.");
    });
  };
  return decode(envelope.tokens, 0);
}

function tokenText(value: unknown): string {
  const result = text(value);
  if (result.length === 0) throw new Error("Native Rust token has an invalid empty text.");
  return result;
}
