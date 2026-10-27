import type { RustGeneratedUnionDefinition } from "../../../target-model/records/types/generated-unions.js";
import { rustNumberArrayLikeMembers } from "../../../target-model/records/types/generated-unions.js";
import { emptyRustGenerics, type RustExpr, type RustItem, type RustType } from "../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";

export function planRustNumberArrayUnionImplementation(definition: RustGeneratedUnionDefinition): RustItem {
  const trait = "js_abi::NumberArrayLike";
  const number: RustType = { kind: "primitive", name: "f64" };
  return {
    kind: "impl",
    generics: { parameters: definition.payloadTemplate.payloadParameters.map(({ parameter }) => ({
      kind: "type", name: parameter.name, bounds: [{ kind: "trait", path: trait }],
    })), wherePredicates: [] },
    trait: { kind: "named", path: trait },
    target: { kind: "named", path: definition.targetName,
      genericArguments: definition.payloadTemplate.payloadParameters.map(({ parameter }) => ({ kind: "type", type: { kind: "named", path: parameter.name } })),
    },
    members: rustNumberArrayLikeMembers.map(({ name, indexed, result }) => {
      const arguments_: RustExpr[] = [{ kind: "path", path: "value" }, ...(indexed ? [{ kind: "path" as const, path: "index" }] : [])];
      return { kind: "function",
        name, visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"),
        params: indexed ? [{ name: "index", type: number }] : [],
        returnType: result === "optional-number" ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: number }] }
          : result === "number-array"
            ? { kind: "named", path: "js_abi::JsArray", genericArguments: [{ kind: "type", type: number }] }
            : { kind: "primitive", name: "usize" },
        body: { statements: [{ kind: "tail", expr: {
          kind: "match", expression: { kind: "path", path: "self" },
          arms: definition.payloadTemplate.variants.map(variant => ({
            pattern: { kind: "tuple-variant", path: `Self::${variant.name}`, elements: [{ kind: "binding", name: "value" }] },
            expression: { kind: "call", path: `${trait}::${name}`, args: arguments_ },
          })),
        } }] },
      };
    }),
  };
}
