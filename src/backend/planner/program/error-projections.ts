import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem } from "../../target-ast/syntax/nodes.js";
import type { RustErrorTransportPlan } from "./error-transport.js";
import { rustCheckedNativeProjectionOutputParameter } from "../objects/checked-project-projections.js";

export function planRustErrorProjectionTransport(plan: RustErrorTransportPlan): readonly RustItem[] {
  // One impl per distinct type: identical spellings would be conflicting implementations.
  const types = [plan.fullTransportType,
    ...(plan.variants.some(item => item.source === "thrown" || item.source === "external" && item.transport === "package")
      ? [plan.sourceErrorType] : []),
    plan.writableSourceErrorType].filter((type, index, all) => !all.slice(0, index).some(previous => rustTypeEquals(type, previous)));
  const projections = plan.variants.filter(item => item.source !== "thrown");
  const unit: RustExpr = { kind: "tuple-literal", elements: [] };
  return types.map(type => ({ kind: "impl", generics: emptyRustGenerics, target: type,
      members: [false, true].map(owned => {
        const arms = projections.map(item => {
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
        });
        const expression: RustExpr = { kind: "path", path: "self" };
        const value: RustExpr = arms.length === 0 ? unit : arms.length === 1
          ? { kind: "if-let", expression, pattern: arms[0]!.pattern,
              whenTrue: { kind: "block", body: { statements: [{ kind: "expr", expr: arms[0]!.expression }] } } }
          : { kind: "match", expression, arms: [...arms, { pattern: { kind: "wildcard" }, expression: unit }] };
        return projectionFunction(owned, value, arms.length !== 0);
      }),
    }));
}

export function planRustSourceErrorProjectionDelegates(): readonly RustItem[] {
  return ["SourceError", "WritableSourceError"].map(name => ({ kind: "impl", generics: emptyRustGenerics,
    target: { kind: "named", path: name }, members: [false, true].map(owned => projectionFunction(owned, { kind: "method-call",
        receiver: { kind: "field", receiver: { kind: "path", path: "self" }, name: "value" },
        method: owned ? "into_project_error" : "project_error", args: [{ kind: "path", path: "output" }],
      })) }));
}

// Without projection arms the body never reads `output`; the parameter is then named `_output` (unused_variables).
function projectionFunction(owned: boolean, value: RustExpr, readsOutput = true): RustImplFunction {
  const output = rustCheckedNativeProjectionOutputParameter();
  return { kind: "function", name: owned ? "into_project_error" : "project_error", visibility: "public",
    generics: emptyRustGenerics, selfParam: owned ? { kind: "value" } : { kind: "reference", mutable: false },
    params: [readsOutput ? output : { ...output, name: "_output" }],
    body: { statements: [{ kind: "tail", expr: value }] },
  };
}
