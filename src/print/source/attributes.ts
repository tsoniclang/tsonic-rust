import type { RustAttribute } from "../../backend/target-ast/attributes.js";
import { indentText } from "./types.js";
import { printRustTokenStream } from "./macro-input.js";

export function printRustAttribute(attribute: RustAttribute, inner = false): string {
  const separator = attribute.tokens.length === 0 || attribute.tokens[0]!.kind === "group" ? "" : " ";
  return `#${inner ? "!" : ""}[${attribute.path}${separator}${printRustTokenStream(attribute.tokens)}]`;
}

export function printRustAttributes(
  attributes: readonly RustAttribute[] | undefined,
  depth: number,
  inner = false,
): string {
  return attributes?.map(attribute => `${indentText(depth)}${printRustAttribute(attribute, inner)}\n`).join("") ?? "";
}
