import type { RustGeneratedUnionDefinition } from "../../../analysis/objects/generated-union-plan.js";
import { emptyRustGenerics, type RustExpr, type RustItem, type RustType } from "../../target-ast/nodes.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";

export function planRustNumberArrayUnionImplementation(definition: RustGeneratedUnionDefinition): RustItem {
  const trait = "js_abi::NumberArrayLike";
  const number: RustType = { kind: "primitive", name: "f64" };
  return {
    kind: "impl",
    generics: { parameters: definition.variantNames.map((_, index) => ({
      kind: "type", name: `Payload${index}`, bounds: [{ kind: "trait", path: trait }],
    })), wherePredicates: [] },
    trait: { kind: "named", path: trait },
    target: { kind: "named", path: definition.targetName,
      genericArguments: definition.variantNames.map((_, index) => ({ kind: "type", type: { kind: "named", path: `Payload${index}` } })),
    },
    functions: ["number_array_length", "number_array_get", "number_array_copy"].map(name => {
      const indexed = name === "number_array_get";
      const arguments_: RustExpr[] = [{ kind: "path", path: "value" }, ...(indexed ? [{ kind: "path" as const, path: "index" }] : [])];
      return {
        name, visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"),
        params: indexed ? [{ name: "index", type: number }] : [],
        returnType: indexed ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: number }] }
          : name === "number_array_copy"
            ? { kind: "named", path: "js_abi::JsArray", genericArguments: [{ kind: "type", type: number }] }
            : { kind: "primitive", name: "usize" },
        body: { statements: [{ kind: "tail", expr: {
          kind: "match", expression: { kind: "path", path: "self" },
          arms: definition.variantNames.map(variant => ({
            pattern: { kind: "tuple-variant", path: `Self::${variant}`, elements: [{ kind: "binding", name: "value" }] },
            expression: { kind: "call", path: `${trait}::${name}`, args: arguments_ },
          })),
        } }] },
      };
    }),
  };
}
