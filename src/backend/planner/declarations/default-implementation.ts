import type {
  RustGenerics,
  RustItem,
  RustType,
} from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";

export function rustDefaultImplementation(
  target: RustType,
  generics: RustGenerics,
  constructorName: string | undefined,
): RustItem | undefined {
  if (constructorName === undefined) return undefined;
  return {
    kind: "impl",
    generics,
    trait: { kind: "named", path: "Default" },
    target,
    members: [{ kind: "function",
      name: "default",
      visibility: "public",
      generics: emptyRustGenerics,
      params: [],
      returnType: { kind: "named", path: "Self" },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "associated-call",
            owner: { kind: "named", path: "Self" },
            method: constructorName,
            args: [],
          },
        }],
      },
    }],
  };
}
