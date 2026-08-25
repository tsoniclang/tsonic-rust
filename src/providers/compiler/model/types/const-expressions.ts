import { isRecord } from "../rustdoc-schema.js";
import type {
  RustCompilerConstExpression,
  RustCompilerItemIdentity,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerNormalizationContext } from "./normalization.js";

type BinaryOperator = Extract<
  RustCompilerConstExpression,
  { readonly kind: "binary" }
>["operator"];

interface Token {
  readonly kind: "character" | "identifier" | "integer" | "operator" | "punctuation";
  readonly text: string;
}

const binaryOperators = new Map<string, { readonly operator: BinaryOperator; readonly precedence: number }>([
  ["|", { operator: "bit-or", precedence: 1 }],
  ["^", { operator: "bit-xor", precedence: 2 }],
  ["&", { operator: "bit-and", precedence: 3 }],
  ["<<", { operator: "shift-left", precedence: 4 }],
  [">>", { operator: "shift-right", precedence: 4 }],
  ["+", { operator: "add", precedence: 5 }],
  ["-", { operator: "subtract", precedence: 5 }],
  ["*", { operator: "multiply", precedence: 6 }],
  ["/", { operator: "divide", precedence: 6 }],
  ["%", { operator: "remainder", precedence: 6 }],
]);

export function normalizeRustConstExpression(
  document: RustdocDocument,
  raw: unknown,
  context: RustCompilerNormalizationContext,
): RustCompilerConstExpression {
  if (typeof raw === "boolean") {
    return Object.freeze({ kind: "literal", literalKind: "boolean", value: raw });
  }
  if (typeof raw === "number" && Number.isSafeInteger(raw)) {
    return Object.freeze({ kind: "literal", literalKind: "integer", value: BigInt(raw) });
  }
  if (typeof raw !== "string") {
    throw new Error("Rust const expression has no stable structural representation.");
  }
  const tokens = tokenize(raw);
  const parser = new RustConstExpressionParser(document, context, tokens);
  const expression = parser.parse();
  if (!parser.done()) {
    throw new Error(`Rust const expression '${raw}' contains unsupported trailing syntax.`);
  }
  return expression;
}

class RustConstExpressionParser {
  private index = 0;

  public constructor(
    private readonly document: RustdocDocument,
    private readonly context: RustCompilerNormalizationContext,
    private readonly tokens: readonly Token[],
  ) {}

  public parse(): RustCompilerConstExpression {
    if (this.tokens.length === 0) {
      throw new Error("Rust const expression is empty.");
    }
    if (this.peek("{")) {
      this.consume("{");
      const expression = this.parseBinary(1);
      this.consume("}");
      return expression;
    }
    return this.parseBinary(1);
  }

  public done(): boolean {
    return this.index === this.tokens.length;
  }

  private parseBinary(minimumPrecedence: number): RustCompilerConstExpression {
    let left = this.parseUnary();
    while (true) {
      const token = this.tokens[this.index];
      const selected = token === undefined ? undefined : binaryOperators.get(token.text);
      if (selected === undefined || selected.precedence < minimumPrecedence) break;
      this.index += 1;
      const right = this.parseBinary(selected.precedence + 1);
      left = Object.freeze({
        kind: "binary",
        operator: selected.operator,
        left,
        right,
      });
    }
    return left;
  }

  private parseUnary(): RustCompilerConstExpression {
    if (this.peek("-") || this.peek("!")) {
      const operator = this.tokens[this.index++]!.text;
      return Object.freeze({
        kind: "unary",
        operator: operator === "-" ? "negate" : "not",
        operand: this.parseUnary(),
      });
    }
    return this.parsePrimary();
  }

  private parsePrimary(): RustCompilerConstExpression {
    const token = this.tokens[this.index];
    if (token === undefined) throw new Error("Rust const expression ends before its operand.");
    if (token.text === "(") {
      this.index += 1;
      const expression = this.parseBinary(1);
      this.consume(")");
      return expression;
    }
    if (token.kind === "integer") {
      this.index += 1;
      return Object.freeze({
        kind: "literal",
        literalKind: "integer",
        value: parseInteger(token.text),
      });
    }
    if (token.kind === "character") {
      this.index += 1;
      return Object.freeze({
        kind: "literal",
        literalKind: "character",
        value: decodeRustCharacterLiteral(token.text),
      });
    }
    if (token.kind !== "identifier") {
      throw new Error(`Rust const expression token '${token.text}' is not a supported operand.`);
    }
    const segments = [token.text];
    this.index += 1;
    while (this.peek("::")) {
      this.index += 1;
      const segment = this.tokens[this.index];
      if (segment?.kind !== "identifier") {
        throw new Error("Rust const item path has no identifier after '::'.");
      }
      segments.push(segment.text);
      this.index += 1;
    }
    if (segments.length === 1) {
      const text = segments[0]!;
      if (text === "true" || text === "false") {
        return Object.freeze({ kind: "literal", literalKind: "boolean", value: text === "true" });
      }
      if (text === "_") return Object.freeze({ kind: "inferred" });
      const parameter = this.context.parameters?.get(text);
      if (parameter?.kind === "const") {
        return Object.freeze({
          kind: "parameter",
          identity: parameter.identity,
          displayName: parameter.displayName,
        });
      }
    }
    const identity = exactConstItemIdentity(this.document, this.context, segments);
    if (identity === undefined) {
      throw new Error(`Rust const item '${segments.join("::")}' has no exact rustdoc identity.`);
    }
    return Object.freeze({
      kind: "item",
      identity,
      displayPath: Object.freeze([...segments]),
    });
  }

  private peek(text: string): boolean {
    return this.tokens[this.index]?.text === text;
  }

  private consume(text: string): void {
    const token = this.tokens[this.index];
    if (token?.text !== text) {
      throw new Error(`Rust const expression requires '${text}' at token ${this.index}.`);
    }
    this.index += 1;
  }
}

function exactConstItemIdentity(
  document: RustdocDocument,
  context: RustCompilerNormalizationContext,
  authoredPath: readonly string[],
): RustCompilerItemIdentity | undefined {
  const candidates: RustCompilerItemIdentity[] = [];
  for (const [id, raw] of Object.entries(document.paths)) {
    if (!isRecord(raw) || !Array.isArray(raw.path) ||
      raw.path.some((segment) => typeof segment !== "string") ||
      !constItemKind(raw.kind)) {
      continue;
    }
    const path = raw.path as string[];
    if (!pathsEqual(path, authoredPath)) continue;
    candidates.push(Object.freeze({
      itemId: `${context.dependency.packageId}#${id}`,
      canonicalPath: Object.freeze([...path]),
    }));
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function constItemKind(kind: unknown): boolean {
  return kind === "constant" || kind === "assoc_const" || kind === "associated_constant";
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function tokenize(source: string): readonly Token[] {
  const text = source.trim();
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const code = text[index]!;
    if (/\s/u.test(code)) {
      index += 1;
      continue;
    }
    if (code === "'") {
      const end = scanCharacterLiteral(text, index);
      tokens.push({ kind: "character", text: text.slice(index, end) });
      index = end;
      continue;
    }
    const integer = text.slice(index).match(/^(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9][0-9_]*)(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)?/u)?.[0];
    if (integer !== undefined) {
      tokens.push({ kind: "integer", text: integer });
      index += integer.length;
      continue;
    }
    const identifier = text.slice(index).match(/^(?:r#)?[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
    if (identifier !== undefined) {
      tokens.push({ kind: "identifier", text: identifier });
      index += identifier.length;
      continue;
    }
    const pair = text.slice(index, index + 2);
    if (pair === "::" || pair === "<<" || pair === ">>") {
      tokens.push({ kind: pair === "::" ? "punctuation" : "operator", text: pair });
      index += 2;
      continue;
    }
    if ("+-*/%&|^!".includes(code)) {
      tokens.push({ kind: "operator", text: code });
      index += 1;
      continue;
    }
    if ("(){}".includes(code)) {
      tokens.push({ kind: "punctuation", text: code });
      index += 1;
      continue;
    }
    throw new Error(`Rust const expression contains unsupported token '${code}'.`);
  }
  return Object.freeze(tokens);
}

function scanCharacterLiteral(text: string, start: number): number {
  let index = start + 1;
  let escaped = false;
  while (index < text.length) {
    const code = text[index]!;
    if (!escaped && code === "'") return index + 1;
    if (!escaped && code === "\\") escaped = true;
    else escaped = false;
    index += 1;
  }
  throw new Error("Rust character literal is unterminated.");
}

function parseInteger(text: string): bigint {
  const unsuffixed = text.replace(/(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize)$/u, "").split("_").join("");
  return BigInt(unsuffixed);
}

function decodeRustCharacterLiteral(text: string): string {
  const body = text.slice(1, -1);
  if (!body.startsWith("\\")) {
    if ([...body].length !== 1) throw new Error(`Rust character literal '${text}' is not one Unicode scalar value.`);
    return body;
  }
  if (body.startsWith("\\u{")) {
    const codePoint = Number.parseInt(body.slice(3, -1).split("_").join(""), 16);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff ||
      codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error(`Rust character literal '${text}' has an invalid Unicode scalar value.`);
    }
    return String.fromCodePoint(codePoint);
  }
  const escaped = body.slice(1);
  switch (escaped) {
    case "n": return "\n";
    case "r": return "\r";
    case "t": return "\t";
    case "0": return "\0";
    case "\\": return "\\";
    case "'": return "'";
    case '"': return '"';
    default: throw new Error(`Rust character literal '${text}' has an unsupported escape.`);
  }
}
