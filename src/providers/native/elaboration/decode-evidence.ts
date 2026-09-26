import type {
  RustCompilerData, RustNativeDefinition, RustNativeDefinitionId, RustNativeSemanticEvidence,
  RustNativeExpansion, RustNativeNodeId, RustNativeOccurrence, RustNativeSourceSpan, RustNativeTypeRow,
  RustNativeAccess,
} from "./evidence.js";
import { nativeDefinitionKey, nativeNodeKey } from "./evidence.js";
import type { RustNativeSourceLimits } from "./tool.js";

export function decodeNativeEvidence(value: unknown, limits: RustNativeSourceLimits): RustNativeSemanticEvidence {
  let rows = 0;
  const reserve = (): void => {
    if (++rows > limits.maximumRows) throw new Error("Native Rust evidence exceeds the row limit.");
  };
  const data = (value: unknown, depth = 0): RustCompilerData => {
    if (depth > limits.maximumDepth) throw new Error("Native Rust evidence exceeds the depth limit.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(entry => data(entry, depth + 1)));
    const input = record(value);
    const output: { [key: string]: RustCompilerData } = {};
    for (const key of Object.keys(input)) {
      Object.defineProperty(output, key, { value: data(input[key], depth + 1), enumerable: true });
    }
    return Object.freeze(output);
  };
  const identity = (value: unknown): RustNativeDefinitionId => {
    const input = record(value);
    return Object.freeze({ krate: index(input.krate), index: index(input.index) });
  };
  const node = (value: unknown): RustNativeNodeId => {
    const input = record(value);
    return Object.freeze({ owner: identity(input.owner), local: index(input.local) });
  };
  const span = (value: unknown): RustNativeSourceSpan | null => {
    if (value === null) return null;
    const input = record(value);
    const start = index(input.start);
    const end = index(input.end);
    if (end < start) throw new Error("Native Rust evidence has a reversed source span.");
    return Object.freeze({
      file: text(input.file), start, end, expansion: identity(input.expansion),
      context: array(input.context, value => {
        const mark = record(value);
        return Object.freeze({ expansion: identity(mark.expansion),
          transparency: choice(mark.transparency, ["opaque", "semi-opaque", "transparent"] as const) });
      }),
    });
  };
  const input = record(value);
  const phase = choice(input.phase, ["declarations", "checked"] as const);
  if (phase === "declarations" && ("occurrences" in input || "effects" in input)) {
    throw new Error("Native Rust declaration evidence cannot claim checked body evidence.");
  }
  const inputs = array(input.inputs, value => {
    reserve();
    const row = record(value);
    const digest = text(row.digest);
    if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("Native Rust evidence has an invalid input digest.");
    return Object.freeze({ path: text(row.path), byteLength: index(row.byteLength), digest });
  });
  unique(inputs.map(input => input.path), "source input");
  const types = array(input.types, (value): RustNativeTypeRow => {
    reserve();
    const row = record(value);
    return Object.freeze({ id: index(row.id), kind: data(row.kind), signature: data(row.signature) });
  });
  const definitions = array(input.definitions, (value): RustNativeDefinition => {
    reserve();
    const row = record(value);
    return Object.freeze({ id: identity(row.id), publicId: index(row.publicId),
      parent: row.parent === null ? null : identity(row.parent), path: text(row.path),
      name: row.name === null ? null : text(row.name), kind: choice(row.kind, definitionKinds),
      macroKinds: array(row.macroKinds, value => choice(value, ["function-like", "attribute", "derive"] as const)),
      type: row.type === null ? null : index(row.type), generics: data(row.generics), source: span(row.source) });
  });
  const expansions = array(input.expansions, (value): RustNativeExpansion => {
    reserve();
    const row = record(value);
    return Object.freeze({ id: identity(row.id), parent: identity(row.parent),
      kind: choice(row.kind, ["root", "function-like", "attribute", "derive", "compiler-pass", "desugaring"] as const),
      name: text(row.name), definition: row.definition === null ? null : identity(row.definition),
      callSite: span(row.callSite), definitionSite: span(row.definitionSite) });
  });
  const occurrences = phase === "declarations" ? [] : array(input.occurrences, (value): RustNativeOccurrence => {
    reserve();
    const row = record(value);
    let resolution: RustNativeOccurrence["resolution"] = null;
    if (row.resolution !== null) {
      const selected = record(row.resolution);
      switch (choice(selected.kind, ["declaration", "binding"] as const)) {
        case "declaration": resolution = Object.freeze({ kind: "declaration", id: identity(selected.id) }); break;
        case "binding": resolution = Object.freeze({ kind: "binding", id: node(selected.id) }); break;
      }
    }
    return Object.freeze({ id: node(row.id), kind: choice(row.kind, ["expression", "pattern"] as const),
      source: span(row.source), type: index(row.type), adjustedType: index(row.adjustedType), resolution });
  });
  const effects = phase === "declarations" ? [] : array(input.effects, value => {
    reserve();
    const row = record(value);
    return Object.freeze({ owner: identity(row.owner), accesses: array(row.accesses, (value): RustNativeAccess => {
      reserve();
      const access = record(value);
      const inputBase = record(access.base);
      let base: RustNativeAccess["base"];
      switch (choice(inputBase.kind, ["temporary", "static", "local", "capture"] as const)) {
        case "temporary": base = { kind: "temporary" }; break;
        case "static": base = { kind: "static" }; break;
        case "local": base = { kind: "local", binding: node(inputBase.binding) }; break;
        case "capture": base = { kind: "capture", binding: node(inputBase.binding), closure: identity(inputBase.closure) }; break;
      }
      const fake = access.fakeRead === null ? null : record(access.fakeRead);
      const kind = choice(access.kind, ["move", "use-cloned", "copy", "borrow-shared", "borrow-unique-shared",
        "borrow-mutable", "mutate", "bind", "fake-read"] as const);
      if ((kind === "fake-read") !== (fake !== null)) throw new Error("Native Rust evidence has inconsistent fake-read evidence.");
      return Object.freeze({ kind, place: node(access.place), diagnostic: node(access.diagnostic),
        source: span(access.source), base: Object.freeze(base),
        projections: array(access.projections, value => {
          reserve();
          const projection = record(value);
          const kind = choice(projection.kind, ["dereference", "field", "index", "subslice", "opaque-cast", "unwrap-unsafe-binder"] as const);
          return Object.freeze(kind === "field"
            ? { kind, field: index(projection.field), variant: index(projection.variant) } : { kind });
        }),
        fakeRead: fake === null ? null : Object.freeze({
          reason: choice(fake.reason, ["match-guard", "matched-place", "guard-binding", "let", "index"] as const),
          closure: fake.closure === null ? null : identity(fake.closure),
        }),
      });
    }) });
  });
  unique(effects.map(row => nativeDefinitionKey(row.owner)), "effect body");
  const typeIds = unique(types.map(row => String(row.id)), "type");
  const definitionIds = unique(definitions.map(row => nativeDefinitionKey(row.id)), "definition");
  unique(definitions.map(row => String(row.publicId)), "public definition");
  const expansionIds = unique(expansions.map(row => nativeDefinitionKey(row.id)), "expansion");
  const nodeIds = unique(occurrences.map(row => nativeNodeKey(row.id)), "node");
  const requireType = (id: number | null): void => {
    if (id !== null && !typeIds.has(String(id))) throw new Error("Native Rust evidence references an absent type.");
  };
  const requireDefinition = (id: RustNativeDefinitionId | null): void => {
    if (id !== null && !definitionIds.has(nativeDefinitionKey(id))) throw new Error("Native Rust evidence references an absent definition.");
  };
  const requireExpansion = (id: RustNativeDefinitionId): void => {
    if (!expansionIds.has(nativeDefinitionKey(id))) throw new Error("Native Rust evidence references an absent expansion.");
  };
  const requireSpan = (value: RustNativeSourceSpan | null): void => {
    if (value === null) return;
    requireExpansion(value.expansion);
    for (const mark of value.context) requireExpansion(mark.expansion);
  };
  for (const row of definitions) {
    requireDefinition(row.parent);
    requireType(row.type);
    requireSpan(row.source);
  }
  for (const row of expansions) {
    requireExpansion(row.parent);
    requireDefinition(row.definition);
    requireSpan(row.callSite);
    requireSpan(row.definitionSite);
  }
  for (const row of occurrences) {
    requireDefinition(row.id.owner);
    requireType(row.type);
    requireType(row.adjustedType);
    requireSpan(row.source);
    if (row.resolution?.kind === "declaration") requireDefinition(row.resolution.id);
    else if (row.resolution?.kind === "binding" && !nodeIds.has(nativeNodeKey(row.resolution.id))) {
      throw new Error("Native Rust evidence references an absent binding.");
    }
  }
  for (const body of effects) {
    requireDefinition(body.owner);
    for (const access of body.accesses) {
      requireDefinition(access.place.owner);
      requireDefinition(access.diagnostic.owner);
      requireSpan(access.source);
      if (access.base.kind === "capture" || access.base.kind === "local") {
        if (!nodeIds.has(nativeNodeKey(access.base.binding))) throw new Error("Native Rust effects reference an absent binding.");
      }
      if (access.base.kind === "capture") requireDefinition(access.base.closure);
      if (access.fakeRead !== null) requireDefinition(access.fakeRead.closure);
    }
  }
  return phase === "declarations"
    ? Object.freeze({ phase, inputs, types, definitions, expansions })
    : Object.freeze({ phase, inputs, types, definitions, expansions, occurrences, effects });
}

const definitionKinds = [
  "module", "struct", "union", "enum", "variant", "trait", "type-alias", "foreign-type", "trait-alias",
  "associated-type", "type-parameter", "function", "constant", "const-parameter", "static",
  "tuple-struct-constructor", "unit-struct-constructor", "tuple-variant-constructor", "unit-variant-constructor",
  "associated-function", "associated-constant", "macro", "extern-crate", "use", "foreign-module",
  "anonymous-constant", "inline-constant", "opaque-type", "field", "lifetime-parameter", "global-assembly",
  "trait-implementation", "inherent-implementation", "closure", "coroutine-body",
] as const;

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Native Rust evidence requires a structured object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function index(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Native Rust evidence has an invalid index or offset.");
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Native Rust evidence has an invalid string.");
  return value;
}

function choice<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error("Native Rust evidence has an invalid category.");
  return value;
}

function array<Value>(value: unknown, decode: (element: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw new Error("Native Rust evidence requires an array.");
  return Object.freeze(value.map(decode));
}

function unique(values: readonly string[], kind: string): ReadonlySet<string> {
  const result = new Set(values);
  if (result.size !== values.length) throw new Error(`Native Rust evidence has a duplicate ${kind} identity.`);
  return result;
}
