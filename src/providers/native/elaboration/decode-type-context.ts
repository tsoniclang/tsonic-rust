import type { RustNativeDefinition, RustNativeDefinitionId, RustNativeTypeRow, RustNativeConstantRow } from "./evidence.js";
import { nativeDefinitionKey } from "./evidence.js";
import { index, requireAcyclicParents, shape } from "./decode-values.js";

export function createNativeTypeDecodeContext(reserve: () => void, maximumDepth: number) {
  const typeReferences = new Set<number>();
  const constantReferences = new Set<number>();
  const definitionReferences: { readonly id: RustNativeDefinitionId; readonly kinds?: readonly string[] }[] = [];
  const type = (value: unknown): number => { reserve(); const id = index(value); typeReferences.add(id); return id; };
  const constant = (value: unknown): number => { reserve(); const id = index(value); constantReferences.add(id); return id; };
  const definition = (value: unknown, kinds?: readonly string[]): RustNativeDefinitionId => {
    reserve();
    const input = shape(value, ["krate", "index"]);
    const id = Object.freeze({ krate: index(input.krate), index: index(input.index) });
    definitionReferences.push({ id, ...(kinds === undefined ? {} : { kinds }) });
    return id;
  };
  return {
    reserve, type, constant, definition,
    depth(value: number): void {
      if (value > maximumDepth) throw new Error("Native Rust evidence exceeds the depth limit.");
    },
    validate(types: readonly RustNativeTypeRow[], constants: readonly RustNativeConstantRow[], definitions: readonly RustNativeDefinition[]): void {
      const typeIds = new Set(types.map(type => type.id));
      const constantIds = new Set(constants.map(constant => constant.id));
      const definitionIds = new Map(definitions.map(definition => [nativeDefinitionKey(definition.id), definition]));
      for (const id of typeReferences) if (!typeIds.has(id)) throw new Error("Native Rust evidence references an absent type.");
      for (const id of constantReferences) if (!constantIds.has(id)) throw new Error("Native Rust evidence references an absent constant.");
      for (const reference of definitionReferences) {
        const target = definitionIds.get(nativeDefinitionKey(reference.id));
        if (target === undefined) throw new Error("Native Rust evidence references an absent definition.");
        if (reference.kinds !== undefined && !reference.kinds.includes(target.kind)) {
          throw new Error("Native Rust evidence references the wrong definition kind.");
        }
      }
      for (const field of ["parent", "predicatesParent"] as const) {
        requireAcyclicParents(new Map(definitions.map(definition => {
          const parent = definition.generics?.[field];
          return [nativeDefinitionKey(definition.id), parent === null || parent === undefined ? null : nativeDefinitionKey(parent)];
        })), `generic ${field}`);
      }
      for (const definition of definitions) {
        const generics = definition.generics;
        if (generics === null) continue;
        const parent = generics.parent === null ? undefined : definitionIds.get(nativeDefinitionKey(generics.parent));
        const expected = parent?.generics === undefined || parent.generics === null
          ? 0 : parent.generics.parentCount + parent.generics.parameters.length;
        if (generics.parentCount !== expected) throw new Error("Native Rust evidence has an inconsistent generic parent count.");
        for (const [position, parameter] of generics.parameters.entries()) {
          if (parameter.index !== generics.parentCount + position) throw new Error("Native Rust evidence has inconsistent generic parameter ordering.");
        }
      }
    },
  };
}

export type NativeTypeDecodeContext = ReturnType<typeof createNativeTypeDecodeContext>;
