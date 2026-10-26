import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPropagateLocalError, rustErrorType } from "../program/fallible-boundaries.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import type { RustBindingStorageFact } from "../../../target-model/records/operation-selections.js";
import type { Node } from "@tsonic/tsts";
import { rustBindingStorageOperations, type RustBindingStorageOperations } from "./binding-storage.js";
import type {
  RustAssignmentOperator,
  RustBinaryOperator,
} from "../../../target-model/syntax/tokens.js";
import {
  Node_Expression,
} from "@tsonic/target-api/source";
import { planFinalizedTargetInput } from "./conversions.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import {
  rustProgramErrorTargetType,
} from "../../../target-model/types/index.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustSourceBindingPath, rustCurrentErrorBoundary } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  rustProjectObjectRepresentation,
  readRustStoredObjectField,
  writeRustStoredObjectField,
} from "../objects/project-storage.js";
import { rustModuleCellAccess } from "../project/module-storage.js";
import {
  readRustProjectDispatchedField,
  writeRustProjectDispatchedField,
  readRustStructuralObjectField,
} from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

import { planNativeRustArrayAccess } from "./native-arrays.js";
import { rustRecordFieldStorageType, rustRecordFieldSelector } from "../objects/record-fields.js";
import { rustExpressionHasReferenceObjectField, planRustReferenceObjectFieldLocation } from "./object-field-locations.js";
import { rustPreparedValueLocation } from "../objects/value-fields.js";
import type { RustExpressionAccess } from "./entry.js";
import type { RustCaptureReadOwnership, RustReadOwnershipFact } from "../../../target-model/records/ownership.js";

export type RustExpressionPlanner = (
  node: Node,
  context: RustPlanContext,
  resultUse?: import("./entry.js").RustExpressionResultUse,
  access?: RustExpressionAccess,
) => RustExpr | undefined;

export function fallibleLocationAccess(node: Node, expression: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const operandBoundary = rustCurrentErrorBoundary(context);
  if (operandBoundary === undefined || context.fallibleBoundary === undefined) {
    failRustPlannerInvariant("An admitted source pointer access requires its exact retained callback error boundary.", node);
  }
  return rustPropagateLocalError(context.fallibleBoundary, rustErrorType(operandBoundary), expression);
}

export function planRustIdentifierValue(
  node: Node,
  path: string,
  context: RustPlanContext,
  access: RustExpressionAccess = "value",
): RustExpr {
  const prepared = rustPreparedValueLocation(node, context);
  if (prepared !== undefined) return prepared.read;
  const binding = context.input.program.records.sourceBinding.get(node);
  const module = binding === undefined ? undefined
    : context.input.program.records.moduleBinding.get(binding.sourceDeclaration);
  if (module?.storage === "native-const" && context.input.program.records.typeEmission.get(module.valueCarrier)?.string === true) {
    const value: RustExpr = { kind: "path", path };
    return access === "value" ? { kind: "owned-string-from-borrowed-str", expression: value } : value;
  }
  const captured = rustCapturedBinding(node, context);
  const storage = rustLocationStorageForReference(node, context);
  const value: RustExpr = captured?.expression ?? { kind: "path", path };
  if (context.input.program.records.nativeArrayStorage.get(node)?.kind === "reference") {
    return access === "value" ? planRustValueRead(node, value, context) : value;
  }
  const bindingStorage = captured !== undefined && captured.storage !== "value" ? captured.storage
    : storage?.storage === "local-location" ? "location"
    : storage?.storage === "module-cell" ? undefined : storage?.storage;
  if (bindingStorage !== undefined) {
    const operations = rustBindingStorageOperations(bindingStorage);
    const receiver = captured?.referent ?? value;
    return bindingStorage === "borrow-cell" && access !== "value"
      ? { kind: "dereference", pointer: operations.borrowedRead(receiver) }
      : operations.read(receiver);
  }
  if (storage?.storage === "module-cell") {
    return rustModuleCellAccess(value, "load", []);
  }
  if (captured?.borrowed !== undefined) {
    const referent = captured.referent;
    const borrowed = captured.borrowedCarrier;
    if (borrowed !== undefined && context.input.program.records.typeEmission.get(borrowed)?.sharedStringReference === true) {
      return access === "value" ? { kind: "owned-string-from-borrowed-str", expression: value } : value;
    }
    if (access === "shared-receiver" && captured.borrowed === "shared" &&
      (referent === undefined || borrowed?.kind === "reference" && !borrowed.mutable)) return value;
    if (access !== "value") return referent ?? { kind: "dereference", pointer: value };
    return requireRustReadOwnership(node, context).snapshot?.kind === "copy"
      ? referent ?? { kind: "dereference", pointer: value }
      : cloneRustExpression(referent ?? value);
  }
  return access === "value" ? planRustValueRead(node, value, context) : value;
}

export function planRustValueRead(
  node: Node,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr {
  return requireRustReadOwnership(node, context).source.kind === "clone" ? cloneRustExpression(value) : value;
}

export function requireRustReadOwnership(node: Node, context: RustPlanContext): RustReadOwnershipFact {
  const selected = context.input.program.records.readOwnership.get(node);
  if (selected === undefined) return failRustPlannerInvariant(
    "A value read has no selected ownership record at the sealed-program boundary.", node);
  return selected;
}

export function requireRustCaptureOwnership(owner: Node, declaration: Node, context: RustPlanContext): RustCaptureReadOwnership {
  const selected = context.input.program.records.captureOwnership.get(owner)?.find(capture => capture.declaration === declaration);
  if (selected === undefined) return failRustPlannerInvariant(
    "A capture read has no selected ownership record at the sealed-program boundary.", owner);
  return selected;
}

export function planRustCaptureValue(
  owner: Node,
  capture: Pick<RustCaptureReadOwnership, "declaration" | "reference">,
  path: string,
  storage: "value" | "location" | "cell" | "borrow-cell",
  context: RustPlanContext,
  use: "read" | "invocation" = "read",
): RustExpr {
  const node = capture.reference;
  const captured = rustCapturedBinding(node, context);
  const selectedValue: RustExpr = captured?.expression ?? { kind: "path", path };
  const capturedValue = captured?.referent ?? selectedValue;
  if (storage === "cell" || storage === "borrow-cell") return capturedValue;
  const selected = requireRustCaptureOwnership(owner, capture.declaration, context);
  const read = captured?.borrowed === undefined ? selected[use] : selected.borrowed;
  if (read === undefined) return failRustPlannerInvariant(
    "A borrowed capture has no selected native snapshot operation.", node);
  return read.kind === "clone" ? cloneRustExpression(capturedValue) : capturedValue;
}

export function planRustSharedReceiver(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
  later?: Node,
): RustExpr {
  const value = expression;
  if (later !== undefined && !requireRustReadOwnership(node, context).borrowedAcross.has(later) &&
    requireRustReadOwnership(node, context).value.kind === "borrow") {
    return failRustPlannerInvariant("A shared receiver lost its selected source evaluation-order borrow.", node);
  }
  const override = context.expressionOverrides?.get(node);
  if (override?.valueForm === "shared-reference") {
    return value;
  }
  if (override?.valueForm === "storage" && override.storageForm === "borrow-guard" ||
    override === undefined && context.input.program.records.argumentView.get(node)?.borrowedStorage === "borrow-guard") {
    return { kind: "reference", expr: value };
  }
  const captured = rustCapturedBinding(node, context);
  const ownership = requireRustReadOwnership(node, context);
  if (captured?.storage === "value" && captured.borrowed !== undefined) {
    if (ownership.source.kind === "borrow" && captured.borrowedCarrier !== undefined &&
      context.input.program.records.typeEmission.get(captured.borrowedCarrier)?.sharedStringReference === true) return value;
    if (captured.borrowed === "shared" && captured.referent === undefined && value === captured.expression &&
      ownership.source.kind === "borrow") return value;
    if (captured.borrowed === "shared" && captured.referent === undefined && value.kind === "dereference" &&
      ownership.source.kind === "borrow") return value.pointer;
    return { kind: "reference", expr: value };
  }
  if (context.input.program.records.readOwnership.get(node)?.sharedReference === true) return value;
  const projection = override === undefined && context.flowReadOverrides?.has(node) !== true
    ? context.input.program.records.valueProjection.get(node) : undefined;
  if (value.kind === "dereference" && projection?.borrowable === true && projection.contextual === undefined) return value.pointer;
  const kind = context.input.program.source.ast.kindName(node);
  return override === undefined &&
      (kind === "KindThisExpression" || kind === "KindThisKeyword")
    ? value
    : { kind: "reference", expr: value };
}

export function planRustMutableProjectReceiver(
  node: Node,
  expression: RustExpr,
  receiverCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr {
  const representation = rustProjectObjectRepresentation(receiverCarrier, context);
  if (representation?.kind !== "value") {
    return planRustSharedReceiver(node, expression, context);
  }
  const value = expression;
  const kind = context.input.program.source.ast.kindName(node);
  const target = kind === "KindThisExpression" || kind === "KindThisKeyword"
    ? { kind: "dereference" as const, pointer: value }
    : value;
  return { kind: "reference", expr: target, mutable: true };
}

export function rustLocationStorageForReference(
  node: Node,
  context: RustPlanContext,
): {
  readonly declaration: Node;
  readonly storage: "local-location" | "module-cell" | "cell" | "borrow-cell";
  readonly valueCarrier: TargetTypeRef;
} | undefined {
  const declaration = context.input.program.records.sourceBinding.get(node)
    ?.sourceDeclaration;
  const captured = declaration === undefined
    ? undefined
    : rustCapturedBindingForDeclaration(declaration, context);
  if (declaration !== undefined && captured !== undefined) {
    return captured.storage !== "value"
      ? {
          declaration,
          storage: captured.storage === "location" ? "local-location" : captured.storage,
          valueCarrier: captured.valueCarrier,
        }
      : undefined;
  }
  const localStorage = declaration === undefined
    ? undefined
    : context.input.program.records.bindingStorage.get(declaration);
  if (declaration !== undefined && localStorage !== undefined) {
    return {
      declaration,
      storage: localStorage.storage === "location" ? "local-location" : localStorage.storage,
      valueCarrier: localStorage.valueCarrier,
    };
  }
  const moduleBinding = declaration === undefined
    ? undefined
    : context.input.program.records.moduleBinding.get(declaration);
  const valueCarrier = moduleBinding?.storage === "module-cell"
    ? moduleBinding.valueCarrier
    : moduleBinding?.storage === "native-callable"
      ? moduleBinding.value?.carrier
      : undefined;
  return declaration !== undefined && valueCarrier !== undefined
    ? { declaration, storage: "module-cell", valueCarrier }
    : undefined;
}

export function rustBindingStorageForDeclaration(
  declaration: Node,
  context: RustPlanContext,
): RustBindingStorageFact | undefined {
  return context.input.program.records.bindingStorage.get(declaration);
}

export function rustRawLocationRoot(
  expression: Node,
  context: RustPlanContext,
  cloneRoot = false,
): RustExpr | undefined {
  const prepared = rustPreparedValueLocation(expression, context);
  if (prepared?.address !== undefined) {
    const address = prepared.address(undefined, context);
    return address?.kind === "infallible" ? address.value : undefined;
  }
  const binding = context.input.program.records.sourceBinding.get(expression);
  if (binding === undefined) {
    return undefined;
  }
  const storage = rustLocationStorageForReference(expression, context);
  if (storage === undefined) return undefined;
  const captured = rustCapturedBinding(expression, context);
  const sourcePath = captured === undefined ? rustSourceBindingPath(context, binding) : undefined;
  if (captured === undefined && sourcePath === undefined) return undefined;
  const selectedValue: RustExpr = captured?.expression ?? { kind: "path", path: sourcePath! };
  const value = captured?.referent ?? selectedValue;
  return storage.storage === "module-cell" ? rustModuleCellAccess(value, "location", [])
    : cloneRoot && storage.storage === "local-location" ? cloneRustExpression(value) : value;
}

export function planRustModuleBindingStore(
  expression: Node,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const ast = context.input.program.source.ast;
  let target = expression;
  while (ast.kindName(target) === "KindParenthesizedExpression") {
    const inner = Node_Expression(ast, target);
    if (inner === undefined) return undefined;
    target = inner;
  }
  if (ast.kindName(target) !== "KindIdentifier") return undefined;
  const binding = context.input.program.records.sourceBinding.get(target);
  if (binding === undefined || rustLocationStorageForReference(target, context)?.storage !== "module-cell") {
    return undefined;
  }
  const path = rustSourceBindingPath(context, binding);
  if (path === undefined || context.syntheticNames === undefined) return undefined;
  const valueName = allocateRustSyntheticName(context.syntheticNames, "module_value");
  return rustValueBlock([{ name: valueName, value }], rustModuleCellAccess({ kind: "path", path }, "store", [{ kind: "path", path: valueName }]));
}

export function rustCapturedBinding(
  node: Node,
  context: RustPlanContext,
): import("../program/plan-context.js").RustCapturedBinding | undefined {
  const declaration = context.input.program.records.sourceBinding.get(node)
    ?.sourceDeclaration ?? context.input.program.records.sourceReferenceDeclaration.get(node);
  return declaration === undefined
    ? undefined
    : rustCapturedBindingForDeclaration(declaration, context);
}

function rustCapturedBindingForDeclaration(
  declaration: Node,
  context: RustPlanContext,
): import("../program/plan-context.js").RustCapturedBinding | undefined {
  const bindings = context.capturedBindings ?? [];
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    const binding = bindings[index]!;
    if (binding.declaration === declaration) {
      return binding;
    }
  }
  return undefined;
}

export type RustPromotedStorageWritePlan =
  | { readonly handled: false }
  | { readonly handled: true; readonly statement?: RustStmt };

export type RustPromotedStorageLocationPlan =
  | { readonly kind: "not-promoted" }
  | {
      readonly kind: "promoted";
      readonly expression?: RustExpr;
      readonly rootDeclaration: Node;
      readonly read: RustBindingStorageOperations["read"];
      readonly write: RustBindingStorageOperations["write"];
    };

export function planRustPromotedStorageLocation(
  expression: Node,
  context: RustPlanContext,
  planExpression: RustExpressionPlanner,
  cloneRoot = true,
): RustPromotedStorageLocationPlan {
  const root = findRustLocationStorageRoot(expression, context);
  return root === undefined
    ? { kind: "not-promoted" }
    : {
        kind: "promoted",
        expression: planRustLocationStorage(
          expression,
          root.expression,
          cloneRoot,
          context,
          planExpression,
        ),
        rootDeclaration: root.declaration,
        ...rustPromotedStorageMethods(root.expression, context),
      };
}

export function planRustPromotedStorageWrite(
  expression: Node,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
  planExpression: RustExpressionPlanner,
): RustPromotedStorageWritePlan {
  const root = findRustLocationStorageRoot(expression, context);
  if (root === undefined) {
    return { handled: false };
  }
  if (rustExpressionHasBoundRecordField(expression, context) || rustExpressionHasReferenceObjectField(expression, context)) {
    const location = planRustSourceLocationStorage(expression, root.expression, context, planExpression);
    if (location === undefined || context.syntheticNames === undefined) return { handled: true };
    const locationName = allocateRustSyntheticName(context.syntheticNames, "field_location");
    const currentName = allocateRustSyntheticName(context.syntheticNames, "field_value");
    const valueName = allocateRustSyntheticName(context.syntheticNames, "field_next");
    const pointer: RustExpr = { kind: "path", path: locationName };
    const current = operator === "=" ? undefined : fallibleLocationAccess(expression,
      { kind: "method-call", receiver: pointer, method: "try_load", args: [] }, context);
    if (operator !== "=" && current === undefined) return { handled: true };
    const binary = assignmentBinaryOperator(operator);
    if (operator !== "=" && binary === undefined) return { handled: true };
    const operand: RustExpr = { kind: "path", path: valueName };
    const next: RustExpr = operator === "=" ? operand : { kind: "binary", operator: binary!,
      left: { kind: "path", path: currentName }, right: operand };
    const write = fallibleLocationAccess(expression,
      { kind: "method-call", receiver: pointer, method: "try_store", args: [next] }, context);
    return { handled: true, ...(write === undefined ? {} : { statement: { kind: "expr", expr: rustValueBlock([{ name: locationName, value: location },
        ...(current === undefined ? [] : [{ name: currentName, value: current }]), { name: valueName, value }], write) } }) };
  }
  const location = planRustLocationStorage(
    expression,
    root.expression,
    false,
    context,
    planExpression,
  );
  if (location === undefined) {
    return { handled: true };
  }
  const methods = rustPromotedStorageMethods(root.expression, context);
  const binaryOperator = assignmentBinaryOperator(operator);
  if (operator !== "=" && binaryOperator === undefined) {
    return { handled: true };
  }
  if (context.syntheticNames === undefined) {
    return failRustPlannerInvariant(
      "Promoted-location assignment requires a finalized hygienic-name scope.", expression);
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
  const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  return {
    handled: true,
    statement: {
      kind: "expr",
      expr: rustValueBlock([
          {
            name: locationName,
            value: { kind: "reference", expr: location },
          },
          ...(binaryOperator === undefined ? [] : [{
            name: currentName,
            value: methods.read(locationPath),
          }]),
          { name: valueName, value },
        ], methods.write(locationPath, binaryOperator === undefined ? { kind: "path", path: valueName } : {
            kind: "binary",
            operator: binaryOperator,
            left: { kind: "path", path: currentName },
            right: { kind: "path", path: valueName },
          })),
    },
  };
}

function assignmentBinaryOperator(
  operator: RustAssignmentOperator,
): RustBinaryOperator | undefined {
  switch (operator) {
    case "+=":
      return "+";
    case "-=":
      return "-";
    case "*=":
      return "*";
    case "/=":
      return "/";
    case "%=":
      return "%";
    case "&=":
      return "&";
    case "|=":
      return "|";
    case "^=":
      return "^";
    case "<<=":
      return "<<";
    case ">>=":
      return ">>";
    case "=":
      return undefined;
  }
}

export function rustExpressionHasBoundRecordField(expression: Node, context: RustPlanContext): boolean {
  const operation = context.input.program.records.targetOperation.get(expression);
  return operation?.kind === "source-field" && operation.storage === "structural-object" &&
    context.input.program.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex)?.field.storage === "bound";
}

export function planRustSourceLocationStorage(
  expression: Node, rootExpression: Node, context: RustPlanContext, planExpression: RustExpressionPlanner,
  cloneRoot = true,
): RustExpr | undefined {
  const operation = context.input.program.records.targetOperation.get(expression);
  const prepared = rustPreparedValueLocation(expression, context);
  if (prepared?.address !== undefined) {
    const address = prepared.address(operation?.kind === "source-field" ? operation.operationId : undefined, context);
    const error = address?.kind === "infallible" ? rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context) : undefined;
    return address === undefined ? undefined : address.kind === "fallible" ? address.value
      : error === undefined ? undefined : { kind: "method-call", receiver: address.value, method: "into_fallible",
        genericArguments: [{ kind: "type", type: error }], args: [] };
  }
  if (rustExpressionHasReferenceObjectField(expression, context)) {
    return planRustReferenceObjectFieldLocation(expression, context, planExpression);
  }
  if (operation?.kind === "source-field" && operation.storage === "structural-object") {
    const selected = context.input.program.records.structuralFieldStorage.get(operation.receiverCarrier, operation.storageIndex);
    const field = selected?.field;
    if (field?.storage === "bound") {
      const receiver = Node_Expression(context.input.program.source.ast, expression);
      const owner = rustRecordFieldStorageType(field, context);
      if (receiver === undefined || owner === undefined) return undefined;
      const value = selected!.value;
      const receiverValue = value ? planRustSourceLocationStorage(receiver, rootExpression, context, planExpression)
        : planExpression(receiver, context);
      if (receiverValue === undefined) return undefined;
      context.usedAliases?.add("rt");
      const result: RustExpr = { kind: "associated-call", owner,
        method: value ? "location_from_value" : "location_from_object", args: [
          { kind: "reference", expr: receiverValue },
          { kind: "call", path: "String::from", args: [{ kind: "str-literal", value: operation.operationId }] },
          rustRecordFieldSelector(field, false), rustRecordFieldSelector(field, true),
        ] };
      return value ? fallibleLocationAccess(expression, result, context) : result;
    }
  }
  const location = planRustLocationStorage(expression, rootExpression, cloneRoot, context, planExpression);
  const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  return location === undefined || error === undefined ? undefined : { kind: "method-call", receiver: location, method: "into_fallible",
    genericArguments: [{ kind: "type", type: error }], args: [] };
}

export function planRustLocationStorage(
  expression: Node,
  rootExpression: Node,
  cloneRoot: boolean,
  context: RustPlanContext,
  planExpression: RustExpressionPlanner,
): RustExpr | undefined {
  const selected = context.input.program.records.locationProjection.get(expression);
  if (selected === undefined) failRustPlannerInvariant("An admitted native location requires its exact source projection plan.", expression);
  if (selected.kind === "native-array") {
    return planNativeRustArrayAccess(expression, context, planExpression, "location_at");
  }
  if (selected.kind === "structural-field") {
    const value = planExpression(selected.receiver, context);
    return value === undefined ? undefined : readRustStructuralObjectField(value, selected.name, selected.carrier, context);
  }
  if (expression === rootExpression) {
    const root = rustRawLocationRoot(expression, context, cloneRoot);
    if (root === undefined) failRustPlannerInvariant("An admitted local storage root requires its canonical Rust location.", expression);
    return ["cell", "borrow-cell"].includes(rustLocationStorageForReference(expression, context)?.storage ?? "")
        ? { kind: "reference", expr: root }
        : root;
  }
  if (selected.kind === "parenthesized") {
    return planRustLocationStorage(selected.inner, rootExpression, cloneRoot, context, planExpression);
  }
  if (selected.kind === "root") failRustPlannerInvariant("An admitted projected location requires its exact root identity.", expression);
  const receiverNode = selected.receiver;
  if (selected.kind === "indexed-method") {
    const receiver = planExpression(receiverNode, context);
    const index = planFinalizedTargetInput(context, selected.input, receiverNode, [selected.index], expression);
    return receiver === undefined || index === undefined ? undefined : {
      kind: "method-call", receiver, method: selected.method, args: [index],
    };
  }
  const receiverLocation = planRustLocationStorage(
    receiverNode,
    rootExpression,
    cloneRoot,
    context,
    planExpression,
  );
  if (receiverLocation === undefined) {
    return undefined;
  }
  if (selected.kind === "member") {
    const operation = selected.operation;
    const dispatchPlan = operation.dispatch === undefined
      ? undefined
      : operation.declaration === undefined
        ? undefined
        : context.input.program.records.projectFieldDispatch.get(operation.declaration);
    if (operation.dispatch !== undefined &&
      (dispatchPlan?.write === undefined ||
        dispatchPlan.read.fallible || dispatchPlan.write.fallible)) {
      failRustPlannerInvariant("An admitted typed location requires its infallible physical field dispatch.", expression);
    }
    const dispatchRoles = dispatchPlan === undefined
      ? undefined
      : planRustProjectFieldDispatchRoles(dispatchPlan, context);
    if (dispatchPlan !== undefined && dispatchRoles?.write === undefined) {
      failRustPlannerInvariant("An admitted projected member requires its exact Rust dispatch ABI.", expression);
    }
    const ownerName = "location_owner";
    const valueName = "location_value";
    const owner: RustExpr = { kind: "path", path: ownerName };
    const read = operation.dispatch === undefined
      ? readRustStoredObjectField(
          operation.storage,
          operation.receiverCarrier,
          owner,
          operation.storageIndex,
          operation.resultCarrier,
          context,
        )
      : readRustProjectDispatchedField(owner, operation.dispatch.read, dispatchRoles!.read);
    const write = operation.dispatch === undefined
      ? writeRustStoredObjectField(
          operation.storage,
          operation.receiverCarrier,
          owner,
          operation.storageIndex,
          "=",
          { kind: "path", path: valueName },
          context,
        )
      : writeRustProjectDispatchedField(
          owner,
          "location_dispatch_receiver",
          operation.dispatch.read,
          operation.dispatch.write,
          "=",
          { kind: "path", path: valueName },
          {
            read: dispatchRoles!.read,
            write: dispatchRoles!.write!,
          },
        );
    if (read === undefined || write === undefined) {
      failRustPlannerInvariant("An admitted projected member requires its exact Rust storage path.", expression);
    }
    return {
      kind: "method-call",
      receiver: receiverLocation,
      method: "project_member",
      args: [
        { kind: "str-literal", value: operation.operationId },
        {
          kind: "closure",
          params: [{ name: ownerName, byRefCopy: false }],
          body: read,
        },
        {
          kind: "closure",
          params: [
            { name: ownerName, byRefCopy: false },
            { name: valueName, byRefCopy: false },
          ],
          body: write,
        },
      ],
    };
  }
  if (selected.kind === "index") {
    const index = planFinalizedTargetInput(context, selected.input, receiverNode, [selected.index], expression);
    if (index === undefined) return undefined;
    return {
      kind: "method-call",
      receiver: receiverLocation,
      method: "project_index",
      args: [index],
    };
  }
  return failRustPlannerInvariant("An admitted Rust location requires a supported sealed projection.", expression);
}

function rustPromotedStorageMethods(node: Node, context: RustPlanContext): RustBindingStorageOperations {
  const storage = rustLocationStorageForReference(node, context)?.storage;
  return rustBindingStorageOperations(storage === "cell" || storage === "borrow-cell" ? storage : "location");
}

export function findRustLocationStorageRoot(
  expression: Node,
  context: RustPlanContext,
): { readonly expression: Node; readonly declaration: Node } | undefined {
  const root = context.input.program.records.locationStorageRoot.get(expression);
  if (root === undefined) failRustPlannerInvariant("An admitted source location requires its exact root classification.", expression);
  if (root === null) return undefined;
  const captured = rustCapturedBindingForDeclaration(root.declaration, context);
  return captured?.storage === "value" ? undefined : root;
}
