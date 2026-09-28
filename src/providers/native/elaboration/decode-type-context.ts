import type { RustNativeDefinition, RustNativeDefinitionId, RustNativeTypeRow, RustNativeConstantRow } from "./evidence.js";
import { nativeDefinitionKey } from "./evidence.js";
import { index, shape } from "./decode-values.js";
import { validateNativeGenericRelations } from "./decode-generics.js";

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
      validateNativeGenericRelations(definitions);
    },
  };
}

export type NativeTypeDecodeContext = ReturnType<typeof createNativeTypeDecodeContext>;
