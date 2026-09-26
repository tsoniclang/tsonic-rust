export interface RustNativeSourceLimits {
  readonly maximumRows: number;
  readonly maximumDepth: number;
  readonly maximumOutputBytes: number;
  readonly timeoutMilliseconds: number;
}

export const defaultRustNativeSourceLimits: RustNativeSourceLimits = Object.freeze({
  maximumRows: 1_048_576,
  maximumDepth: 256,
  maximumOutputBytes: 64 * 1024 * 1024,
  timeoutMilliseconds: 120_000,
});

const ceilings: RustNativeSourceLimits = Object.freeze({
  maximumRows: 4_194_304,
  maximumDepth: 512,
  maximumOutputBytes: 256 * 1024 * 1024,
  timeoutMilliseconds: 3_600_000,
});

export function validateRustNativeSourceLimits(limits: RustNativeSourceLimits): void {
  if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
    throw new Error("Native Rust source limits require an exact finite budget selection.");
  }
  const fields = Object.keys(ceilings) as readonly (keyof RustNativeSourceLimits)[];
  const keys = Object.keys(limits);
  if (keys.length !== fields.length || keys.some(key => !Object.hasOwn(ceilings, key))) {
    throw new Error("Native Rust source limits require exactly the supported budget fields.");
  }
  for (const name of fields) {
    const value = limits[name];
    const ceiling = ceilings[name];
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) {
      throw new Error(`Native Rust source ${name} must be a positive integer no larger than ${ceiling}.`);
    }
  }
}
