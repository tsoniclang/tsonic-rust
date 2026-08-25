import type {
  RustGenerics,
  RustImplFunction,
  RustItem,
  RustType,
} from "../../target-ast/nodes.js";

export function rustDefaultImplementation(
  target: RustType,
  generics: RustGenerics,
  constructor: RustImplFunction,
): RustItem | undefined {
  if (constructor.name !== "new" || constructor.visibility !== "public" ||
    constructor.params.length !== 0 || constructor.generics.parameters.length > 0 ||
    constructor.isAsync === true ||
    constructor.isUnsafe === true || constructor.errorType !== undefined) {
    return undefined;
  }
  return {
    kind: "impl",
    generics,
    trait: { kind: "named", path: "Default" },
    target,
    polarity: "positive",
    safety: "safe",
    attrs: [],
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "default",
      visibility: "private",
      generics: { parameters: [], wherePredicates: [] },
      params: [],
      returnType: { kind: "named", path: "Self" },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "associated-call",
            owner: { kind: "named", path: "Self" },
            method: constructor.name,
            args: [],
          },
        }],
      },
    }],
  };
}
