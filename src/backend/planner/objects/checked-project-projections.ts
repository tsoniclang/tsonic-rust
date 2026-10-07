import { rustValueBlock } from "../../target-ast/value-block.js";
import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustBlock, RustExpr, RustGenerics, RustImplFunction, RustTraitFunction, RustType } from "../../target-ast/nodes.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustProjectDispatchObjectType } from "./polymorphism/names.js";
import { rustStructuralDispatchType } from "./project-structural-types.js";
import { rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";

export const rustCheckedNativeProjectionGenerics: RustGenerics = {
  parameters: [],
  wherePredicates: [{ kind: "type", type: { kind: "named", path: "Self" },
    bounds: [{ kind: "lifetime", lifetime: { kind: "static" } }] }],
};

export function checkedProjectProjectionSignature(slot: string): RustTraitFunction {
  return { kind: "function",
    name: slot,
    generics: rustCheckedNativeProjectionGenerics,
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

export function checkedProjectProjectionTypes(
  contracts: readonly { readonly definition: RustProjectTypeDefinition; readonly carrier: TargetTypeRef }[],
  structuralCarriers: readonly TargetTypeRef[],
  context: RustPlanContext,
): readonly RustType[] | undefined {
  const eligible = [...contracts.filter(contract => !contract.definition.genericParameters.some(parameter => parameter.kind === "lifetime"))
    .map(contract => contract.carrier), ...structuralCarriers];
  const types = eligible.map(carrier => checkedProjectProjectionResultType(carrier, context));
  return types.some(type => type === undefined) ? undefined
    : types.filter(type => type !== undefined);
}

export function planCheckedProjectProjectionImplementation(
  slot: string,
  contracts: readonly { readonly definition: RustProjectTypeDefinition; readonly carrier: TargetTypeRef }[],
  structuralCarriers: readonly TargetTypeRef[],
  context: RustPlanContext,
): RustImplFunction | undefined {
  const types = checkedProjectProjectionTypes(contracts, structuralCarriers, context);
  return types === undefined ? undefined : planCheckedNativeProjectionImplementation(slot, types);
}

export function planCheckedNativeProjectionImplementation(
  slot: string, types: readonly RustType[],
): RustImplFunction {
  const statements: RustBlock["statements"][number][] = [];
  for (const [index, type] of types.entries()) {
    statements.push({ kind: "expr", expr: checkedNativeProjectionAssignment(
      { kind: "path", path: "output" }, type, { kind: "path", path: "self" }, index !== types.length - 1,
    ) });
  }
  return { ...checkedProjectProjectionSignature(slot), visibility: "private",
    body: { statements } };
}

export function planCheckedNativeValueProjection(
  value: RustExpr, concreteType: RustType, resultType: RustType,
): RustExpr {
  const option = (type: RustType): RustType => ({ kind: "named", path: "Option",
    genericArguments: [{ kind: "type", type }] });
  return rustValueBlock([
    { name: "output", mutable: true, type: option(resultType), value: { kind: "none" } },
    { value: checkedNativeProjectionAssignment(
      { kind: "reference", mutable: true, expr: { kind: "path", path: "output" } }, option(concreteType),
      { kind: "method-call", receiver: value, method: "clone", args: [] }, false,
    ) },
  ], { kind: "path", path: "output" });
}

function checkedNativeProjectionAssignment(
  output: RustExpr, type: RustType, value: RustExpr, returnAfter: boolean,
): RustExpr {
  return { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "selected" }] },
    expression: { kind: "associated-call", owner: { kind: "trait-object",
      principal: { trait: { kind: "named", path: "core::any::Any" } }, autoTraits: [] },
      method: "downcast_mut", genericArguments: [{ kind: "type", type }], args: [output] },
    whenTrue: { kind: "block", body: { statements: [
      { kind: "assign", operator: "=", target: { kind: "dereference", pointer: { kind: "path", path: "selected" } },
        value: { kind: "call", path: "Some", args: [value] } },
      ...(returnAfter ? [{ kind: "return" as const }] : []),
    ] } },
  };
}

export function planCheckedProjectProjectionCall(
  receiver: RustExpr, slot: string, resultType: RustType,
): RustExpr {
  return rustValueBlock([
    { name: "selected", mutable: true, type: resultType, value: { kind: "none" } },
  ], { kind: "evaluate-then", discard: "unit",
    effect: { kind: "method-call", receiver, method: slot,
      args: [{ kind: "reference", mutable: true, expr: { kind: "path", path: "selected" } }] },
    value: { kind: "path", path: "selected" },
  });
}
