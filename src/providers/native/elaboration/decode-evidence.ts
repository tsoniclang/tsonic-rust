import type {
  RustNativeDefinition, RustNativeDefinitionId, RustNativeSemanticEvidence,
  RustNativeExpansion, RustNativeNodeId, RustNativeSourceSpan, RustNativeTypeRow,
  RustNativeAccess, RustNativeConstantRow,
} from "./evidence.js";
import { isAbsolute } from "node:path";
import { nativeDefinitionKey, nativeNodeKey } from "./evidence.js";
import { validateRustNativeSourceLimits } from "./limits.js";
import type { RustNativeSourceLimits } from "./limits.js";
import { createNativeTypeDecodeContext } from "./decode-type-context.js";
import { createNativeRegionDecoder } from "./decode-regions.js";
import { createNativeGenericDecoder } from "./decode-generics.js";
import { createNativeTypeDecoder } from "./decode-types.js";
import { createNativeConstantDecoder } from "./decode-constants.js";
import { createNativeScopeDecoder, validateNativeScopeRelations } from "./decode-scopes.js";
import { createNativeOccurrenceDecoder } from "./decode-occurrences.js";
import { array, boolean, choice, index, record, requireAcyclicParents, shape, text, unique } from "./decode-values.js";

export function decodeNativeEvidence(value: unknown, limits: RustNativeSourceLimits): RustNativeSemanticEvidence {
  validateRustNativeSourceLimits(limits);
  let rows = 0;
  const reserve = (): void => {
    if (++rows > limits.maximumRows) throw new Error("Native Rust evidence exceeds the row limit.");
  };
  const graph = createNativeTypeDecodeContext(reserve, limits.maximumDepth);
  const regions = createNativeRegionDecoder(graph);
  const generics = createNativeGenericDecoder(graph, regions);
  const decodeType = createNativeTypeDecoder(graph, regions, generics);
  const decodeConstant = createNativeConstantDecoder(graph, regions, generics);
  const identity = (value: unknown): RustNativeDefinitionId => {
    const input = shape(value, ["krate", "index"]);
    return Object.freeze({ krate: index(input.krate), index: index(input.index) });
  };
  const node = (value: unknown): RustNativeNodeId => {
    const input = shape(value, ["owner", "local"]);
    return Object.freeze({ owner: identity(input.owner), local: index(input.local) });
  };
  const span = (value: unknown): RustNativeSourceSpan | null => {
    if (value === null) return null;
    reserve();
    const input = shape(value, ["file", "start", "end", "expansion", "context"]);
    const start = index(input.start);
    const end = index(input.end);
    if (end < start) throw new Error("Native Rust evidence has a reversed source span.");
    return Object.freeze({
      file: text(input.file), start, end, expansion: identity(input.expansion),
      context: array(input.context, value => {
        reserve();
        const mark = shape(value, ["expansion", "transparency"]);
        return Object.freeze({ expansion: identity(mark.expansion),
          transparency: choice(mark.transparency, ["opaque", "semi-opaque", "transparent"] as const) });
      }),
    });
  };
  const scopeDecoder = createNativeScopeDecoder(graph, generics, span);
  const input = record(value);
  const phase = choice(input.phase, ["declarations", "checked"] as const);
  if (phase === "declarations" && ("occurrences" in input || "effects" in input)) {
    throw new Error("Native Rust declaration evidence cannot claim checked body evidence.");
  }
  shape(input, phase === "checked" ? ["phase", "inputs", "probes", "types", "constants", "definitions", "scopes", "expansions", "occurrences", "effects"] :
    ["phase", "inputs", "probes", "types", "constants", "definitions", "scopes", "expansions"]);
  const inputs = array(input.inputs, value => {
    reserve();
    const row = shape(value, ["path", "byteLength", "digest"]);
    const digest = text(row.digest);
    if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("Native Rust evidence has an invalid input digest.");
    return Object.freeze({ path: sourcePath(row.path), byteLength: index(row.byteLength), digest });
  });
  unique(inputs.map(input => input.path), "source input");
  const probes = array(input.probes, value => {
    reserve();
    const row = shape(value, ["path", "exists"]);
    return Object.freeze({ path: sourcePath(row.path), exists: boolean(row.exists) });
  });
  unique(probes.map(probe => probe.path), "source lookup");
  const missingPaths = new Set(probes.filter(probe => !probe.exists).map(probe => probe.path));
  if (inputs.some(input => missingPaths.has(input.path))) {
    throw new Error("Native Rust evidence contradicts a source lookup.");
  }
  const types = array(input.types, (value): RustNativeTypeRow => {
    reserve();
    const row = shape(value, ["id", "value"]);
    return Object.freeze({ id: index(row.id), value: decodeType(row.value) });
  });
  const constants = array(input.constants, (value): RustNativeConstantRow => {
    reserve();
    const row = shape(value, ["id", "value"]);
    return Object.freeze({ id: index(row.id), value: decodeConstant(row.value) });
  });
  const definitions = array(input.definitions, (value): RustNativeDefinition => {
    reserve();
    const row = shape(value, ["id", "parent", "path", "name", "kind", "macroKinds", "type", "generics", "visibility", "source"]);
    return Object.freeze({ id: identity(row.id),
      parent: row.parent === null ? null : identity(row.parent), path: text(row.path),
      name: row.name === null ? null : text(row.name), kind: choice(row.kind, definitionKinds),
      macroKinds: array(row.macroKinds, value => choice(value, ["function-like", "attribute", "derive"] as const)),
      type: row.type === null ? null : index(row.type), generics: generics.generics(row.generics),
      visibility: row.visibility === null ? null : scopeDecoder.visibility(row.visibility), source: span(row.source) });
  });
  const scopes = array(input.scopes, scopeDecoder.scope);
  const expansions = array(input.expansions, (value): RustNativeExpansion => {
    reserve();
    const row = record(value);
    return Object.freeze({ id: identity(row.id), parent: identity(row.parent),
      kind: choice(row.kind, ["root", "function-like", "attribute", "derive", "compiler-pass", "desugaring"] as const),
      name: text(row.name), definition: row.definition === null ? null : identity(row.definition),
      callSite: span(row.callSite), definitionSite: span(row.definitionSite) });
  });
  const occurrences = phase === "declarations" ? []
    : array(input.occurrences, createNativeOccurrenceDecoder(graph, generics, { node, span }));
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
  unique(constants.map(row => String(row.id)), "constant");
  const definitionIds = unique(definitions.map(row => nativeDefinitionKey(row.id)), "definition");
  graph.validate(types, constants, definitions);
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
  validateNativeScopeRelations(scopes, definitions, requireSpan);
  for (const row of expansions) {
    requireExpansion(row.parent);
    requireDefinition(row.definition);
    requireSpan(row.callSite);
    requireSpan(row.definitionSite);
    if (row.kind === "root" && nativeDefinitionKey(row.id) !== nativeDefinitionKey(row.parent)) {
      throw new Error("Native Rust root expansion has an invalid parent.");
    }
  }
  requireAcyclicParents(new Map(definitions.map(row => [nativeDefinitionKey(row.id), row.parent === null ? null : nativeDefinitionKey(row.parent)])), "definition");
  requireAcyclicParents(new Map(expansions.map(row => [nativeDefinitionKey(row.id), row.kind === "root" ? null : nativeDefinitionKey(row.parent)])), "expansion");
  for (const row of occurrences) {
    requireDefinition(row.id.owner);
    requireType(row.type);
    if (row.kind === "expression") requireType(row.adjustedType);
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
    ? Object.freeze({ phase, inputs, probes, types, constants, definitions, scopes, expansions })
    : Object.freeze({ phase, inputs, probes, types, constants, definitions, scopes, expansions, occurrences, effects });
}

const definitionKinds = [
  "module", "struct", "union", "enum", "variant", "trait", "type-alias", "foreign-type", "trait-alias",
  "associated-type", "type-parameter", "function", "constant", "const-parameter", "static",
  "tuple-struct-constructor", "unit-struct-constructor", "tuple-variant-constructor", "unit-variant-constructor",
  "associated-function", "associated-constant", "macro", "extern-crate", "use", "foreign-module",
  "anonymous-constant", "inline-constant", "opaque-type", "field", "lifetime-parameter", "global-assembly",
  "trait-implementation", "inherent-implementation", "closure", "coroutine-body",
] as const;

function sourcePath(value: unknown): string {
  const path = text(value);
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("Native Rust evidence has an invalid source input path.");
  return path;
}
