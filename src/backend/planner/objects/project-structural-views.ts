import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPackageFallibleBoundary } from "../program/fallible-boundaries.js";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember, rustErrorType } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectDispatchTraitType } from "./polymorphism/names.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";

import { applyRustCallableValueAdapter } from "../declarations/callables/adapters.js";
import { planRustCallableArguments } from "../declarations/callables/parameter-adapters.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { requireRustCarrierRead } from "../types/carrier-reads.js";
import { rustStructuralViewInstance, rustStructuralViewIntoRoot, rustStructuralViewRootType,
  rustStructuralViewImplementationContext, rustStructuralViewImplementationGenerics } from "./project-structural-roots.js";
import { rustDirectProjectFieldStoragePath } from "./project-storage.js";
import { readRustCapturedField, rustCapturedFieldStorage, writeRustCapturedFieldFromStorage } from "./captured-fields.js";
import { checkRustDataWrite } from "./data-writes.js";
import { planRustSourceAccessorCall } from "../expressions/properties.js";
import { applyFallibleShape, applyRustFallibleResultExpression } from "../types/fallible-shape.js";
import { rustStructuralDispatchType } from "./project-structural-types.js";
import { planRustStructuralFrameField } from "./project-structural-frame-fields.js";

export function planRustProjectStructuralConversion(
  expression: RustExpr, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const view = context.input.program.records.structuralView.get(sourceCarrier, targetCarrier);
  const type = rustTypeFromCarrierInContext(targetCarrier, context);
  const definition = context.input.program.records.projectType.get(sourceCarrier);
  const representation = context.input.program.records.objectRepresentation.get(definition);
  if (view === undefined || type?.kind !== "named" || representation === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted structural conversion requires its exact native view, representation and name scope.");
  const name = allocateRustSyntheticName(context.syntheticNames, "instance_view");
  const receiver: RustExpr = { kind: "path", path: name };
  const root = rustStructuralViewIntoRoot(receiver, representation);
  if (root === undefined) failRustPlannerInvariant("An admitted structural conversion requires its native shared root.", view.declaration);
  return rustValueBlock([{ name, value: expression }], { kind: "struct-literal", path: type.path, fields: [
    { name: "dispatch", value: root },
  ] });
}

export function planRustProjectStructuralImplementations(declaration: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const views = context.input.program.records.structuralViewImplementations.get(declaration,
    context.input.program.source.ast.getFileName(context.sourceFile)) ?? [];
  if (views.length === 0) return [];
  const definition = context.input.program.records.projectDeclaration.get(declaration);
  const representation = context.input.program.records.objectRepresentation.get(definition);
  const boundary = rustCurrentErrorBoundary(context);
  if (definition === undefined || representation === undefined || boundary === undefined)
    failRustPlannerInvariant("An admitted structural implementation requires its exact declaration, representation and error ABI.", declaration);
  const polymorphic = context.input.program.records.structuralViewPolymorphic.get(declaration);
  if (polymorphic === undefined) failRustPlannerInvariant("A structural implementation requires its sealed dispatch mode.", declaration);
  const items: RustItem[] = [];
  for (const view of views) {
    const baseContext = context;
    context = rustStructuralViewImplementationContext(view.sourceCarrier, representation, baseContext);
    const generics = rustStructuralViewImplementationGenerics(view, representation, context);
    const target = rustStructuralViewRootType(view.sourceCarrier, representation, context);
    const trait = rustStructuralDispatchType(view.targetCarrier, context);
    const shape = context.input.program.records.structuralShape.get(view.targetCarrier);
    if (target === undefined || trait === undefined || shape === undefined || generics === undefined)
      failRustPlannerInvariant("A structural implementation requires its sealed native target, trait, fields and generics.", view.declaration);
    const functions: RustImplFunction[] = [];
    for (const member of view.fields) {
      const field = shape.fields[member.storageIndex];
      if (field === undefined) failRustPlannerInvariant("A structural member requires its exact sealed field slot.", member.declaration);
      const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, member.declaration, []);
      const local = { ...context, syntheticNames, fallibleBoundary: rustPackageFallibleBoundary(boundary) };
      const callable = member.callable;
      if (callable !== undefined) {
        const selected = context.input.program.records.structuralViewCallable.get(callable);
        if (selected === undefined) failRustPlannerInvariant("A structural callable requires its sealed result and dispatch contract.", callable.declaration);
        const result = rustTypeFromCarrierInContext(selected.result, local);
        const owner = selected.owner === undefined ? undefined : rustProjectDispatchTraitType(selected.owner, local);
        const parameters = callable.parameters.map(parameter => {
          const type = rustTypeFromCarrierInContext(parameter.parameterCarrier, local);
          return type === undefined ? undefined : { name: allocateRustSyntheticName(syntheticNames, "argument"), type };
        });
        if (result === undefined || polymorphic && (selected.exactSlot === undefined || owner === undefined) || parameters.some(parameter => parameter === undefined))
          failRustPlannerInvariant("A structural callable requires its admitted native signature and dispatch slot.", callable.declaration);
        const params = parameters as NonNullable<typeof parameters[number]>[];
        const arguments_ = planRustCallableArguments({ declaration: callable.declaration, parameters: params,
          parameterAbis: callable.parameters, parameterAdapters: callable.parameterAdapters }, local);
        if (arguments_ === undefined) failRustPlannerInvariant("A structural callable requires its admitted native arguments.", callable.declaration);
        const instance = polymorphic ? undefined : rustStructuralViewInstance({ kind: "path", path: "self" }, view.sourceCarrier, representation, local);
        if (!polymorphic && instance === undefined) failRustPlannerInvariant("A structural callable requires its native instance receiver.", callable.declaration);
        let invocation: RustExpr = polymorphic ? { kind: "associated-call", owner: owner!, method: selected.exactSlot!,
          args: [{ kind: "path", path: "self" }, ...arguments_.adaptedArguments] }
          : { kind: "method-call", receiver: instance!, method: callable.targetName, args: arguments_.adaptedArguments };
        if (context.input.program.records.fallible.get(callable.declaration) !== undefined) {
          const error = rustErrorBoundaryForProjectMember(callable.declaration, context);
          if (error === undefined) failRustPlannerInvariant("A structural callable requires its exact native error ABI.", callable.declaration);
          invocation = { kind: "try", expr: invocation, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(error) };
        }
        const value = applyRustCallableValueAdapter(invocation, callable.resultAdapter, callable.declaration, local);
        if (value === undefined) failRustPlannerInvariant("A structural member requires its admitted result adaptation.", member.declaration);
        functions.push({ kind: "function", name: field.targetName, visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"),
          params, returnType: result, errorType: rustErrorType(boundary), body: applyFallibleShape({ statements: [...arguments_.statements,
            { kind: "tail", expr: value }] }, { fallible: true, hasReturnValue: result.kind !== "unit",
            errorType: rustErrorType(boundary), inferErrorTypeFromReturnType: true, canFallThrough: false }) });
        continue;
      }
      const source = member.field;
      const owner = source?.dispatch === undefined ? undefined : rustProjectDispatchTraitType(source.dispatch.ownerCarrier, context);
      const type = rustTypeFromCarrierInContext(field.carrier, context);
      const dispatch = context.input.program.records.projectFieldDispatch.get(member.declaration);
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
          member.readAdapter === undefined) failRustPlannerInvariant("A structural accessor requires its sealed receiver, signature and result adaptation.", member.declaration);
        for (const role of ["read", "write"] as const) {
          if (role === "write" && property.setterTargetName === undefined) continue;
          const selected = role === "read" ? accessor.read : accessor.write;
          if (selected === undefined) failRustPlannerInvariant("A structural accessor requires its admitted native access role.", member.declaration);
          const arguments_: RustExpr[] = role === "read" ? [] : [{ kind: "path", path: "value" }];
          let call = dispatchOwner === undefined ? planRustSourceAccessorCall(member.declaration, accessor, role,
            arguments_, local, instance, view.sourceCarrier) : { kind: "associated-call" as const, owner: dispatchOwner,
            method: selected.method, args: [root, ...arguments_] };
          if (call === undefined) failRustPlannerInvariant("A structural accessor requires its admitted native invocation.", member.declaration);
          if (context.input.program.records.fallible.get(selected.declaration) !== undefined) {
            const sourceBoundary = rustErrorBoundaryForProjectMember(selected.declaration, local);
            if (sourceBoundary === undefined) failRustPlannerInvariant("A structural accessor requires its exact native error ABI.", member.declaration);
            call = { kind: "try", expr: call, operandErrorType: rustErrorType(sourceBoundary), resultErrorType: rustErrorType(boundary) };
          }
          const value = role === "read" ? applyRustCallableValueAdapter(call, member.readAdapter, member.declaration, local) : call;
          if (value === undefined) failRustPlannerInvariant("A structural member requires its admitted result adaptation.", member.declaration);
          functions.push({ kind: "function", name: role === "read" ? property.getterTargetName : property.setterTargetName!, visibility: "private",
            generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"), params: role === "read" ? [] : [{ name: "value", type }],
            returnType: role === "read" ? type : { kind: "unit" }, errorType: rustErrorType(boundary), body: applyFallibleShape({ statements: [
              { kind: "tail", expr: value },
            ] }, { fallible: true, hasReturnValue: role === "read" && type.kind !== "unit",
              errorType: rustErrorType(boundary), inferErrorTypeFromReturnType: true, canFallThrough: false }) });
        }
        continue;
      }
      if (source !== undefined && source.dispatch === undefined) {
        if (context.input.program.records.frameBindingDeclaration.get(member.declaration)?.entry !== undefined) {
          if (type === undefined) failRustPlannerInvariant("A structural frame field requires its admitted native type.", member.declaration);
          const planned = planRustStructuralFrameField(declaration, member, field, type, local);
          if (planned === undefined) failRustPlannerInvariant("A structural frame field requires its admitted native accessors.", member.declaration);
          functions.push(...planned);
          continue;
        }
        const path = rustDirectProjectFieldStoragePath(view.sourceCarrier, source.storageIndex, context);
        if (path === undefined || type === undefined || field.property === undefined) failRustPlannerInvariant("A structural field requires its sealed storage path and accessors.", member.declaration);
        const captured = rustCapturedFieldStorage(member.declaration, local);
        const selected = path.reduce<RustExpr>((receiver, name) => ({ kind: "field", receiver, name }), { kind: "path", path: "state" });
        const read: RustExpr = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with", args: [{
          kind: "closure", params: [{ name: "state", byRefCopy: false }],
          body: captured !== undefined ? readRustCapturedField(captured, selected, source.resultCarrier, local)
            : requireRustCarrierRead(source.resultCarrier, local, member.declaration).copy ? selected : { kind: "method-call", receiver: selected, method: "clone", args: [] },
        }] };
        const adapted = member.readAdapter === undefined ? undefined : applyRustCallableValueAdapter(read, member.readAdapter, member.declaration, local);
        if (adapted === undefined) failRustPlannerInvariant("A structural field requires its admitted native read adaptation.", member.declaration);
        functions.push({ kind: "function", name: field.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
          selfParam: rustSelfParameter(field.property.selfMode), params: [], returnType: type, errorType: rustErrorType(boundary),
          body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [adapted] } }] },
        });
        if (field.property.setterTargetName !== undefined) {
          let write: RustExpr;
          if (captured !== undefined) {
            const replacement = writeRustCapturedFieldFromStorage(captured, project => {
              const body = project(selected);
              return body === undefined ? undefined : { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with", args: [{
                kind: "closure", params: [{ name: "state", byRefCopy: false }], body,
              }] };
            }, { kind: "path", path: "value" }, representation.kind === "shared-mutable");
            if (replacement === undefined) failRustPlannerInvariant("A structural captured field requires its admitted native replacement.", member.declaration);
            write = replacement;
          } else {
            if (representation.kind !== "shared-mutable") failRustPlannerInvariant("A writable structural field requires its admitted mutable native representation.", member.declaration);
            write = { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "with_mut", args: [{
              kind: "closure-block", params: [{ name: "state", mutable: false }], move: false, async: false,
              body: { statements: [{ kind: "assign", target: selected, operator: "=", value: { kind: "path", path: "value" } }] },
            }] };
          }
          if (context.input.program.records.frozenDataReceiver.get(member.declaration) !== undefined) {
            const checked = checkRustDataWrite("receiver", { kind: "path", path: "self" }, write, rustPackageFallibleBoundary(boundary));
            if (checked === undefined) failRustPlannerInvariant("A frozen structural field requires its admitted native error ABI.", member.declaration);
            write = checked;
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
        dispatch === undefined || dispatch.read.selfMode !== "ref" || dispatch.write !== undefined && dispatch.write.selfMode !== "ref")
        failRustPlannerInvariant("A structural dispatch field requires its sealed native receiver and access roles.", member.declaration);
      let read: RustExpr = { kind: "associated-call", owner, method: source.dispatch.read,
        args: [field.property.selfMode === "ref" ? { kind: "path", path: "self" } : { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "as_ref", args: [] }] };
      if (dispatch.read.fallible) read = { kind: "try", expr: read, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(boundary) };
      const adapted = member.readAdapter === undefined ? undefined : applyRustCallableValueAdapter(read, member.readAdapter, member.declaration, local);
      if (adapted === undefined) failRustPlannerInvariant("A structural field requires its admitted native read adaptation.", member.declaration);
      functions.push({ kind: "function", name: field.property.getterTargetName, visibility: "private", generics: emptyRustGenerics,
        selfParam: rustSelfParameter(field.property.selfMode), params: [], returnType: type, errorType: rustErrorType(boundary),
        body: { statements: [{ kind: "tail", expr: applyRustFallibleResultExpression(adapted, { errorType: rustErrorType(boundary) }) }] } });
      if (field.property.setterTargetName !== undefined) {
        if (dispatch.write === undefined) failRustPlannerInvariant("A writable structural dispatch requires its admitted write role.", member.declaration);
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
