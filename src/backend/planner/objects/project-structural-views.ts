import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember, rustErrorType } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectDispatchTraitType, rustProjectRepresentationGenerics, rustProjectRootType } from "./polymorphism/names.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import { planRustCallableArguments, applyRustCallableValueAdapter } from "../declarations/callable-adapters.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustCallableProtocol } from "../../../target-model/types/index.js";

export function rustStructuralDispatchType(carrier: TargetTypeRef, context: RustPlanContext): RustType | undefined {
  const type = rustTypeFromCarrierInContext(carrier, context);
  const shape = context.input.program.structuralShapes.definitionForCarrier(carrier);
  return type?.kind !== "named" || shape?.dispatchName === undefined ? undefined : {
    ...type, path: `${type.path.slice(0, type.path.lastIndexOf("::") + 2)}${shape.dispatchName}`,
  };
}

export function planRustProjectStructuralConversion(
  expression: RustExpr, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const view = context.input.program.classValues.instanceViews.find(view =>
    rustTargetTypeRefEquals(view.sourceCarrier, sourceCarrier) && rustTargetTypeRefEquals(view.targetCarrier, targetCarrier));
  const type = rustTypeFromCarrierInContext(targetCarrier, context);
  if (view === undefined || type?.kind !== "named" || context.syntheticNames === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "instance_view");
  const receiver: RustExpr = { kind: "path", path: name };
  return { kind: "block", bindings: [{ name, value: expression }], value: { kind: "struct-literal", path: type.path, fields: [
    { name: "identity", value: { kind: "field", receiver, name: "identity" } },
    { name: "dispatch", value: { kind: "field", receiver, name: "dispatch" } },
  ] } };
}

export function planRustProjectStructuralImplementations(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const views = context.input.program.classValues.instanceViews.filter(view => view.declaration === declaration);
  if (views.length === 0) return [];
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const boundary = rustCurrentErrorBoundary(context);
  if (definition === undefined || representation === undefined || boundary === undefined) return undefined;
  const items: RustItem[] = [];
  for (const view of views) {
    const target = rustProjectRootType(view.sourceCarrier, context);
    const trait = rustStructuralDispatchType(view.targetCarrier, context);
    const shape = context.input.program.structuralShapes.definitionForCarrier(view.targetCarrier);
    if (target === undefined || trait === undefined || shape === undefined) return undefined;
    const functions: RustImplFunction[] = [];
    for (const member of view.fields) {
      const field = shape.fields[member.storageIndex];
      if (field === undefined) return undefined;
      const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, member.declaration, []);
      const local = { ...context, syntheticNames, fallibleBoundary: boundary };
      const callable = member.callable;
      if (callable !== undefined) {
        const protocol = rustCallableProtocol(callable.carrier);
        const result = protocol === undefined ? undefined : rustTypeFromCarrierInContext(protocol.result, local);
        const variant = context.input.program.projectMethodDispatch.variantForMember(callable.declaration, []);
        const owner = rustProjectDispatchTraitType(callable.ownerCarrier, local);
        const parameters = callable.parameters.map(parameter => {
          const type = rustTypeFromCarrierInContext(parameter.parameterCarrier, local);
          return type === undefined ? undefined : { name: allocateRustSyntheticName(syntheticNames, "argument"), type };
        });
        if (result === undefined || variant === undefined || owner === undefined || parameters.some(parameter => parameter === undefined)) return undefined;
        const params = parameters as NonNullable<typeof parameters[number]>[];
        const arguments_ = planRustCallableArguments({ declaration: callable.declaration, parameters: params,
          parameterAbis: callable.parameters, parameterAdapters: callable.parameterAdapters }, local);
        if (arguments_ === undefined) return undefined;
        let invocation: RustExpr = { kind: "associated-call", owner, method: variant.exactSlot,
          args: [{ kind: "path", path: "self" }, ...arguments_.adaptedArguments] };
        if (context.input.program.facts.getFact(callable.declaration, rustFallibleFactKey) !== undefined) {
          const error = rustErrorBoundaryForProjectMember(callable.declaration, context);
          if (error === undefined) return undefined;
          invocation = { kind: "try", expr: invocation, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(error) };
        }
        const value = applyRustCallableValueAdapter(invocation, callable.resultAdapter, callable.declaration, local);
        if (value === undefined) return undefined;
        functions.push({ name: field.targetName, visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"),
          params, returnType: result, errorType: rustErrorType(boundary), body: { statements: [...arguments_.statements,
            { kind: "tail", expr: { kind: "call", path: "Ok", args: [value] } }] } });
        continue;
      }
      const source = member.field;
      const owner = source?.dispatch === undefined ? undefined : rustProjectDispatchTraitType(source.dispatch.ownerCarrier, context);
      const type = rustTypeFromCarrierInContext(field.carrier, context);
      const dispatch = context.input.program.projectFieldDispatch.planFor(member.declaration);
      if (source?.dispatch === undefined || owner === undefined || type === undefined || field.property === undefined ||
        dispatch === undefined || dispatch.read.selfMode !== "ref" || dispatch.write !== undefined && dispatch.write.selfMode !== "ref") return undefined;
      const read: RustExpr = { kind: "associated-call", owner, method: source.dispatch.read, args: [{ kind: "path", path: "self" }] };
      functions.push({ name: field.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"), params: [], returnType: type, errorType: rustErrorType(boundary),
        body: { statements: [{ kind: "tail", expr: dispatch.read.fallible ? read : { kind: "call", path: "Ok", args: [read] } }] } });
      if (field.property.setterTargetName !== undefined) {
        if (dispatch.write === undefined) return undefined;
        const write: RustExpr = { kind: "associated-call", owner, method: source.dispatch.write,
          args: [{ kind: "path", path: "self" }, { kind: "path", path: "value" }] };
        functions.push({ name: field.property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
          selfParam: rustSelfParameter("ref"), params: [{ name: "value", type }], returnType: { kind: "unit" }, errorType: rustErrorType(boundary),
          body: { statements: [{ kind: "tail", expr: dispatch.write.fallible ? write : { kind: "evaluate-then", effect: write, discard: "unit",
            value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } } }] } });
      }
    }
    items.push({ kind: "impl", target, trait, generics: rustProjectRepresentationGenerics(representation, context), functions });
  }
  return items;
}
