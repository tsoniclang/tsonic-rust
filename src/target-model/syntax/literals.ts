function normalizeIntegerLiteral(text: string, bigintSuffix: boolean): string | undefined {
  const withoutSeparators = text.split("_").join("");
  if (bigintSuffix && !withoutSeparators.endsWith("n")) {
    return undefined;
  }
  const normalized = bigintSuffix
    ? withoutSeparators.slice(0, -1)
    : withoutSeparators;
  if (/^[0-9]+$/u.test(normalized) ||
    /^0[xX][0-9a-fA-F]+$/u.test(normalized) ||
    /^0[oO][0-7]+$/u.test(normalized) ||
    /^0[bB][01]+$/u.test(normalized)) {
    return normalized;
  }
  return undefined;
}

export function parseSourceIntegerLiteral(text: string): bigint | undefined {
  const normalized = normalizeIntegerLiteral(text, false);
  return normalized === undefined ? undefined : BigInt(normalized);
}

export function parseSourceBigIntLiteral(text: string): bigint | undefined {
  const normalized = normalizeIntegerLiteral(text, true);
  return normalized === undefined ? undefined : BigInt(normalized);
}

export function sourceCharCodeUnit(value: string): number | undefined {
  return value.length === 1 ? value.charCodeAt(0) : undefined;
}

export function singleRustUnicodeScalar(value: string): string | undefined {
  const characters = Array.from(value);
  if (characters.length !== 1) return undefined;
  const selected = characters[0];
  const codePoint = selected?.codePointAt(0);
  return selected === undefined || codePoint === undefined ||
      codePoint >= 0xd800 && codePoint <= 0xdfff
    ? undefined
    : selected;
}
