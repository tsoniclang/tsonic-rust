import type { RustPattern } from "../../backend/target-ast/nodes.js";
import { printRustMacroInvocation } from "./macro-input.js";

export function printRustPattern(pattern: RustPattern, allowTopAlternation = true): string {
  switch (pattern.kind) {
    case "macro-invocation":
      return printRustMacroInvocation(pattern.path, pattern.input);
    case "wildcard":
      return "_";
    case "binding":
      return `${pattern.mutable ? "mut " : ""}${pattern.name}`;
    case "reference": {
      const inner = printRustPattern(pattern.pattern);
      const grouped = pattern.pattern.kind === "or" || pattern.pattern.kind === "binding" && pattern.pattern.mutable;
      return `&${pattern.mutable ? "mut " : ""}${grouped ? `(${inner})` : inner}`;
    }
    case "path":
      return pattern.path;
    case "tuple": {
      const elements = pattern.elements.map(value => printRustPattern(value)).join(", ");
      return `(${elements}${pattern.elements.length === 1 ? "," : ""})`;
    }
    case "tuple-variant":
      return `${pattern.path}(${pattern.elements.map(value => printRustPattern(value)).join(", ")})`;
    case "or": {
      const printed = pattern.alternatives.map(value => printRustPattern(value)).join(" | ");
      return allowTopAlternation ? printed : `(${printed})`;
    }
  }
}

export function escapeRustString(value: string): string {
  let escaped = "";
  for (const character of value) {
    switch (character) {
      case "\\":
        escaped += "\\\\";
        break;
      case '"':
        escaped += '\\"';
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\t":
        escaped += "\\t";
        break;
      case "\0":
        escaped += "\\0";
        break;
      default:
        escaped += character;
    }
  }
  return escaped;
}

export function escapeRustChar(value: string): string {
  return value === "'" ? "\\'" : escapeRustString(value);
}
