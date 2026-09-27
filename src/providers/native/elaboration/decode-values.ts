export function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Native Rust evidence requires a structured object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function shape(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  const input = record(value);
  const keys = Object.keys(input);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) {
    throw new Error("Native Rust evidence has an invalid record shape.");
  }
  return input;
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

export function choice<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error("Native Rust evidence has an invalid category.");
  return value;
}

export function array<Value>(value: unknown, decode: (element: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw new Error("Native Rust evidence requires an array.");
  return Object.freeze(value.map(decode));
}

export function unique(values: readonly string[], kind: string): ReadonlySet<string> {
  const result = new Set(values);
  if (result.size !== values.length) throw new Error(`Native Rust evidence has a duplicate ${kind} identity.`);
  return result;
}

export function requireAcyclicParents(parents: ReadonlyMap<string, string | null>, kind: string): void {
  const complete = new Set<string>();
  for (const start of parents.keys()) {
    const active = new Set<string>();
    let current: string | null | undefined = start;
    while (current !== null && current !== undefined && !complete.has(current)) {
      if (active.has(current)) throw new Error(`Native Rust evidence has a cyclic ${kind} ancestry.`);
      active.add(current);
      current = parents.get(current);
    }
    for (const identity of active) complete.add(identity);
  }
}
