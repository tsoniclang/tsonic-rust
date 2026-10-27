import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../../target-model/records/callables/generic-callables.js";
import type { RustGenericCallableEffectsFact } from "../../../../target-model/records/callables/generic-callable-effects.js";
import type { RustExpr, RustGenericArgument, RustItem, RustPattern, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustNativeFutureType } from "../../types/native-futures.js";
import type { RustGenericCallableErrorPlan } from "./generic-errors.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export interface RustGenericNativeFutureInvocation {
  readonly member: RustGenericCallablePhysicalMember;
  readonly pattern: RustPattern;
  readonly call: RustExpr;
  readonly effects: RustGenericCallableEffectsFact;
  readonly optional: boolean;
  readonly absent: boolean;
  readonly unchangedAwaitError: boolean;
}

export function planRustGenericNativeFutureDispatch(input: {
  readonly definition: RustGenericCallablePhysicalDefinition;
  readonly output: RustType;
  readonly errors: RustGenericCallableErrorPlan;
  readonly effects: RustGenericCallableEffectsFact;
  readonly optional: boolean;
  readonly captures: readonly RustGenericArgument[];
  readonly invocations: readonly RustGenericNativeFutureInvocation[];
}): { readonly items: readonly RustItem[]; readonly returnType: RustType; readonly body: Extract<RustItem, { readonly kind: "function" }>["body"] } | undefined {
  const { definition, effects, invocations } = input;
  const name = definition.nativeFutureDispatchName;
  if (name === undefined || invocations.length !== definition.members.length ||
    effects.awaiting === "not-applicable" ||
    (effects.invocation === "fallible") !== (input.errors.invocation.errorType !== undefined) ||
    (effects.awaiting === "fallible") !== (input.errors.awaiting.errorType !== undefined) ||
    invocations.some(invocation => invocation.effects.awaiting === "not-applicable" || invocation.absent && !input.optional ||
      invocation.effects.invocation === "fallible" && effects.invocation !== "fallible" ||
      !invocation.absent && invocation.effects.awaiting === "fallible" && effects.awaiting !== "fallible"))
    failRustPlannerInvariant("An admitted native future dispatch requires its exact effects and members.");
  const calls = new Map<RustGenericCallablePhysicalMember, RustExpr>();
  const awaitedValues = new Map<RustGenericCallablePhysicalMember, RustExpr>();
  for (const invocation of invocations) {
    const selected = input.errors.forMember(invocation.member);
    if (selected === undefined || selected.effects.invocation !== invocation.effects.invocation ||
      selected.effects.awaiting !== invocation.effects.awaiting)
      failRustPlannerInvariant("An admitted native future member requires its exact error channels.", invocation.member.implementation.declaration);
    const call = selected.invocation === undefined ? invocation.call : input.errors.invocation.propagateReturn(selected.invocation, invocation.call);
    const awaited: RustExpr = { kind: "await", expr: { kind: "path", path: "future" } };
    const converted = selected.awaiting === undefined ? undefined : input.errors.awaiting.propagatedValue(selected.awaiting, awaited);
    if (call === undefined || selected.awaiting !== undefined && converted === undefined)
      failRustPlannerInvariant("An admitted native future member requires its selected error injection.", invocation.member.implementation.declaration);
    calls.set(invocation.member, call);
    awaitedValues.set(invocation.member, converted !== undefined ? converted :
      effects.awaiting === "fallible" ? { kind: "call", path: "Ok", args: [awaited] } : awaited);
  }
  const futureOutput = effects.awaiting === "fallible" ? resultType(input.output, input.errors.awaiting.errorType!) : input.output;
  const active = invocations.filter(invocation => !invocation.absent);
  const wrapping = (value: RustExpr): RustExpr => effects.invocation === "fallible"
    ? { kind: "call", path: "Ok", args: [value] } : value;
  const absent: RustExpr = wrapping({ kind: "path", path: "None" });
  const ready = rustNativeFutureType(futureOutput, { kind: "ready" });
  if (active.length === 0) {
    return { items: [], returnType: returnedType(ready), body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: invocations.map(invocation => ({
        pattern: invocation.pattern, expression: { kind: "evaluate-then", effect: invoked(invocation), discard: "value", value: absent },
      })),
    } }] } };
  }
  const futureType = rustNativeFutureType(futureOutput, { kind: "opaque",
    captures: input.captures });
  if (active.length === 1) {
    return { items: [], returnType: returnedType(futureType), body: { statements: [{ kind: "tail", expr: {
      kind: "match", expression: { kind: "path", path: "self" }, arms: invocations.map(invocation => {
        const call = invoked(invocation);
        const unchanged = invocation.unchangedAwaitError;
        const pending = (value: RustExpr): RustExpr => unchanged ? value : { kind: "block", body: { statements: [
          { kind: "let", name: "future", mutable: false, init: value },
          { kind: "tail", expr: { kind: "async-block", move: true,
            body: { statements: [{ kind: "tail", expr: awaitedValues.get(invocation.member)! }] } } },
        ] } };
        const normalized: RustExpr = invocation.optional && !unchanged ? { kind: "match", expression: call, arms: [
          { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "future" }] },
            expression: { kind: "call", path: "Some", args: [pending({ kind: "path", path: "future" })] } },
          { pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } },
        ] } : invocation.optional ? call : pending(call);
        return { pattern: invocation.pattern, expression: invocation.absent
          ? { kind: "evaluate-then", effect: call, discard: "value", value: absent }
          : wrapping(invocation.optional || !input.optional ? normalized : { kind: "call", path: "Some", args: [normalized] }),
        };
      }),
    } }] } };
  }
  const variants = active.map((invocation, index) => ({ name: invocation.member.variantName,
    fields: [{ kind: "named" as const, path: `Future${index}` }],
  }));
  const items: readonly RustItem[] = [{ kind: "enum", name, visibility: "private",
    generics: { ...emptyRustGenerics, parameters: active.map((_invocation, index) => ({ kind: "type", name: `Future${index}`, bounds: [] })) },
    variants,
  }];
  const prepare = (invocation: RustGenericNativeFutureInvocation): RustExpr => {
    const call = invoked(invocation);
    if (invocation.absent) return { kind: "evaluate-then", effect: call, discard: "value", value: { kind: "return-expression", expr: absent } };
    const pending = (value: RustExpr): RustExpr => ({ kind: "call", path: `${name}::${invocation.member.variantName}`, args: [value] });
    return invocation.optional ? { kind: "match", expression: call, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "future" }] },
        expression: pending({ kind: "path", path: "future" }) },
      { pattern: { kind: "path", path: "None" }, expression: { kind: "return-expression", expr: absent } },
    ] } : pending(call);
  };
  const future: RustExpr = { kind: "async-block", move: true,
    body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "path", path: "pending" },
      arms: active.map(invocation => {
        return { pattern: { kind: "tuple-variant", path: `${name}::${invocation.member.variantName}`,
          elements: [{ kind: "binding", name: "future" }] },
          expression: awaitedValues.get(invocation.member)!,
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
    return calls.get(invocation.member)!;
  }

  function returnedType(future: RustType): RustType {
    const value: RustType = input.optional ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: future }] } : future;
    return effects.invocation === "fallible" ? resultType(value, input.errors.invocation.errorType!) : value;
  }
}

function resultType(value: RustType, error: RustType): RustType {
  return { kind: "named", path: "Result", genericArguments: [{ kind: "type", type: value }, { kind: "type", type: error }] };
}
