import { emptyRustGenerics, type RustItem, type RustType } from "../../target-ast/nodes.js";
import type { RustErrorTransportVariant } from "./error-transport.js";

export function planRustClosedThrowAdmission(variants: readonly RustErrorTransportVariant[]): readonly RustItem[] {
  const target: RustType = { kind: "named", path: "TsonicError" };
  return variants.map(variant => ({ kind: "impl", generics: emptyRustGenerics, target,
    trait: { kind: "named", path: "core::convert::From", genericArguments: [{ kind: "type", type: variant.type }] },
    members: [{ kind: "function", name: "from", visibility: "private", generics: emptyRustGenerics,
      params: [{ name: "value", type: variant.type }], returnType: { kind: "named", path: "Self" },
      body: { statements: [{ kind: "tail", expr: {
        kind: "match", expression: { kind: "method-call", receiver: { kind: "path", path: "value" }, method: "into_error", args: [] },
        arms: [{ pattern: { kind: "tuple-variant", path: "Ok", elements: [{ kind: "binding", name: "error" }] },
          expression: { kind: "call", path: "Self::Retained", args: [{ kind: "path", path: "error" }] } },
        { pattern: { kind: "tuple-variant", path: "Err", elements: [{ kind: "binding", name: "value" }] },
          expression: { kind: "call", path: `Self::${variant.name}`, args: [{ kind: "path", path: "value" }] } }],
      } }] },
    }],
  }));
}
