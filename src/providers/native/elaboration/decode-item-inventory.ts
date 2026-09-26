import type { RustNativeDefinition, RustNativeDefinitionId, RustNativeStableDefinitionId } from "./evidence.js";
import { nativeDefinitionKey, nativeStableDefinitionKey } from "./evidence.js";
import type { RustNativeScope } from "./scope-model.js";
import { shape, text, unique } from "./decode-values.js";

const itemKinds = new Set([
  "module", "struct", "union", "enum", "trait", "trait-alias", "type-alias", "foreign-type",
  "function", "constant", "static", "associated-function", "associated-constant", "associated-type",
  "macro", "extern-crate", "use", "foreign-module", "global-assembly", "trait-implementation", "inherent-implementation",
]);
const namedScopeKinds = new Set(["module", "enum", "trait"]);
const implementationKinds = new Set(["trait-implementation", "inherent-implementation"]);

export function decodeNativeStableDefinitionId(value: unknown): RustNativeStableDefinitionId {
  const input = shape(value, ["krate", "path"]);
  const krate = text(input.krate);
  const path = text(input.path);
  if (!/^[0-9a-f]{16}$/u.test(krate) || !/^[0-9a-f]{16}$/u.test(path)) {
    throw new Error("Native Rust stable definition identity must contain exact 64-bit hexadecimal components.");
  }
  return Object.freeze({ krate, path });
}

export function validateNativeItemInventory(
  root: RustNativeDefinitionId,
  items: readonly RustNativeDefinitionId[],
  definitions: readonly RustNativeDefinition[],
  scopes: readonly RustNativeScope[],
): void {
  const declarations = new Map(definitions.map(row => [nativeDefinitionKey(row.id), row]));
  const rootKey = nativeDefinitionKey(root);
  const rootDefinition = declarations.get(rootKey);
  if (rootDefinition?.kind !== "module" || rootDefinition.parent !== null) {
    throw new Error("Native Rust item inventory has an invalid crate root.");
  }
  const itemIds = unique(items.map(nativeDefinitionKey), "item owner");
  if (!itemIds.has(rootKey)) throw new Error("Native Rust item inventory omits its crate root.");
  for (const item of items) {
    const definition = declarations.get(nativeDefinitionKey(item));
    if (item.krate !== root.krate || definition === undefined || !itemKinds.has(definition.kind)) {
      throw new Error("Native Rust item inventory has an absent, foreign or non-item owner.");
    }
  }
  unique(definitions.map(row => nativeStableDefinitionKey(row.stable)), "stable definition");
  const stableCrates = new Map<number, string>();
  const crateNumbers = new Map<string, number>();
  const scopeByOwner = new Map(scopes.map(scope => [nativeDefinitionKey(scope.owner), scope]));
  for (const definition of definitions) {
    const krate = definition.id.krate;
    const stable = definition.stable.krate;
    const previousStable = stableCrates.get(krate);
    const previousNumber = crateNumbers.get(stable);
    if ((previousStable !== undefined && previousStable !== stable) ||
      (previousNumber !== undefined && previousNumber !== krate)) {
      throw new Error("Native Rust definition identities contradict their compiler crate identity.");
    }
    stableCrates.set(krate, stable);
    crateNumbers.set(stable, krate);
    if (definition.parent !== null && definition.parent.krate !== krate) {
      throw new Error("Native Rust definition ancestry crosses crate identities.");
    }
    if (krate !== root.krate) continue;
    const key = nativeDefinitionKey(definition.id);
    if (definition.parent === null && key !== rootKey) {
      throw new Error("Native Rust item inventory has more than one local crate root.");
    }
    if (itemKinds.has(definition.kind) && !itemIds.has(key)) {
      throw new Error("Native Rust item inventory omits a local item owner.");
    }
    const scope = scopeByOwner.get(key);
    if ((namedScopeKinds.has(definition.kind) && scope?.kind !== "named") ||
      (implementationKinds.has(definition.kind) && scope?.kind !== "implementation")) {
      throw new Error("Native Rust item inventory omits a complete local scope.");
    }
  }
  for (const scope of scopes) {
    if (scope.owner.krate !== root.krate || !itemIds.has(nativeDefinitionKey(scope.owner))) {
      throw new Error("Native Rust item scope is outside the compiled crate inventory.");
    }
  }
}
