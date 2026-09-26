import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember, rustErrorType } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectDispatchTraitType } from "./polymorphism/names.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import { planRustCallableArguments, applyRustCallableValueAdapter } from "../declarations/callables/adapters.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustCallableProtocol } from "../../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import { rustStructuralViewInstance, rustStructuralViewIntoRoot, rustStructuralViewRootType,
  rustStructuralViewImplementationContext, rustStructuralViewImplementationGenerics } from "./project-structural-roots.js";
import { rustDirectProjectFieldStoragePath } from "./project-storage.js";
import { checkRustDataWrite } from "./data-writes.js";
import { planRustSourceAccessorCall } from "../expressions/properties.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";
import { rustStructuralDispatchType } from "./project-structural-types.js";

export function planRustProjectStructuralConversion(
  expression: RustExpr, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const view = context.input.program.classValues.instanceViews.find(view =>
    rustTargetTypeRefEquals(view.sourceCarrier, sourceCarrier) && rustTargetTypeRefEquals(view.targetCarrier, targetCarrier));
  const type = rustTypeFromCarrierInContext(targetCarrier, context);
  const definition = context.input.program.projectTypes.definitionForCarrier(sourceCarrier);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (view === undefined || type?.kind !== "named" || representation === undefined || context.syntheticNames === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "instance_view");
  const receiver: RustExpr = { kind: "path", path: name };
  const root = rustStructuralViewIntoRoot(receiver, representation);
  if (root === undefined) return undefined;
  return { kind: "block", bindings: [{ name, value: expression }], value: { kind: "struct-literal", path: type.path, fields: [
    { name: "dispatch", value: root },
  ] } };
}

export function planRustProjectStructuralImplementations(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const views = context.input.program.classValues.instanceViewImplementations.filter(view => view.declaration === declaration &&
    view.ownerFileName === context.input.program.source.ast.getFileName(context.sourceFile));
  if (views.length === 0) return [];
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const boundary = rustCurrentErrorBoundary(context);
  if (definition === undefined || representation === undefined || boundary === undefined) return undefined;
  const items: RustItem[] = [];
  for (const view of views) {
    const baseContext = context;
    context = rustStructuralViewImplementationContext(view.sourceCarrier, representation, baseContext);
    const generics = rustStructuralViewImplementationGenerics(view.sourceCarrier, representation, context);
    const target = rustStructuralViewRootType(view.sourceCarrier, representation, context);
    const trait = rustStructuralDispatchType(view.targetCarrier, context);
    const shape = context.input.program.structuralShapes.definitionForCarrier(view.targetCarrier);
    if (target === undefined || trait === undefined || shape === undefined || generics === undefined) return undefined;
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
        const declaringOwner = context.input.program.projectTypes.definitionContainingDeclaration(callable.declaration);
        const relationship = declaringOwner === undefined ? undefined : context.input.program.projectTypes.relationship(callable.ownerCarrier, declaringOwner);
        const owner = relationship?.kind !== "related" ? undefined : rustProjectDispatchTraitType(relationship.targetType, local);
        const parameters = callable.parameters.map(parameter => {
          const type = rustTypeFromCarrierInContext(parameter.parameterCarrier, local);
          return type === undefined ? undefined : { name: allocateRustSyntheticName(syntheticNames, "argument"), type };
        });
        const polymorphic = context.input.program.projectTypes.isPolymorphic(definition);
        if (result === undefined || polymorphic && (variant === undefined || owner === undefined) || parameters.some(parameter => parameter === undefined)) return undefined;
        const params = parameters as NonNullable<typeof parameters[number]>[];
        const arguments_ = planRustCallableArguments({ declaration: callable.declaration, parameters: params,
          parameterAbis: callable.parameters, parameterAdapters: callable.parameterAdapters }, local);
        if (arguments_ === undefined) return undefined;
        const instance = polymorphic ? undefined : rustStructuralViewInstance({ kind: "path", path: "self" }, view.sourceCarrier, representation, local);
        if (!polymorphic && instance === undefined) return undefined;
        let invocation: RustExpr = polymorphic ? { kind: "associated-call", owner: owner!, method: variant!.exactSlot,
          args: [{ kind: "path", path: "self" }, ...arguments_.adaptedArguments] }
          : { kind: "method-call", receiver: instance!, method: callable.targetName, args: arguments_.adaptedArguments };
        if (context.input.program.facts.getFact(callable.declaration, rustFallibleFactKey) !== undefined) {
          const error = rustErrorBoundaryForProjectMember(callable.declaration, context);
          if (error === undefined) return undefined;
          invocation = { kind: "try", expr: invocation, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(error) };
        }
        const value = applyRustCallableValueAdapter(invocation, callable.resultAdapter, callable.declaration, local);
        if (value === undefined) return undefined;
        functions.push({ kind: "function", name: field.targetName, visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"),
          params, returnType: result, errorType: rustErrorType(boundary), body: { statements: [...arguments_.statements,
            { kind: "tail", expr: applyRustFallibleResultExpression(value, { errorType: rustErrorType(boundary) }) }] } });
        continue;
      }
      const source = member.field;
      const owner = source?.dispatch === undefined ? undefined : rustProjectDispatchTraitType(source.dispatch.ownerCarrier, context);
      const type = rustTypeFromCarrierInContext(field.carrier, context);
      const dispatch = context.input.program.projectFieldDispatch.planFor(member.declaration);
      if (member.accessor !== undefined) {
        const accessor = member.accessor;
        const property = field.property;
        const root: RustExpr = { kind: "path", path: "self" };
        const instance = accessor.dispatch === undefined
          ? rustStructuralViewInstance(root, view.sourceCarrier, representation, local)
          : undefined;
        const dispatchOwner = accessor.dispatch === undefined ? undefined : rustProjectDispatchTraitType(accessor.dispatch.ownerCarrier, local);
        if (type === undefined || property?.selfMode !== "rc" || accessor.read === undefined ||
          accessor.dispatch === undefined && instance === undefined || accessor.dispatch !== undefined && dispatchOwner === undefined ||
          member.readAdapter === undefined) return undefined;
        for (const role of ["read", "write"] as const) {
          if (role === "write" && property.setterTargetName === undefined) continue;
          const selected = role === "read" ? accessor.read : accessor.write;
          if (selected === undefined) return undefined;
          const arguments_: RustExpr[] = role === "read" ? [] : [{ kind: "path", path: "value" }];
          let call = dispatchOwner === undefined ? planRustSourceAccessorCall(member.declaration, accessor, role,
            arguments_, local, instance, view.sourceCarrier) : { kind: "associated-call" as const, owner: dispatchOwner,
            method: selected.method, args: [root, ...arguments_] };
          if (call === undefined) return undefined;
          if (context.input.program.facts.getFact(selected.declaration, rustFallibleFactKey) !== undefined) {
            const sourceBoundary = rustErrorBoundaryForProjectMember(selected.declaration, local);
            if (sourceBoundary === undefined) return undefined;
            call = { kind: "try", expr: call, operandErrorType: rustErrorType(sourceBoundary), resultErrorType: rustErrorType(boundary) };
          }
          const value = role === "read" ? applyRustCallableValueAdapter(call, member.readAdapter, member.declaration, local) : call;
          if (value === undefined) return undefined;
          functions.push({ kind: "function", name: role === "read" ? property.getterTargetName : property.setterTargetName!, visibility: "private",
            generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"), params: role === "read" ? [] : [{ name: "value", type }],
            returnType: role === "read" ? type : { kind: "unit" }, errorType: rustErrorType(boundary), body: { statements: [
              { kind: "tail", expr: applyRustFallibleResultExpression(value, { errorType: rustErrorType(boundary) }) },
            ] } });
        }
        continue;
      }
      if (source !== undefined && source.dispatch === undefined) {
        const path = rustDirectProjectFieldStoragePath(view.sourceCarrier, source.storageIndex, context);
        if (path === undefined || type === undefined || field.property === undefined) return undefined;
        const selected = path.reduce<RustExpr>((receiver, name) => ({ kind: "field", receiver, name }), { kind: "path", path: "state" });
        const read: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with", args: [{
          kind: "closure", params: [{ name: "state", byRefCopy: false }],
          body: isRustCopyCarrier(source.resultCarrier) ? selected : { kind: "method-call", receiver: selected, method: "clone", args: [] },
        }] };
        const adapted = member.readAdapter === undefined ? undefined : applyRustCallableValueAdapter(read, member.readAdapter, member.declaration, local);
        if (adapted === undefined) return undefined;
        functions.push({ kind: "function", name: field.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
          selfParam: rustSelfParameter(field.property.selfMode), params: [], returnType: type, errorType: rustErrorType(boundary),
          body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [adapted] } }] },
        });
        if (field.property.setterTargetName !== undefined) {
          if (representation.kind !== "shared-mutable") return undefined;
          let write: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with_mut", args: [{
            kind: "closure-block", params: [{ name: "state", mutable: false }], move: false, async: false,
            body: { statements: [{ kind: "assign", target: selected, operator: "=", value: { kind: "path", path: "value" } }] },
          }] };
          if (context.input.program.frozenDataWrites.receiverForDeclaration(member.declaration) !== undefined) {
            write = checkRustDataWrite("receiver", { kind: "path", path: "self" }, write, rustErrorType(boundary));
          }
          functions.push({ kind: "function", name: field.property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
            selfParam: rustSelfParameter(field.property.selfMode), params: [{ name: "value", type }], returnType: { kind: "unit" }, errorType: rustErrorType(boundary),
            body: { statements: [{ kind: "tail", expr: { kind: "evaluate-then", effect: write, discard: "unit",
              value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } } }] },
          });
        }
        continue;
      }
      if (source?.dispatch === undefined || owner === undefined || type === undefined || field.property === undefined ||
        dispatch === undefined || dispatch.read.selfMode !== "ref" || dispatch.write !== undefined && dispatch.write.selfMode !== "ref") return undefined;
      let read: RustExpr = { kind: "associated-call", owner, method: source.dispatch.read,
        args: [field.property.selfMode === "ref" ? { kind: "path", path: "self" } : { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "as_ref", args: [] }] };
      if (dispatch.read.fallible) read = { kind: "try", expr: read, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(boundary) };
      const adapted = member.readAdapter === undefined ? undefined : applyRustCallableValueAdapter(read, member.readAdapter, member.declaration, local);
      if (adapted === undefined) return undefined;
      functions.push({ kind: "function", name: field.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter(field.property.selfMode), params: [], returnType: type, errorType: rustErrorType(boundary),
        body: { statements: [{ kind: "tail", expr: applyRustFallibleResultExpression(adapted, { errorType: rustErrorType(boundary) }) }] } });
      if (field.property.setterTargetName !== undefined) {
        if (dispatch.write === undefined) return undefined;
        const write: RustExpr = { kind: "associated-call", owner, method: source.dispatch.write,
          args: [field.property.selfMode === "ref" ? { kind: "path", path: "self" } : { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "as_ref", args: [] }, { kind: "path", path: "value" }] };
        functions.push({ kind: "function", name: field.property.setterTargetName, visibility: "private", generics: emptyRustGenerics,
          selfParam: rustSelfParameter(field.property.selfMode), params: [{ name: "value", type }], returnType: { kind: "unit" }, errorType: rustErrorType(boundary),
          body: { statements: [{ kind: "tail", expr: dispatch.write.fallible ? write : { kind: "evaluate-then", effect: write, discard: "unit",
            value: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } } }] } });
      }
    }
    items.push({ kind: "impl", target, trait, generics, members: functions });
    context = baseContext;
  }
  return items;
}
