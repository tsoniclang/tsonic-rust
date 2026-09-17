import type { RustType } from "../../../target-ast/nodes.js";

export function rustArrayFieldMutationName(readSlot: string): string {
  return `mutate_${readSlot}`;
}

export function rustArrayFieldMutationType(array: RustType): RustType {
  return {
    kind: "reference", mutable: true, referent: {
      kind: "trait-object", autoTraits: [], principal: { trait: {
        kind: "callable-trait", trait: "FnMut",
        parameters: [{ kind: "reference", mutable: true, referent: array }],
        result: { kind: "unit" },
      } },
    },
  };
}
