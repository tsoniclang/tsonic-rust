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
