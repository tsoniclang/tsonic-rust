const rustCompilerBigIntWireKey = "$tsonicRustCompilerBigInt";
const canonicalIntegerPattern = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;

export function stringifyRustCompilerWireValue(value: unknown): string {
  return JSON.stringify(value, (_key, selected: unknown) =>
    typeof selected === "bigint"
      ? Object.freeze({ [rustCompilerBigIntWireKey]: selected.toString() })
      : selected);
}

export function parseRustCompilerWireText(text: string): unknown {
  return JSON.parse(text, (_key, selected: unknown) => {
    if (!isRecord(selected) || !(rustCompilerBigIntWireKey in selected)) return selected;
    const keys = Object.keys(selected);
    const encoded = selected[rustCompilerBigIntWireKey];
    if (keys.length !== 1 || typeof encoded !== "string" ||
      !canonicalIntegerPattern.test(encoded)) {
      throw new Error("Rust compiler-provider wire data has an invalid bigint encoding.");
    }
    return BigInt(encoded);
  }) as unknown;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
