import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustBlock, RustExpr, RustGenerics, RustImplFunction, RustTraitFunction, RustType } from "../../target-ast/nodes.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustProjectDispatchObjectType } from "./polymorphism/names.js";
import { rustStructuralDispatchType } from "./project-structural-types.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";

const projectionGenerics: RustGenerics = {
  parameters: [],
  wherePredicates: [{ kind: "type", type: { kind: "named", path: "Self" },
    bounds: [{ kind: "lifetime", lifetime: { kind: "static" } }] }],
};

export function checkedProjectProjectionSignature(slot: string): RustTraitFunction {
  return { kind: "function",
    name: slot,
    generics: projectionGenerics,
    selfParam: rustSelfParameter("rc"),
    params: [{ name: "output", type: { kind: "reference", mutable: true,
      referent: { kind: "trait-object", principal: { trait: { kind: "named", path: "core::any::Any" } },
        autoTraits: [] } } }],
  };
}

export function checkedProjectProjectionResultType(
  carrier: TargetTypeRef, context: RustPlanContext,
): RustType | undefined {
  const structural = rustStructuralObjectCarrierValue(carrier);
  const trait = structural === undefined ? undefined : rustStructuralDispatchType(carrier, context);
  const dispatch: RustType | undefined = structural === undefined ? rustProjectDispatchObjectType(carrier, context)
    : trait === undefined ? undefined : { kind: "trait-object", principal: { trait }, autoTraits: [] };
  return dispatch === undefined ? undefined : {
    kind: "named", path: "Option", genericArguments: [{ kind: "type", type: {
      kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: dispatch }],
    } }],
  };
}

export function planCheckedProjectProjectionImplementation(
  slot: string,
  contracts: readonly { readonly definition: RustProjectTypeDefinition; readonly carrier: TargetTypeRef }[],
  structuralCarriers: readonly TargetTypeRef[],
  context: RustPlanContext,
): RustImplFunction | undefined {
  const statements: RustBlock["statements"][number][] = [];
  const eligible = [...contracts.filter(contract => !contract.definition.genericParameters.some(parameter => parameter.kind === "lifetime"))
    .map(contract => contract.carrier), ...structuralCarriers];
  for (const [index, carrier] of eligible.entries()) {
    const type = checkedProjectProjectionResultType(carrier, context);
    if (type === undefined) return undefined;
    statements.push({ kind: "if-let-some", binding: "selected",
      expression: { kind: "method-call", receiver: { kind: "path", path: "output" },
        method: "downcast_mut", genericArguments: [{ kind: "type", type }], args: [] },
      body: { statements: [{ kind: "assign", operator: "=",
        target: { kind: "dereference", pointer: { kind: "path", path: "selected" } },
        value: { kind: "call", path: "Some", args: [{ kind: "path", path: "self" }] } },
      ...(index === eligible.length - 1 ? [] : [{ kind: "return" as const }])] } });
  }
  return { ...checkedProjectProjectionSignature(slot), visibility: "private",
    body: { statements } };
}

export function planCheckedProjectProjectionCall(
  receiver: RustExpr, slot: string, resultType: RustType,
): RustExpr {
  return { kind: "block", bindings: [
    { name: "selected", mutable: true, type: resultType, value: { kind: "none" } },
  ], value: { kind: "evaluate-then", discard: "unit",
    effect: { kind: "method-call", receiver, method: slot,
      args: [{ kind: "reference", mutable: true, expr: { kind: "path", path: "selected" } }] },
    value: { kind: "path", path: "selected" },
  } };
}
