import { hasExactObjectKeys, isDenseDataArray } from "../../../target-model/metadata/closed-data.js";

export function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || !hasExactObjectKeys(value, Object.keys(value))) {
    throw new Error("Native Rust evidence requires a structured object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function shape(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || !hasExactObjectKeys(value, fields)) {
    throw new Error("Native Rust evidence has an invalid record shape.");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function index(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Native Rust evidence has an invalid index or offset.");
  }
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Native Rust evidence has an invalid string.");
  return value;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Native Rust evidence has an invalid boolean.");
  return value;
}

export function unsignedDecimal(value: unknown, bits: 64 | 128): string {
  if (typeof value !== "string" || value.length > (bits === 64 ? 20 : 39) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(value) || BigInt(value) >= 1n << BigInt(bits)) {
    throw new Error("Native Rust evidence has an invalid exact unsigned integer.");
  }
  return value;
}

export function choice<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error("Native Rust evidence has an invalid category.");
  return value;
}

export function array<Value>(value: unknown, decode: (element: unknown) => Value): readonly Value[] {
  if (!isDenseDataArray(value)) throw new Error("Native Rust evidence requires a dense data array.");
  const result: Value[] = [];
  for (let offset = 0; offset < value.length; offset += 1) result.push(decode(value[offset]));
  return Object.freeze(result);
}

export function unique(values: readonly string[], kind: string): ReadonlySet<string> {
  const result = new Set(values);
  if (result.size !== values.length) throw new Error(`Native Rust evidence has a duplicate ${kind} identity.`);
  return result;
}

export function requireAcyclicParents(
  parents: ReadonlyMap<string, string | null>,
  kind: string,
): ReadonlyMap<string, { readonly root: string; readonly depth: number }> {
  const complete = new Map<string, { readonly root: string; readonly depth: number }>();
  for (const start of parents.keys()) {
    const active = new Set<string>();
    let current: string | null | undefined = start;
    while (current !== null && current !== undefined && !complete.has(current)) {
      if (active.has(current)) throw new Error(`Native Rust evidence has a cyclic ${kind} ancestry.`);
      active.add(current);
      current = parents.get(current);
    }
    let ancestry = current === null || current === undefined ? undefined : complete.get(current);
    for (const identity of [...active].reverse()) {
      ancestry = Object.freeze({ root: ancestry?.root ?? identity, depth: (ancestry?.depth ?? -1) + 1 });
      complete.set(identity, ancestry);
    }
  }
  return complete;
}
