import type { RustObjectReferenceView } from "../../../analysis/facts/object-reference-views.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustOptionElementCarrier, rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "../../../target-model/types/index.js";
import { createRustStructuralObjectFromCarrier, readRustStoredObjectField, writeRustStoredObjectField,
  type RustStructuralObjectFieldInitializer } from "../objects/project-storage.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";

export function planRustObjectReferenceView(
  value: RustExpr, fact: RustObjectReferenceView, context: RustPlanContext,
): RustExpr | undefined {
  const shape = context.input.program.structuralShapes.definitionForCarrier(fact.targetCarrier);
  const boundary = rustCurrentErrorBoundary(context);
  if (shape === undefined || shape.fields.length !== fact.fields.length || boundary === undefined ||
    context.syntheticNames === undefined) return undefined;
  const callbackContext: RustPlanContext = { ...context, fallibleBoundary: boundary };
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "view_owner");
  const owner: RustExpr = {kind: "path", path: ownerName};
  const clone = (expression: RustExpr): RustExpr => ({kind: "method-call", receiver: expression, method: "clone", args: []});
  const bindings: {name: string; value: RustExpr}[] = [{name: ownerName, value: clone(value)}];
  const initializers: RustStructuralObjectFieldInitializer[] = [];
  for (const [index, field] of fact.fields.entries()) {
    const target = shape.fields[index];
    if (target === undefined || field.destinationIndex !== index || target.storage !== "property") return undefined;
    const getterType = rustTypeFromCarrierInContext(rustOptionElementCarrier(rustStructuralPropertyGetterStorageCarrier(
      fact.targetCarrier, target.carrier, target.presence)), callbackContext);
    const setterType = !field.writable ? undefined : rustTypeFromCarrierInContext(rustOptionElementCarrier(
      rustStructuralPropertySetterStorageCarrier(fact.targetCarrier, target.carrier, target.presence)), callbackContext);
    if (getterType === undefined || field.writable && setterType === undefined) return undefined;
    const readerName = allocateRustSyntheticName(context.syntheticNames, "view_reader");
    const reader: RustExpr = {kind: "path", path: readerName};
    bindings.push({name: readerName, value: clone(owner)});
    const source = field.source;
    const dispatch = source.declaration === undefined ? undefined : context.input.program.projectFieldDispatch.planFor(source.declaration);
    const roles = dispatch === undefined ? undefined : planRustProjectFieldDispatchRoles(dispatch, callbackContext);
    if (source.dispatch !== undefined && (roles === undefined || field.writable && roles.write === undefined)) return undefined;
    const read = source.dispatch === undefined
      ? readRustStoredObjectField(source.storage, fact.sourceCarrier, reader, source.storageIndex, source.resultCarrier, callbackContext)
      : readRustProjectDispatchedField(reader, source.dispatch.read, roles!.read);
    if (read === undefined) return undefined;
    const getter: RustExpr = {kind: "associated-call", owner: getterType, method: "new", args: [{
      kind: "closure", move: true, params: [{name: "_receiver", byRefCopy: false}], body: {kind: "call", path: "Ok", args: [read]},
    }]};
    let setter: RustExpr | undefined;
    if (field.writable) {
      const writerName = allocateRustSyntheticName(context.syntheticNames, "view_writer");
      const argumentsName = allocateRustSyntheticName(context.syntheticNames, "view_arguments");
      const writer: RustExpr = {kind: "path", path: writerName};
      const next: RustExpr = {kind: "field", receiver: {kind: "path", path: argumentsName}, name: "1"};
      bindings.push({name: writerName, value: clone(owner)});
      const write = source.dispatch === undefined
        ? writeRustStoredObjectField(source.storage, fact.sourceCarrier, writer, source.storageIndex, "=", next, callbackContext)
        : writeRustProjectDispatchedField(writer, allocateRustSyntheticName(context.syntheticNames, "view_dispatch"),
            source.dispatch.read, source.dispatch.write, "=", next, {read: roles!.read, write: roles!.write!});
      if (write === undefined) return undefined;
      setter = {kind: "associated-call", owner: setterType!, method: "new", args: [{kind: "closure", move: true,
        params: [{name: argumentsName, byRefCopy: false}], body: {kind: "evaluate-then", effect: write, discard: "unit",
          value: {kind: "call", path: "Ok", args: [{kind: "tuple-literal", elements: []}]}},
      }]};
    }
    initializers.push({kind: "accessor", getter, ...(setter === undefined ? {} : {setter})});
  }
  context.usedAliases?.add("rt");
  const identity = clone({kind: "call", path: "rt::ObjectIdentityCarrier::object_identity", args: [{kind: "reference", expr: owner}]});
  const constructed = createRustStructuralObjectFromCarrier(fact.targetCarrier, initializers, context, identity);
  return constructed === undefined ? undefined : {kind: "block", bindings, value: constructed};
}
