import { isRecord } from "../rustdoc-schema.js";
import type { RustCompilerConstArgument, RustCompilerLifetime } from "../model.js";
import type { RustCompilerNormalizationContext } from "./context.js";

export function normalizeLifetime(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerLifetime {
  if (raw === null || raw === undefined) {
    return Object.freeze({ kind: "elided", ownerIdentity: context.owner.itemId, position });
  }
  if (raw === "'static" || raw === "static") return Object.freeze({ kind: "static" });
  if (raw === "'_" || raw === "_") return Object.freeze({ kind: "placeholder" });
  if (typeof raw !== "string") {
    throw new Error("Rust lifetime has no stable rustdoc representation.");
  }
  const name = raw.startsWith("'") ? raw.slice(1) : raw;
  const parameter = context.parameters.get(name) ?? context.parameters.get(raw);
  if (parameter?.kind !== "lifetime") {
    throw new Error(`Rust lifetime '${raw}' has no declaration-backed identity.`);
  }
  return parameter.lifetime;
}

export function normalizeConstArgument(
  raw: unknown,
  context: RustCompilerNormalizationContext,
  position: string,
): RustCompilerConstArgument {
  if (typeof raw === "boolean") return Object.freeze({ kind: "boolean", value: raw });
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      throw new Error(`Rust const argument at '${position}' is not a safe integer.`);
    }
    return Object.freeze({ kind: "integer", value: String(raw) });
  }
  const expression = isRecord(raw)
    ? typeof raw.expr === "string"
      ? raw.expr
      : typeof raw.value === "string"
        ? raw.value
        : undefined
    : typeof raw === "string"
      ? raw
      : undefined;
  if (expression === undefined) {
    throw new Error(`Rust const argument at '${position}' has no exact scalar representation.`);
  }
  const source = expression.trim();
  if (source === "_") return Object.freeze({ kind: "infer" });
  if (source === "true" || source === "false") {
    return Object.freeze({ kind: "boolean", value: source === "true" });
  }
  if (isRustIntegerLiteral(source)) {
    return Object.freeze({ kind: "integer", value: normalizeRustInteger(source) });
  }
  if (isRustCharacterLiteral(source)) {
    return Object.freeze({ kind: "char", value: decodeRustCharacter(source) });
  }
  if (/^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u.test(source)) {
    const parameter = context.parameters.get(source);
    if (parameter?.kind !== "const") {
      throw new Error(`Rust const argument '${source}' has no declaration-backed identity.`);
    }
    return Object.freeze({ kind: "parameter", identity: parameter.identity, name: parameter.name });
  }
  throw new Error(`Rust const argument '${source}' is outside the approved literal-or-parameter contract.`);
}

function isRustIntegerLiteral(value: string): boolean {
  return /^-?(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9][0-9_]*)(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?$/u.test(value);
}

function normalizeRustInteger(value: string): string {
  const negative = value.startsWith("-");
  const source = negative ? value.slice(1) : value;
  const unsuffixed = source
    .replace(/(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)$/u, "")
    .split("_")
    .join("");
  const parsed = BigInt(unsuffixed);
  return (negative ? -parsed : parsed).toString();
}

function isRustCharacterLiteral(value: string): boolean {
  return value.length >= 3 && value.startsWith("'") && value.endsWith("'");
}

function decodeRustCharacter(value: string): string {
  const body = value.slice(1, -1);
  if (!body.startsWith("\\")) {
    if ([...body].length !== 1) {
      throw new Error(`Rust character literal '${value}' is not one Unicode scalar value.`);
    }
    return body;
  }
  if (body.startsWith("\\u{") && body.endsWith("}")) {
    const codePoint = Number.parseInt(body.slice(3, -1).split("_").join(""), 16);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff ||
      codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error(`Rust character literal '${value}' has an invalid Unicode scalar value.`);
    }
    return String.fromCodePoint(codePoint);
  }
  switch (body.slice(1)) {
    case "n": return "\n";
    case "r": return "\r";
    case "t": return "\t";
    case "0": return "\0";
    case "\\": return "\\";
    case "'": return "'";
    case "\"": return "\"";
    default: throw new Error(`Rust character literal '${value}' has an unsupported escape.`);
  }
}
