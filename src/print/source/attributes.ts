import type { RustAttribute, RustAttributeArgument } from "../../backend/target-ast/attributes.js";
import { indentText } from "./types.js";
import { escapeRustString } from "./patterns.js";

export function printRustAttribute(attribute: RustAttribute, inner = false): string {
  return `#${inner ? "!" : ""}[${printRustAttributeArgument(attribute)}]`;
}

function printRustAttributeArgument(argument: RustAttributeArgument): string {
  switch (argument.kind) {
    case "word": return argument.path;
    case "list": return `${argument.path}(${argument.arguments.map(printRustAttributeArgument).join(", ")})`;
    case "value": return `${argument.path} = ${printRustAttributeArgument(argument.value)}`;
    case "string": return `"${escapeRustString(argument.value)}"`;
    case "integer": return String(argument.value);
    case "boolean": return argument.value ? "true" : "false";
  }
}

export function printRustAttributes(
  attributes: readonly RustAttribute[] | undefined,
  depth: number,
  inner = false,
): string {
  return attributes?.map(attribute => `${indentText(depth)}${printRustAttribute(attribute, inner)}\n`).join("") ?? "";
}
