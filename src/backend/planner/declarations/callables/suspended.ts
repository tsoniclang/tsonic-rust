import type { RustSuspendedCallableImplementation } from "../../../../target-model/records/suspended-callables.js";
import type { RustGenericParameter, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { planRustCallableExpressionBody } from "../../expressions/callable.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustSuspendedCallableStateType } from "../../types/suspended-callables.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import { planRustCallableGenerics } from "./generics.js";
import { rustCallableCaptureStorageType } from "../../types/capture-storage.js";
import { rustCapturedReceiverFieldType } from "../../expressions/receiver-captures.js";

export function planRustSuspendedCallableItems(context: RustPlanContext): readonly RustItem[] {
  const implementations = context.input.program.records.suspendedDeclarations.get(context.sourceFile);
  if (implementations === undefined) failRustPlannerInvariant("An admitted source module requires its suspended callable inventory.", context.sourceFile);
  return Object.freeze(implementations.flatMap(implementation => planImplementation(implementation, context)));
}

function planImplementation(implementation: RustSuspendedCallableImplementation, context: RustPlanContext): readonly RustItem[] {
  const { declaration } = implementation;
  const selected = context.input.program.records.suspendedDeclaration.get(declaration);
  if (selected === undefined || selected.implementation !== implementation)
    failRustPlannerInvariant("An admitted suspended callable requires its exact sealed implementation record.", declaration);
  const genericPlan = planRustCallableGenerics(declaration,
    { ...context, nativeHeaderPlacement: implementation, nativeHeaderParent: undefined }, undefined);
  const scoped: RustPlanContext = { ...genericPlan.context,
    callableDeclaration: declaration,
    syntheticNames: createRustSyntheticNameState(context.input.program.source.ast, declaration, []),
  };
  const planned = planRustCallableExpressionBody(declaration, scoped);
  const invocation = planned?.sharedInvocation;
  if (invocation === undefined) failRustPlannerInvariant("An admitted suspended callable requires its explicitly planned shared invocation body.", declaration);
  const argumentsType = rustTypeFromCarrierInContext({ kind: "tuple", elements: selected.parameters }, scoped);
  const resultType = rustTypeFromCarrierInContext(selected.result, scoped);
  const target = rustSuspendedCallableStateType(implementation, scoped);
  const storage = [...implementation.captures.map((capture, index) =>
    rustCallableCaptureStorageType(capture, selected.captures[index]!, scoped)),
    ...implementation.receiverFields.map((capture, index) => {
      const type = rustTypeFromCarrierInContext(implementation.storage[implementation.captures.length + index]!, scoped);
      return type === undefined ? undefined : rustCapturedReceiverFieldType(capture, type, scoped);
    }), ...implementation.receivers.map((_capture, index) => rustTypeFromCarrierInContext(
      implementation.storage[implementation.captures.length + implementation.receiverFields.length + index]!, scoped))];
  if (argumentsType === undefined || resultType === undefined || target === undefined || storage.some(type => type === undefined))
    failRustPlannerInvariant("An admitted suspended callable requires its renderable native storage and invocation ABI.", declaration);
  const generics = genericPlan.finalizeGenerics();
  const parameters: RustGenericParameter[] = [...generics.parameters];
  const environment = [
    ...implementation.environment.lifetimes.map(rustLifetimeKey),
    ...implementation.environment.typeParameters.map(type => type.identity),
  ].map(identity => {
    const slot = genericPlan.parameterSlots.get(identity);
    const parameter = slot === undefined ? undefined : generics.parameters[slot];
    if (parameter === undefined) failRustPlannerInvariant("An admitted suspended environment requires its exact source-identity generic binder.", declaration);
    return parameter;
  });
  if (implementation.elision !== undefined) parameters.unshift({
    kind: "lifetime", name: implementation.elision.lifetime.name, outlives: [],
  });
  const selfType: RustType = { kind: "named", path: "Self" };
  const state: RustType = { kind: "tuple", elements: storage as RustType[] };
  context.usedAliases?.add("rt");
  return [{ kind: "struct", name: implementation.stateName, visibility: "crate",
    generics: { parameters: environment, wherePredicates: [] }, fields: [{ name: "state", type: state, visibility: "crate" }, {
      name: "owner", type: { kind: "named", path: "alloc::rc::Weak", genericArguments: [{ kind: "type", type: selfType }] }, visibility: "crate",
    }],
  }, { kind: "impl", target,
    generics: { ...generics, parameters },
    trait: { kind: "named", path: "rt::CallableImplementation", genericArguments: [{ kind: "type", type: argumentsType }] },
    members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, type: resultType },
    { kind: "function", name: "invoke", visibility: "private", selfParam: { kind: "reference", mutable: false },
      generics: { parameters: [], wherePredicates: [] }, params: [{ name: invocation.argumentsName, type: argumentsType }], returnType: resultType,
      body: { statements: [{ kind: "let", name: invocation.ownerName, mutable: false, init: {
        kind: "method-call", receiver: { kind: "method-call", receiver: {
          kind: "field", receiver: { kind: "path", path: "self" }, name: "owner",
        }, method: "upgrade", args: [] }, method: "expect", args: [{ kind: "str-literal", value: "an invoked callable has a live owner" }],
      } }, ...invocation.body.statements] },
    }],
  }];
}
