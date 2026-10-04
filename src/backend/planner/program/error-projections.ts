import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem } from "../../target-ast/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import type { RustErrorTransportPlan } from "./error-transport.js";

export function planRustErrorProjectionTransport(plan: RustErrorTransportPlan): readonly RustItem[] {
  const types = [plan.fullTransportType, plan.sourceErrorType, plan.writableSourceErrorType];
  return types.filter((type, index) => !types.slice(0, index).some(previous => rustTypeEquals(type, previous)))
    .map(type => ({ kind: "impl", generics: emptyRustGenerics, target: type,
      members: [false, true].map(owned => projectionFunction(owned, { kind: "match", expression: { kind: "path", path: "self" },
          arms: [
            ...plan.variants.filter(item => item.source !== "thrown").map(item => {
              const error: RustExpr = { kind: "path", path: "error" };
              const dispatch: RustExpr = { kind: "field", receiver: error, name: "dispatch" };
              const receiver = item.source === "external" ? error : owned ? dispatch
                : { kind: "method-call" as const, receiver: dispatch, method: "clone", args: [] };
              return { pattern: { kind: "tuple-variant" as const, path: `ErrorTransport::${item.name}`,
                elements: [{ kind: "binding" as const, name: "error" }] }, expression: {
                kind: "method-call" as const, receiver,
                method: item.source === "external" && owned ? "into_project_error" : "project_error",
                args: [{ kind: "path" as const, path: "output" }],
              } };
            }),
            { pattern: { kind: "wildcard" }, expression: { kind: "tuple-literal", elements: [] } },
          ] })),
    }));
}

export function planRustSourceErrorProjectionDelegates(): readonly RustItem[] {
  return ["SourceError", "WritableSourceError"].map(name => ({ kind: "impl", generics: emptyRustGenerics,
    target: { kind: "named", path: name }, members: [false, true].map(owned => projectionFunction(owned, { kind: "method-call",
        receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: "value" },
        method: owned ? "into_project_error" : "project_error", args: [{ kind: "path", path: "output" }],
      })) }));
}

function projectionFunction(owned: boolean, value: RustExpr): RustImplFunction {
  return { kind: "function", name: owned ? "into_project_error" : "project_error", visibility: "public",
    generics: emptyRustGenerics, selfParam: owned ? { kind: "value" } : { kind: "reference", mutable: false },
    params: [{ name: "output", type: { kind: "reference", mutable: true, referent: {
      kind: "trait-object", principal: { trait: { kind: "named", path: "core::any::Any" } }, autoTraits: [],
    } } }],
    body: { statements: [{ kind: "tail", expr: value }] },
  };
}
