import { emptyRustGenerics, type RustExpr, type RustItem, type RustType, type RustImplFunction } from "../../target-ast/nodes.js";
import type { RustObjectRepresentation } from "../../../analysis/project-types/object-representation.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustStructuralViewIntoRoot } from "../objects/project-structural-roots.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import { planCheckedNativeValueProjection } from "../objects/checked-project-projections.js";

export function planRustNativeValueProjections(
  delegatedVariants: readonly string[],
  projectVariants: readonly { readonly name: string; readonly type: RustType; readonly representation: RustObjectRepresentation }[],
): RustItem {
  const payload: RustType = { kind: "named", path: "Payload" };
  return { kind: "impl", generics: emptyRustGenerics, target: { kind: "named", path: "TsonicError" },
    members: [true, false].map((shared): RustImplFunction => {
      const name = shared ? "native_shared" : "native_value";
      const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = delegatedVariants.map(variant => ({
        pattern: { kind: "tuple-variant", path: `Self::${variant}`, elements: [{ kind: "binding", name: "value" }] },
        expression: { kind: "method-call", receiver: { kind: "path", path: "value" }, method: name,
          genericArguments: [{ kind: "type", type: payload }], args: [] },
      }));
      for (const variant of projectVariants) {
        if (shared === (variant.representation.kind === "value")) continue;
        const value: RustExpr = { kind: "path", path: "value" };
        const root = shared ? rustStructuralViewIntoRoot({ kind: "method-call", receiver: value,
          method: "clone", args: [] }, variant.representation) : undefined;
        if (shared && root === undefined) continue;
        arms.push({ pattern: { kind: "tuple-variant", path: `Self::${variant.name}`,
          elements: [{ kind: "binding", name: "value" }] },
          expression: shared ? rustValueBlock([{ name: "selected", mutable: true, value: { kind: "none" } }],
            { kind: "evaluate-then", discard: "unit", effect: {
              kind: "call", path: "tsonic_rust_runtime::ObjectIdentityCarrier::project_native",
              args: [root!, { kind: "reference", mutable: true, expr: { kind: "path", path: "selected" } }],
            }, value: { kind: "path", path: "selected" } })
            : planCheckedNativeValueProjection(value, variant.type, payload) });
      }
      arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "none" } });
      return { kind: "function", name, visibility: "public",
        selfParam: rustSelfParameter("ref"),
        generics: { parameters: [{ kind: "type", name: "Payload", bounds: [
          shared ? { kind: "maybe-sized" } : { kind: "trait", path: "Clone" },
          { kind: "lifetime", lifetime: { kind: "static" } },
        ] }], wherePredicates: [] },
        params: [], returnType: { kind: "named", path: "Option", genericArguments: [{ kind: "type",
          type: shared ? { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: payload }] } : payload }] },
        body: { statements: [{ kind: "tail", expr: arms.length === 1 ? { kind: "none" }
          : { kind: "match", expression: { kind: "path", path: "self" }, arms } }] },
      };
    }),
  };
}
