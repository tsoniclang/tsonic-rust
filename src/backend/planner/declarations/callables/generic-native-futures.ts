import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../../analysis/callables/generic-values.js";
import type { RustGenericCallableEffectsFact } from "../../../../analysis/facts/generic-callable-effects.js";
import type { RustExpr, RustItem, RustPattern, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";

export interface RustGenericNativeFutureInvocation {
  readonly implementation: RustGenericCallableImplementation;
  readonly pattern: RustPattern;
  readonly call: RustExpr;
  readonly effects: RustGenericCallableEffectsFact;
  readonly optional: boolean;
  readonly absent: boolean;
}

export function planRustGenericNativeFutureDispatch(input: {
  readonly definition: RustGenericCallableDefinition;
  readonly output: RustType;
  readonly error?: RustType;
  readonly effects: RustGenericCallableEffectsFact;
  readonly optional: boolean;
  readonly captures: readonly Extract<RustType, { readonly kind: "named" }>[];
  readonly invocations: readonly RustGenericNativeFutureInvocation[];
}): { readonly items: readonly RustItem[]; readonly returnType: RustType; readonly body: Extract<RustItem, { readonly kind: "function" }>["body"] } | undefined {
  const { definition, effects, invocations } = input;
  const name = definition.nativeFutureDispatchName;
  if (name === undefined || invocations.length !== definition.implementations.length ||
    effects.awaiting === "not-applicable" || (effects.invocation === "fallible" || effects.awaiting === "fallible") && input.error === undefined ||
    invocations.some(invocation => invocation.effects.awaiting === "not-applicable" || invocation.absent && !input.optional ||
      invocation.effects.invocation === "fallible" && effects.invocation !== "fallible" ||
      !invocation.absent && invocation.effects.awaiting === "fallible" && effects.awaiting !== "fallible")) return undefined;
  const futureOutput = effects.awaiting === "fallible" ? resultType(input.output, input.error!) : input.output;
  const active = invocations.filter(invocation => !invocation.absent);
  const wrapping = (value: RustExpr): RustExpr => effects.invocation === "fallible"
    ? { kind: "call", path: "Ok", args: [value] } : value;
  const absent: RustExpr = wrapping({ kind: "path", path: "None" });
  const ready: RustType = { kind: "named", path: "core::future::Ready", genericArguments: [{ kind: "type", type: futureOutput }] };
  if (active.length === 0) {
    return { items: [], returnType: returnedType(ready), body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: invocations.map(invocation => ({
        pattern: invocation.pattern, expression: { kind: "evaluate-then", effect: invoked(invocation), discard: "value", value: absent },
      })),
    } }] } };
  }
  const futureType: RustType = { kind: "impl-trait", bounds: [{ kind: "trait-type", reference: { trait: {
    kind: "named", path: "core::future::Future", genericArguments: [
      { kind: "associated-equality", name: "Output", genericArguments: [], type: futureOutput },
    ],
  } } }], outlives: [], captures: input.captures.map(type => ({ kind: "type", type })) };
  if (active.length === 1) {
    return { items: [], returnType: returnedType(futureType), body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: invocations.map(invocation => {
        const call = invoked(invocation);
        return { pattern: invocation.pattern, expression: invocation.absent
          ? { kind: "evaluate-then", effect: call, discard: "value", value: absent }
          : wrapping(invocation.optional || !input.optional ? call : { kind: "call", path: "Some", args: [call] }),
        };
      }),
    } }] } };
  }
  const variants = active.map((invocation, index) => ({ name: invocation.implementation.variantName,
    fields: [{ kind: "named" as const, path: `Future${index}` }],
  }));
  const items: readonly RustItem[] = [{ kind: "enum", name, visibility: "private",
    generics: { ...emptyRustGenerics, parameters: active.map((_invocation, index) => ({ kind: "type", name: `Future${index}`, bounds: [] })) },
    variants,
  }];
  const prepare = (invocation: RustGenericNativeFutureInvocation): RustExpr => {
    const call = invoked(invocation);
    if (invocation.absent) return { kind: "evaluate-then", effect: call, discard: "value", value: { kind: "return-expression", expr: absent } };
    const pending = (value: RustExpr): RustExpr => ({ kind: "call", path: `${name}::${invocation.implementation.variantName}`, args: [value] });
    return invocation.optional ? { kind: "match", expression: call, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "future" }] },
        expression: pending({ kind: "path", path: "future" }) },
      { pattern: { kind: "path", path: "None" }, expression: { kind: "return-expression", expr: absent } },
    ] } : pending(call);
  };
  const future: RustExpr = { kind: "async-block", move: true,
    body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "path", path: "pending" },
      arms: active.map(invocation => {
        const awaited: RustExpr = { kind: "await", expr: { kind: "path", path: "future" } };
        return { pattern: { kind: "tuple-variant", path: `${name}::${invocation.implementation.variantName}`,
          elements: [{ kind: "binding", name: "future" }] },
          expression: effects.awaiting === "fallible" && invocation.effects.awaiting !== "fallible"
            ? { kind: "call", path: "Ok", args: [awaited] } : awaited,
        };
      }),
    } }] },
  };
  return { items, returnType: returnedType(futureType), body: { statements: [
    { kind: "let", name: "pending", mutable: false, init: {
      kind: "match", expression: { kind: "path", path: "self" },
      arms: invocations.map(invocation => ({ pattern: invocation.pattern, expression: prepare(invocation) })),
    } },
    { kind: "tail", expr: wrapping(input.optional ? { kind: "call", path: "Some", args: [future] } : future) },
  ] } };

  function invoked(invocation: RustGenericNativeFutureInvocation): RustExpr {
    return invocation.effects.invocation === "fallible"
      ? { kind: "try", expr: invocation.call, nativeReturn: true, operandErrorType: input.error!, resultErrorType: input.error! }
      : invocation.call;
  }

  function returnedType(future: RustType): RustType {
    const value: RustType = input.optional ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: future }] } : future;
    return effects.invocation === "fallible" ? resultType(value, input.error!) : value;
  }
}

function resultType(value: RustType, error: RustType): RustType {
  return { kind: "named", path: "Result", genericArguments: [{ kind: "type", type: value }, { kind: "type", type: error }] };
}
