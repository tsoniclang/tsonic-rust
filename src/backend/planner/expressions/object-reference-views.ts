import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPackageFallibleBoundary } from "../program/fallible-boundaries.js";
import type { RustObjectReferenceView } from "../../../target-model/records/objects/object-reference-views.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { createRustStructuralObjectFromCarrier, readRustStoredObjectField, writeRustStoredObjectField,
  type RustStructuralObjectFieldInitializer } from "../objects/project-storage.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectStructuralConversion } from "../objects/project-structural-views.js";
import type { Node } from "@tsonic/tsts";
import { constructRustStructuralLiteral } from "../objects/object-literals/structural.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustObjectReferenceView(
  node: Node, value: RustExpr, _fact: RustObjectReferenceView, context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.objectReferenceEmission.get(node)
    ?? failRustPlannerInvariant("An admitted object reference view requires its native construction plan.", node);
  if (selected.kind === "identity") return value;
  const fact = selected.view;
  if (selected.kind === "project") return planRustProjectStructuralConversion(value, fact.sourceCarrier, fact.targetCarrier, context);
  if (selected.kind === "constructor") {
    const type = rustTypeFromCarrierInContext(fact.targetCarrier, context);
    if (type?.kind !== "named") failRustPlannerInvariant("An admitted constructor view requires its native named storage.", node);
    return { kind: "struct-literal", path: type.path, fields: [{ name: "dispatch", value }] };
  }
  const boundary = rustCurrentErrorBoundary(context);
  if (boundary === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted object reference view requires its native error boundary and name scope.", node);
  const callbackContext: RustPlanContext = { ...context, fallibleBoundary: rustPackageFallibleBoundary(boundary) };
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "view_owner");
  const owner: RustExpr = {kind: "path", path: ownerName};
  const clone = (expression: RustExpr): RustExpr => ({kind: "method-call", receiver: expression, method: "clone", args: []});
  const bindings: {name: string; value: RustExpr}[] = [{name: ownerName, value: clone(value)}];
  const initializers: RustStructuralObjectFieldInitializer[] = [];
  for (const field of selected.fields) {
    const getterType = rustTypeFromCarrierInContext(field.getter, callbackContext);
    const setterType = field.setter === undefined ? undefined : rustTypeFromCarrierInContext(field.setter, callbackContext);
    if (getterType === undefined || field.setter !== undefined && setterType === undefined)
      failRustPlannerInvariant("An admitted object reference field requires its native getter and setter storage types.", node);
    const readerName = allocateRustSyntheticName(context.syntheticNames, "view_reader");
    const reader: RustExpr = {kind: "path", path: readerName};
    bindings.push({name: readerName, value: clone(owner)});
    const source = field.source;
    const dispatch = source.declaration === undefined ? undefined : context.input.program.records.projectFieldDispatch.get(source.declaration);
    const roles = dispatch === undefined ? undefined : planRustProjectFieldDispatchRoles(dispatch, callbackContext);
    if (source.dispatch !== undefined && (roles === undefined || field.setter !== undefined && roles.write === undefined))
      failRustPlannerInvariant("An admitted object reference field requires its native dispatch roles.", node);
    const read = source.dispatch === undefined
      ? readRustStoredObjectField(source.storage, fact.sourceCarrier, reader, source.storageIndex, source.resultCarrier, callbackContext)
      : readRustProjectDispatchedField(reader, source.dispatch.read, roles!.read);
    if (read === undefined) return undefined;
    const getter: RustExpr = {kind: "associated-call", owner: getterType, method: "new", args: [{
      kind: "closure", move: true, params: [{name: "_receiver", byRefCopy: false}], body: {kind: "call", path: "Ok", args: [read]},
    }]};
    let setter: RustExpr | undefined;
    if (field.setter !== undefined) {
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
  const implementation = context.objectLiteralImplementations?.forReferenceView(node);
  const constructed = !selected.dispatch ? createRustStructuralObjectFromCarrier(fact.targetCarrier, initializers, context, identity)
    : implementation?.kind === "structural" ? constructRustStructuralLiteral(implementation, initializers, context, identity) : undefined;
  return constructed === undefined ? undefined : rustValueBlock(bindings, constructed);
}
