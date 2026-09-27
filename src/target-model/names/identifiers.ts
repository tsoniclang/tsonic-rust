export const rustReservedIdentifiers: ReadonlySet<string> = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
  "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
  "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
  "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
  "where", "while", "abstract", "become", "box", "do", "final", "macro",
  "override", "priv", "try", "typeof", "unsized", "virtual", "yield", "gen",
]);

const rustRawIdentifierForbidden: ReadonlySet<string> = new Set([
  "crate", "self", "Self", "super",
]);
const rustIdentifierPattern = /^(?:_|\p{XID_Start})\p{XID_Continue}*$/u;
const rustRawIdentifierPattern = /^r#(?:_|\p{XID_Start})\p{XID_Continue}*$/u;

export function rustTargetIdentifier(name: string): string {
  if (rustRawIdentifierPattern.test(name)) {
    return name;
  }
  return rustReservedIdentifiers.has(name) && !rustRawIdentifierForbidden.has(name)
    ? `r#${name}`
    : name;
}

export function isValidRustIdentifier(name: string): boolean {
  if (rustRawIdentifierPattern.test(name)) {
    const semanticName = name.slice(2);
    return semanticName !== "_" && !rustRawIdentifierForbidden.has(semanticName);
  }
  return name !== "_" && rustIdentifierPattern.test(name) && !rustReservedIdentifiers.has(name);
}

export function isValidRustAuthoredIdentifier(name: string): boolean {
  return !name.startsWith("r#") && isValidRustIdentifier(rustTargetIdentifier(name));
}

export function rustSnakeCaseIdentifier(sourceName: string): string {
  const words = rustIdentifierWords(sourceName);
  const leadingUnderscore = /^_[^_]/u.test(sourceName) ? "_" : "";
  const value = `${leadingUnderscore}${words.join("_").toLowerCase()}` || "value";
  return generatedIdentifier(/^[0-9]/u.test(value) ? `value_${value}` : value);
}

export function rustPascalCaseIdentifier(sourceName: string): string {
  const words = rustIdentifierWords(sourceName);
  const value = words.map((word) =>
    `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`).join("") || "Value";
  return generatedIdentifier(/^[0-9]/u.test(value) ? `Type${value}` : value);
}

export function rustScreamingSnakeIdentifier(sourceName: string): string {
  const value = rustIdentifierWords(sourceName).join("_").toUpperCase() || "VALUE";
  return generatedIdentifier(/^[0-9]/u.test(value) ? `VALUE_${value}` : value);
}

export function rustModuleSegmentName(sourceName: string): string {
  let value = sourceName
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "module";
  if (
    /^[0-9]/u.test(value) ||
    value === "main" ||
    value === "lib" ||
    value === "mod" ||
    value.startsWith("__tsonic") ||
    rustReservedIdentifiers.has(value)
  ) {
    value = `${value}_module`;
  }
  return value.length <= 120
    ? value
    : value.slice(0, 120).replace(/_+$/u, "");
}

function rustIdentifierWords(sourceName: string): string[] {
  const value = sourceName.startsWith("r#") ? sourceName.slice(2) : sourceName;
  return value
    .replace(/^#+/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word.length > 0);
}

function generatedIdentifier(name: string): string {
  return rustTargetIdentifier(rustRawIdentifierForbidden.has(name) ? `${name}_value` : name);
}
