const standardLibraryCrateNames = new Set(["alloc", "core", "std"]);

export interface RustStandardModuleRequest {
  readonly crateName: string;
  readonly modulePath: readonly string[];
}

export function standardModuleSpecifier(
  crateName: string,
  modulePath: readonly string[],
): string {
  requireStandardLibraryCrateName(crateName);
  return `@tsonic/rust/${crateName}/${modulePath.length === 0 ? "index" : modulePath.join("/")}.js`;
}

export function standardModuleRequestFromSpecifier(
  specifier: string,
): RustStandardModuleRequest | undefined {
  const match = /^@tsonic\/rust\/(alloc|core|std)\/(.+)\.js$/u.exec(specifier);
  if (match === null) {
    return undefined;
  }
  const crateName = match[1]!;
  const raw = match[2]!;
  if (raw === "index") {
    return Object.freeze({ crateName, modulePath: Object.freeze([]) });
  }
  const segments = raw.split("/");
  return segments.length > 0 && segments.every(isRustIdentifier)
    ? Object.freeze({ crateName, modulePath: Object.freeze(segments) })
    : undefined;
}

function requireStandardLibraryCrateName(crateName: string): void {
  if (!standardLibraryCrateNames.has(crateName)) {
    throw new Error(`Rust sysroot crate '${crateName}' is not part of the standard provider contract.`);
  }
}

function isRustIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}
