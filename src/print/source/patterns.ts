import type { RustPattern } from "../../backend/target-ast/nodes.js";

export function printRustPattern(pattern: RustPattern): string {
  switch (pattern.kind) {
    case "wildcard":
      return "_";
    case "binding":
      return pattern.name;
    case "path":
      return pattern.path;
    case "tuple": {
      const elements = pattern.elements.map(printRustPattern).join(", ");
      return `(${elements}${pattern.elements.length === 1 ? "," : ""})`;
    }
    case "tuple-variant":
      return `${pattern.path}(${pattern.elements.map(printRustPattern).join(", ")})`;
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
