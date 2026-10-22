import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { cloneRustExpression as cloneExpression } from "../../target-ast/syntax/expressions.js";
import type { Node } from "@tsonic/tsts";
import { rustCapturedFieldStorage } from "./captured-fields.js";
import { planRustProjectFieldDispatchRole, planRustProjectFieldDispatchRoles } from "./project-field-dispatch.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { planRustNativeMemoryCall } from "../expressions/native-memory.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import type { RustExpr, RustCallGenericArgument } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { checkRustDataWrite } from "./data-writes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { requireRustCarrierRead } from "../types/carrier-reads.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { readRustStructuralObjectProperty, writeRustStructuralObjectProperty, mutateRustStructuralObjectProperty } from "./structural-properties.js";
import { readRustBoundRecordField, writeRustBoundRecordField, mutateRustBoundRecordField } from "./record-fields.js";
import {
  createRustStructuralObject,
  mutateRustProjectObjectField,
  mutateRustStructuralObjectField,
  readRustProjectObjectField,
  readRustProjectDispatchedField,
  readRustStructuralObjectField,
  writeRustProjectObjectField,
  writeRustProjectDispatchedField,
  writeRustStructuralObjectField,
} from "./project-objects.js";
import {
  allocateRustSyntheticName,
} from "../names/synthetic.js";
import {
  rustProgramErrorTargetType,
} from "../../../target-model/types/index.js";

export type RustStructuralObjectFieldInitializer =
  | { readonly kind: "stored"; readonly value: RustExpr }
  | { readonly kind: "bound"; readonly value: RustExpr }
  | { readonly kind: "method"; readonly value: RustExpr }
  | {
      readonly kind: "accessor";
      readonly getter: RustExpr;
      readonly setter?: RustExpr;
    };

export function createRustStructuralObjectFromCarrier(
  carrier: TargetTypeRef,
  initializers: readonly RustStructuralObjectFieldInitializer[],
  context: RustPlanContext,
  identity?: RustExpr,
  constructor?: RustExpr,
): RustExpr | undefined {
  const definition = context.input.program.records.structuralShape.get(carrier);
  if (definition === undefined || definition.fields.length !== initializers.length) {
    failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  }
  if ((definition.construction === undefined) !== (constructor === undefined)) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  if (context.input.program.records.structuralObjectStorage.get(carrier)?.value === true &&
    definition.fields.some(field => field.nativeLayout !== undefined)) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  const fields = definition.fields.flatMap((field, index) => {
    const initializer = initializers[index];
    if (initializer === undefined ||
      (field.method === true && field.receiverIndependent !== true) !== (initializer.kind === "method" && field.receiverIndependent !== true) ||
      (field.storage === "stored" && initializer.kind === "accessor") ||
      (field.storage !== "bound" && initializer.kind === "bound") ||
      (field.storage === "property" && initializer.kind === "method" && field.receiverIndependent !== true)) {
      return [undefined];
    }
    if (field.storage === "bound") {
      if (initializer.kind !== "bound" && initializer.kind !== "stored") return [undefined];
      context.usedAliases?.add("rt");
      return [{ name: field.targetName, value: { kind: "call" as const,
        path: `rt::RecordField::${initializer.kind === "bound" ? "Bound" : "Value"}`, args: [initializer.value] } }];
    }
    if (field.storage === "stored") {
      if (initializer.kind === "accessor") {
        return [undefined];
      }
      const value = field.nativeLayout === undefined ? initializer.value
        : planRustNativeMemoryCall("allocate_native_location", initializer.value, field.nativeLayout, context);
      return value === undefined ? [undefined] : [{ name: field.targetName, value }];
    }
    if (field.property === undefined || initializer.kind === "method" && field.receiverIndependent !== true) {
      return [undefined];
    }
    const stored = initializer.kind === "accessor"
      ? { kind: "none" as const }
      : field.presence === "optional"
        ? initializer.value
        : { kind: "call" as const, path: "Some", args: [initializer.value] };
    const getter = initializer.kind === "accessor"
      ? { kind: "call" as const, path: "Some", args: [initializer.getter] }
      : { kind: "none" as const };
    const setter = initializer.kind === "accessor" && initializer.setter !== undefined
      ? { kind: "call" as const, path: "Some", args: [initializer.setter] }
      : { kind: "none" as const };
    return [{
      name: field.targetName,
      value: stored,
    }, {
      name: field.property.getterTargetName,
      value: getter,
    }, ...(field.property.setterTargetName === undefined
      ? []
      : [{
          name: field.property.setterTargetName,
          value: setter,
        }])];
  });
  if (fields.some((field) => field === undefined)) {
    failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  }
  if (definition.construction !== undefined && constructor !== undefined) {
    fields.push({ name: definition.construction.targetName, value: constructor });
  }
  if (context.input.program.records.structuralObjectStorage.get(carrier)?.value === true) {
    const type = rustTypeFromCarrierInContext(carrier, context);
    return identity !== undefined || type?.kind !== "named" ? failRustPlannerInvariant("An admitted native value object requires its named carrier and no shared identity.", context.sourceFile) : {
      kind: "struct-literal",
      path: type.path,
      fields: fields as readonly { readonly name: string; readonly value: RustExpr }[],
    };
  }
  context.usedAliases?.add("rt");
  return createRustStructuralObject(
    `crate::${context.structuralShapesModuleName}::${definition.targetName}`,
    fields as readonly { readonly name: string; readonly value: RustExpr }[],
    identity,
  );
}

export function rustDirectProjectFieldStoragePath(
  receiverCarrier: TargetTypeRef,
  storageIndex: number,
  context: RustPlanContext,
): readonly string[] | undefined {
  return context.input.program.records.storedField.get("project-object", receiverCarrier, storageIndex)?.path;
}

export function readRustStoredObjectField(
  storage: "project-object" | "structural-object",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
  projection: readonly string[] = [],
  receiverIsBorrowed = false,
): RustExpr | undefined {
  if (storage === "structural-object") {
    const field = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field;
    if (field === undefined) {
      failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    }
    if (context.input.program.records.structuralShape.get(receiverCarrier)?.dispatchName !== undefined) {
      const region = context.fallibleBoundary;
      const operand = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
      if (field.property === undefined || region === undefined || operand === undefined || projection.length !== 0 ||
        context.syntheticNames === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
      const name = allocateRustSyntheticName(context.syntheticNames, "property_receiver");
      const dispatch: RustExpr = { kind: "field", receiver: { kind: "path", path: name }, name: "dispatch" };
      const selected = rustPropagateLocalError(region, operand, {
        kind: "method-call", receiver: field.property.selfMode === "ref" ? dispatch : cloneExpression(dispatch),
        method: field.property.getterTargetName, args: [],
      });
      return selected === undefined ? failRustPlannerInvariant("An admitted field read requires its exact native error propagation.", context.sourceFile) : rustValueBlock([{ name, value: { kind: "reference", expr: receiver } }], selected);
    }
    if (field.method === true && field.receiverIndependent !== true) {
      failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    }
    if (projection.length !== 0 && (field.storage !== "stored" || field.nativeLayout !== undefined)) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    const path = [field.targetName, ...projection];
    if (field.storage === "bound") return readRustBoundRecordField(receiver, field, context, receiverIsBorrowed);
    if (context.input.program.records.structuralObjectStorage.get(receiverCarrier)?.value === true) {
      if (field.storage !== "stored" || field.nativeLayout !== undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
      const selected = path.reduce<RustExpr>((value, name) => ({ kind: "field", receiver: value, name }), receiver);
      return requireRustCarrierRead(resultCarrier, context).copy ? selected : { kind: "method-call", receiver: selected, method: "clone", args: [] };
    }
    if (field.nativeLayout !== undefined) return { kind: "method-call",
      receiver: readRustStructuralObjectField(receiver, field.targetName, context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)!.location!, context),
      method: "load", args: [] };
    return field.storage === "property"
      ? readRustStructuralObjectProperty(
          receiverCarrier,
          receiver,
          field,
          storageIndex,
          resultCarrier,
          context,
        )
      : readRustStructuralObjectField(receiver, path, resultCarrier, context);
  }
  const dispatch = rustStoredProjectFieldDispatch(receiverCarrier, storageIndex, context);
  if (dispatch !== undefined) {
    const role = planRustProjectFieldDispatchRole(dispatch.plan, "read", context);
    return role === undefined || projection.length !== 0 ? failRustPlannerInvariant("An admitted dispatched field requires its exact read role and direct projection.", context.sourceFile)
      : readRustProjectDispatchedField(receiver, dispatch.read, role);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  const declaration = rustStoredProjectFieldDeclaration(receiverCarrier, storageIndex, context);
  const captured = declaration === undefined ? undefined : rustCapturedFieldStorage(declaration, context);
  return path === undefined || representation === undefined
    ? failRustPlannerInvariant("An admitted project field requires its native storage path and representation.", context.sourceFile)
    : readRustProjectObjectField(receiver, captured === undefined ? [...path, ...projection] : path, resultCarrier, representation, context,
      captured, captured === undefined ? [] : projection);
}

export function rustStoredObjectFieldSupportsBorrowedRead(
  storage: "project-object" | "structural-object", receiverCarrier: TargetTypeRef, storageIndex: number,
  context: RustPlanContext,
): boolean {
  return context.input.program.records.storedField.get(storage, receiverCarrier, storageIndex)?.borrowedRead === true;
}

function rustStoredProjectFieldDeclaration(carrier: TargetTypeRef, storageIndex: number, context: RustPlanContext): Node | undefined {
  return context.input.program.records.storedField.get("project-object", carrier, storageIndex)?.declaration;
}

function rustStoredProjectFieldDispatch(carrier: TargetTypeRef, storageIndex: number, context: RustPlanContext) {
  return context.input.program.records.storedField.get("project-object", carrier, storageIndex)?.dispatch;
}

export function readRustStructuralObjectMethodStorage(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  context: RustPlanContext,
): RustExpr | undefined {
  const field = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field;
  if (field?.nativeMethod === true) return undefined;
  const storageCarrier = field?.methodStorageCarrier;
  if (field === undefined || storageCarrier === undefined) {
    failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  }
  return field.receiverIndependent === true
    ? readRustStoredObjectField("structural-object", receiverCarrier, receiver, storageIndex, storageCarrier, context)
    : readRustStructuralObjectField(receiver, field.targetName, storageCarrier, context);
}

export interface RustStructuralMethodStorageOverride {
  readonly expression: RustExpr;
  readonly carrier: TargetTypeRef;
}

export function invokeRustStructuralObjectMethod(
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  arguments_: readonly RustExpr[],
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
  storageOverride?: RustStructuralMethodStorageOverride,
  typeArguments: readonly TargetTypeRef[] = [],
  genericArguments: readonly RustCallGenericArgument[] = [],
): RustExpr | undefined {
  const field = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field;
  const selected = context.input.program.records.structuralMethodInvocation.get(receiverCarrier, storageIndex, typeArguments);
  if (field === undefined || selected === undefined || selected.parameterCount !== arguments_.length ||
    !rustTargetTypeRefEquals(selected.result, resultCarrier) || (field.presence === "required") !== (storageOverride === undefined) ||
    storageOverride !== undefined && !rustTargetTypeRefEquals(storageOverride.carrier, selected.rawStorage) || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted structural method invocation requires its exact sealed signature, storage and name scope.");
  if (selected.native) {
    if (storageOverride !== undefined || field.presence !== "required" || field.storage !== "stored")
      failRustPlannerInvariant("A native structural method requires its admitted direct storage.");
    const dispatch: RustExpr = { kind: "field", receiver, name: "dispatch" };
    return { kind: "method-call", receiver: selected.cloneDispatch ? cloneExpression(dispatch) : dispatch,
      method: field.targetName, args: arguments_, ...(genericArguments.length === 0 ? {} : { genericArguments }) };
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_receiver",
  );
  const methodName = allocateRustSyntheticName(
    context.syntheticNames,
    "structural_method",
  );
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const method = storageOverride?.expression ?? readRustStructuralObjectMethodStorage(receiverCarrier, receiverPath, storageIndex, context);
  if (method === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  const inputs: readonly RustExpr[] = [...(field.receiverIndependent === true ? [] : [
    cloneExpression(receiverPath),
  ]), ...arguments_];
  // The receiver is only read (its stored method) and cloned as the method's first argument, so a place is bound by
  // reference. Any other receiver expression may borrow temporaries that end with the binding statement, so its handle
  // is cloned first and the reference extends that clone.
  const place = receiver.kind === "path" || receiver.kind === "field";
  return rustValueBlock([{ name: receiverName, value: { kind: "reference", expr: place ? receiver : cloneExpression(receiver) } }, {
      name: methodName,
      value: method,
    }], {
      kind: "method-call",
      receiver: { kind: "path", path: methodName },
      method: "call",
      ...(genericArguments.length === 0 ? {} : { genericArguments }),
      args: !selected.generic ? [{ kind: "tuple-literal", elements: inputs }] : inputs,
    });
}

export function writeRustStoredObjectField(
  storage: "project-object" | "structural-object",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
  projection: readonly string[] = [],
  receiverIsBorrowed = false,
): RustExpr | undefined {
  const check = projection.length === 0
    ? context.input.program.records.storedField.get(storage, receiverCarrier, storageIndex)?.check
    : undefined;
  if (storage === "structural-object" && context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field?.storage === "property") {
    return writeRustStoredObjectFieldStorage(storage, receiverCarrier, receiver, storageIndex, operator, value, context, projection, receiverIsBorrowed);
  }
  if (check === undefined) return writeRustStoredObjectFieldStorage(storage, receiverCarrier, receiver, storageIndex, operator, value, context, projection, receiverIsBorrowed);
  const region = context.fallibleBoundary;
  if (region === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "field_owner");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
  const selected: RustExpr = { kind: "path", path: receiverName };
  const effect = writeRustStoredObjectFieldStorage(storage, receiverCarrier, selected, storageIndex, operator,
    { kind: "path", path: valueName }, context, projection, receiverIsBorrowed);
  const checked = effect === undefined ? undefined : checkRustDataWrite(check, selected, effect, region);
  return checked === undefined ? failRustPlannerInvariant("An admitted frozen field write requires its exact native error propagation.", context.sourceFile) : rustValueBlock([
    { name: receiverName, value: receiverIsBorrowed ? receiver : cloneExpression(receiver) }, { name: valueName, value },
  ], checked);
}

function writeRustStoredObjectFieldStorage(
  storage: "project-object" | "structural-object",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
  projection: readonly string[] = [],
  receiverIsBorrowed = false,
): RustExpr | undefined {
  if (storage === "structural-object") {
    const field = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field;
    if (field === undefined) {
      failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    }
    if (context.input.program.records.structuralShape.get(receiverCarrier)?.dispatchName !== undefined) {
      const region = context.fallibleBoundary;
      const operand = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
      if (field.property?.setterTargetName === undefined || region === undefined || operand === undefined ||
        projection.length !== 0 || operator !== "=") failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
      const dispatch: RustExpr = { kind: "field", receiver, name: "dispatch" };
      return rustPropagateLocalError(region, operand, { kind: "method-call", receiver: field.property.selfMode === "ref" ? dispatch
        : cloneExpression(dispatch),
        method: field.property.setterTargetName, args: [value] });
    }
    if (field.method === true && field.receiverIndependent !== true || field.readonly && projection.length === 0) {
      failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    }
    if (projection.length !== 0 && (field.storage !== "stored" || field.nativeLayout !== undefined)) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    const path = [field.targetName, ...projection];
    if (field.storage === "bound") return writeRustBoundRecordField(receiver, field, operator, value, context, receiverIsBorrowed);
    if (context.input.program.records.structuralObjectStorage.get(receiverCarrier)?.value === true) {
      return field.storage !== "stored" || field.nativeLayout !== undefined ? failRustPlannerInvariant("An admitted native value field requires its exact direct storage.", context.sourceFile) : {
        kind: "assignment", operator,
        target: path.reduce<RustExpr>((selected, name) => ({ kind: "field", receiver: selected, name }), receiver), value,
      };
    }
    if (field.nativeLayout !== undefined) {
      const location = readRustStructuralObjectField(receiver, field.targetName, context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)!.location!, context);
      if (operator === "=") return { kind: "method-call", receiver: location, method: "store", args: [value] };
      if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
      const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
      return { kind: "method-call", receiver: location, method: "with_mut", args: [{ kind: "closure",
        params: [{ name: valueName, byRefCopy: false }], body: { kind: "assignment", operator,
          target: { kind: "dereference", pointer: { kind: "path", path: valueName } }, value } }] };
    }
    return field.storage === "property"
      ? writeRustStructuralObjectProperty(
          receiverCarrier,
          receiver,
          field,
          storageIndex,
          operator,
          value,
          context,
        )
      : writeRustStructuralObjectField(receiver, path, operator, value);
  }
  const dispatch = rustStoredProjectFieldDispatch(receiverCarrier, storageIndex, context);
  if (dispatch !== undefined) {
    const roles = planRustProjectFieldDispatchRoles(dispatch.plan, context);
    if (roles?.write === undefined || projection.length !== 0 || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    return writeRustProjectDispatchedField(receiver, allocateRustSyntheticName(context.syntheticNames, "field_owner"),
      dispatch.read, dispatch.write, operator, value, { read: roles.read, write: roles.write });
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  const declaration = rustStoredProjectFieldDeclaration(receiverCarrier, storageIndex, context);
  const captured = declaration === undefined ? undefined : rustCapturedFieldStorage(declaration, context);
  return path === undefined || representation === undefined
    ? failRustPlannerInvariant("An admitted writable project field requires its native storage path and representation.", context.sourceFile)
    : writeRustProjectObjectField(receiver, captured === undefined ? [...path, ...projection] : path, operator, value, representation,
      captured, captured === undefined ? [] : projection);
}

export function mutateRustStoredObjectField(
  storage: "project-object" | "structural-object",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  mutation: (field: RustExpr) => RustExpr | undefined,
  context: RustPlanContext,
  access: "property" | "content" = "property",
): RustExpr | undefined {
  if (access === "content") return mutateRustStoredObjectFieldStorage(storage, receiverCarrier, receiver, storageIndex, mutation, context, access);
  const check = context.input.program.records.storedField.get(storage, receiverCarrier, storageIndex)?.check;
  if (storage === "structural-object" && context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field?.storage === "property") {
    return mutateRustStoredObjectFieldStorage(storage, receiverCarrier, receiver, storageIndex, mutation, context);
  }
  if (check === undefined) return mutateRustStoredObjectFieldStorage(storage, receiverCarrier, receiver, storageIndex, mutation, context);
  const region = context.fallibleBoundary;
  if (region === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "field_owner");
  const selected: RustExpr = { kind: "path", path: receiverName };
  const effect = mutateRustStoredObjectFieldStorage(storage, receiverCarrier, selected, storageIndex, mutation, context);
  const checked = effect === undefined ? undefined : checkRustDataWrite(check, selected, effect, region);
  return checked === undefined ? undefined : rustValueBlock([{ name: receiverName, value: cloneExpression(receiver) }], checked);
}

function mutateRustStoredObjectFieldStorage(
  storage: "project-object" | "structural-object",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  mutation: (field: RustExpr) => RustExpr | undefined,
  context: RustPlanContext,
  access: "property" | "content" = "property",
): RustExpr | undefined {
  if (storage === "structural-object") {
    const field = context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)?.field;
    if (field === undefined) {
      failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    }
    if (field.storage === "bound") return mutateRustBoundRecordField(receiver, field, mutation, context);
    if (context.input.program.records.structuralObjectStorage.get(receiverCarrier)?.value === true) {
      return field.storage !== "stored" || field.method === true || access === "property" && field.readonly || field.nativeLayout !== undefined
        ? failRustPlannerInvariant("An admitted native value mutation requires its writable direct storage.", context.sourceFile) : mutation({ kind: "field", receiver, name: field.targetName });
    }
    if (field.nativeLayout !== undefined) {
      if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
      const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
      const body = mutation({ kind: "dereference", pointer: { kind: "path", path: valueName } });
      return body === undefined ? failRustPlannerInvariant("An admitted native location mutation requires its finalized body.", context.sourceFile) : { kind: "method-call",
        receiver: readRustStructuralObjectField(receiver, field.targetName, context.input.program.records.structuralFieldStorage.get(receiverCarrier, storageIndex)!.location!, context),
        method: "with_mut", args: [{ kind: "closure", params: [{ name: valueName, byRefCopy: false }], body }] };
    }
    if (field.method === true || access === "property" && field.readonly) {
      failRustPlannerInvariant("An admitted stored field requires its exact sealed storage, access role and native emission context.", context.sourceFile);
    }
    return field.storage === "property"
      ? mutateRustStructuralObjectProperty(
          receiverCarrier,
          receiver,
          field,
          storageIndex,
          mutation,
          context,
        )
      : mutateRustStructuralObjectField(receiver, field.targetName, mutation);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  return path === undefined || representation === undefined
    ? failRustPlannerInvariant("An admitted project field mutation requires its native storage path and representation.", context.sourceFile)
    : mutateRustProjectObjectField(receiver, path, mutation, representation);
}

export function rustProjectObjectRepresentation(
  carrier: TargetTypeRef,
  context: RustPlanContext,
) {
  return context.input.program.records.objectRepresentation.get(context.input.program.records.projectType.get(carrier));
}
