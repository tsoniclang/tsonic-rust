import type {
  RustImplFunction,
  RustItem,
  RustType,
  RustTypeParameter,
} from "../../target-ast/nodes.js";

export function rustDefaultImplementation(
  target: RustType,
  typeParams: readonly RustTypeParameter[] | undefined,
  constructor: RustImplFunction,
): RustItem | undefined {
  if (constructor.name !== "new" || constructor.visibility !== "public" ||
    constructor.params.length !== 0 || (constructor.typeParams?.length ?? 0) > 0 ||
    constructor.isAsync === true ||
    constructor.isUnsafe === true || constructor.errorType !== undefined) {
    return undefined;
  }
  return {
    kind: "impl",
    ...(typeParams === undefined || typeParams.length === 0 ? {} : { typeParams }),
    trait: { kind: "named", path: "Default" },
    target,
    functions: [{
      name: "default",
      visibility: "public",
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
