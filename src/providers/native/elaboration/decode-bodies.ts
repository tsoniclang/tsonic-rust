import type { RustNativeDefinitionId, RustNativeNodeId } from "./evidence.js";
import { nativeDefinitionKey, nativeNodeKey } from "./evidence.js";
import type { RustNativeBody, RustNativeOccurrence } from "./occurrence-model.js";
import { array, requireAcyclicParents, shape, unique } from "./decode-values.js";

export function decodeNativeBodies(
  value: unknown,
  readers: {
    readonly reserve: () => void;
    readonly definition: (value: unknown) => RustNativeDefinitionId;
    readonly node: (value: unknown) => RustNativeNodeId;
  },
): readonly RustNativeBody[] {
  return array(value, value => {
    readers.reserve();
    const body = shape(value, ["owner", "parameters", "value", "locals"]);
    return Object.freeze({
      owner: readers.definition(body.owner),
      value: readers.node(body.value),
      parameters: array(body.parameters, value => { readers.reserve(); return readers.node(value); }),
      locals: array(body.locals, value => {
        readers.reserve();
        const local = shape(value, ["id", "pattern", "initializer"]);
        return Object.freeze({ id: readers.node(local.id), pattern: readers.node(local.pattern),
          initializer: local.initializer === null ? null : readers.node(local.initializer) });
      }),
    });
  });
}

export function validateNativeBodyRelations(
  bodies: readonly RustNativeBody[],
  occurrences: readonly RustNativeOccurrence[],
  requireDefinition: (id: RustNativeDefinitionId) => void,
  requireDepth: (depth: number) => void,
): void {
  unique(bodies.map(body => nativeDefinitionKey(body.owner)), "syntax body");
  const nodes = new Map(occurrences.map(occurrence => [nativeNodeKey(occurrence.id), occurrence]));
  const roots = new Map<string, RustNativeBody>();
  const localIds = new Set<string>();
  const patterns = new Set<string>();
  const initializers = new Set<string>();
  for (const occurrence of occurrences) {
    if (occurrence.parent === null) continue;
    const parent = nodes.get(nativeNodeKey(occurrence.parent));
    if (parent === undefined || nativeDefinitionKey(parent.id.owner) !== nativeDefinitionKey(occurrence.id.owner)) {
      throw new Error("Native Rust occurrence has an absent or cross-owner parent.");
    }
  }
  const ancestry = requireAcyclicParents(new Map(occurrences.map(occurrence => [nativeNodeKey(occurrence.id),
    occurrence.parent === null ? null : nativeNodeKey(occurrence.parent)])), "occurrence");
  for (const entry of ancestry.values()) requireDepth(entry.depth);
  const requireOccurrence = (id: RustNativeNodeId, body: RustNativeBody, kind: RustNativeOccurrence["kind"]) => {
    const occurrence = nodes.get(nativeNodeKey(id));
    if (occurrence === undefined || occurrence.kind !== kind || nativeDefinitionKey(id.owner) !== nativeDefinitionKey(body.value.owner)) {
      throw new Error("Native Rust body relation requires an exact occurrence of the selected kind and owner.");
    }
    return occurrence;
  };
  const root = (id: RustNativeNodeId, body: RustNativeBody, kind: RustNativeOccurrence["kind"]): void => {
    const occurrence = requireOccurrence(id, body, kind);
    const key = nativeNodeKey(id);
    if (occurrence.parent !== null || roots.has(key)) {
      throw new Error("Native Rust body roots must be distinct unparented occurrences.");
    }
    roots.set(key, body);
  };
  for (const body of bodies) {
    requireDefinition(body.owner);
    root(body.value, body, "expression");
    for (const parameter of body.parameters) root(parameter, body, "pattern");
  }
  for (const body of bodies) {
    for (const local of body.locals) {
      const key = nativeNodeKey(local.id);
      const pattern = requireOccurrence(local.pattern, body, "pattern");
      const patternKey = nativeNodeKey(local.pattern);
      if (nativeDefinitionKey(local.id.owner) !== nativeDefinitionKey(body.value.owner) ||
          nodes.has(key) || localIds.has(key) || patterns.has(patternKey) ||
          pattern.parent === null || nodes.get(nativeNodeKey(pattern.parent))?.kind !== "expression" ||
          roots.get(ancestry.get(patternKey)!.root) !== body) {
        throw new Error("Native Rust local declarations require distinct identities and exact expression-owned patterns.");
      }
      localIds.add(key);
      patterns.add(patternKey);
      if (local.initializer !== null) {
        const initializer = requireOccurrence(local.initializer, body, "expression");
        const initializerKey = nativeNodeKey(local.initializer);
        if (initializer.parent === null || nativeNodeKey(initializer.parent) !== nativeNodeKey(pattern.parent) ||
            initializers.has(initializerKey)) {
          throw new Error("Native Rust local initializers must be distinct expressions in their declaration's containment scope.");
        }
        initializers.add(initializerKey);
      }
    }
  }
  for (const occurrence of occurrences) {
    if (!roots.has(ancestry.get(nativeNodeKey(occurrence.id))!.root)) {
      throw new Error("Native Rust occurrence has no owning syntax body.");
    }
  }
}
