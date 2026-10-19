export function selectRustEnumConstantRepresentation(values: readonly bigint[]): "enum" | "constants" {
  return values.length === 0 || new Set(values).size !== values.length ? "constants" : "enum";
}
