import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import type { RustBindingStorageFact } from "../../../target-model/records/operation-selections.js";
import type { Node } from "@tsonic/tsts";
import { rustBindingStorageOperations, type RustBindingStorageOperations } from "./binding-storage.js";
import type {
  RustAssignmentOperator,
  RustBinaryOperator,
} from "../../../target-model/syntax/tokens.js";
import {
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { rustIndexedLocationContract } from "../../../analysis/operations/indexed-location.js";
import { planFinalizedTargetInput } from "./conversions.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import {
  isRustStringCarrier,
  rustLocationTargetType,
  rustProgramErrorTargetType,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { unsupportedConstructDiagnostic } from "../diagnostics.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import {
  diagnosticInput,
  rustSourceBindingPath,
  rustCurrentErrorBoundary,
  rustErrorType,
} from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustProjectObjectRepresentation } from "../objects/project-storage.js";
import { rustModuleCellAccess } from "../project/module-storage.js";
import {
  readRustProjectDispatchedField,
  writeRustProjectDispatchedField,
  readRustStructuralObjectField,
} from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import {
  readRustStoredObjectField,
  writeRustStoredObjectField,
} from "../objects/project-storage.js";
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
    return rejectLocationStorage(node, context, "A source pointer access requires its exact retained callback error boundary.");
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
  if (module?.storage === "native-const" && isRustStringCarrier(module.valueCarrier)) {
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
    const receiver = value.kind === "reference" ? value.expr : value;
    return bindingStorage === "borrow-cell" && access !== "value"
      ? { kind: "dereference", pointer: operations.borrowedRead(receiver) }
      : operations.read(receiver);
  }
  if (storage?.storage === "module-cell") {
    return rustModuleCellAccess(value, "load", []);
  }
  if (captured?.borrowed !== undefined) {
    const referent = value.kind === "reference" ? value.expr : undefined;
    const borrowed = captured.borrowedCarrier;
    if (borrowed?.kind === "reference" && !borrowed.mutable && isRustStringCarrier(borrowed.referent)) {
      return access === "value" ? { kind: "owned-string-from-borrowed-str", expression: value } : value;
    }
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
  const selected = context.input.program.ownership.reads.get(node);
  if (selected === undefined) return failRustPlannerInvariant(
    "A value read has no selected ownership record at the sealed-program boundary.", node);
  return selected;
}

export function requireRustCaptureOwnership(owner: Node, declaration: Node, context: RustPlanContext): RustCaptureReadOwnership {
  const selected = context.input.program.ownership.captures.get(owner)?.find(capture => capture.declaration === declaration);
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
  const capturedValue = selectedValue.kind === "reference" ? selectedValue.expr : selectedValue;
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
  const captured = rustCapturedBinding(node, context);
  if (captured?.storage === "value" && captured.borrowed !== undefined) {
    return captured.borrowed === "shared"
      ? captured.expression.kind === "reference" ? { kind: "reference", expr: value } : value
      : { kind: "reference", expr: { kind: "dereference", pointer: value } };
  }
  if (context.input.program.ownership.reads.get(node)?.sharedReference === true) return value;
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
  const value = selectedValue.kind === "reference" ? selectedValue.expr : selectedValue;
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
    ?.sourceDeclaration ?? context.input.program.sourceNavigation.sourceReferenceFor(node)?.declaration;
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
    if (binding.declaration === declaration ||
      (context.input.program.source.ast.getSourceFile(binding.declaration) === context.input.program.source.ast.getSourceFile(declaration) &&
        context.input.program.source.ast.kind(binding.declaration) === context.input.program.source.ast.kind(declaration) &&
        context.input.program.source.ast.pos(binding.declaration) === context.input.program.source.ast.pos(declaration) &&
        context.input.program.source.ast.end(binding.declaration) === context.input.program.source.ast.end(declaration))) {
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
    const pointer: RustExpr = { kind: "path", path: locationName };
    const current = operator === "=" ? undefined : fallibleLocationAccess(expression,
      { kind: "method-call", receiver: pointer, method: "try_load", args: [] }, context);
    if (operator !== "=" && current === undefined) return { handled: true };
    const binary = assignmentBinaryOperator(operator);
    if (operator !== "=" && binary === undefined) return { handled: true };
    const next: RustExpr = operator === "=" ? value : { kind: "binary", operator: binary!,
      left: { kind: "path", path: currentName }, right: value };
    const write = fallibleLocationAccess(expression,
      { kind: "method-call", receiver: pointer, method: "try_store", args: [next] }, context);
    return { handled: true, ...(write === undefined ? {} : { statement: { kind: "expr", expr: rustValueBlock([{ name: locationName, value: location },
        ...(current === undefined ? [] : [{ name: currentName, value: current }])], write) } }) };
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
  if (operator === "=") {
    return {
      handled: true,
      statement: {
        kind: "expr",
        expr: methods.write(location, value),
      },
    };
  }
  const binaryOperator = assignmentBinaryOperator(operator);
  if (binaryOperator === undefined) {
    return { handled: true };
  }
  if (context.syntheticNames === undefined) {
    return failRustPlannerInvariant(
      "Promoted-location compound assignment requires a finalized hygienic-name scope.", expression);
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
          {
            name: currentName,
            value: methods.read(locationPath),
          },
          { name: valueName, value },
        ], methods.write(locationPath, {
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
    context.input.program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex)?.storage === "bound";
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
    const field = context.input.program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex);
    if (field?.storage === "bound") {
      const receiver = Node_Expression(context.input.program.source.ast, expression);
      const owner = rustRecordFieldStorageType(field, context);
      if (receiver === undefined || owner === undefined) return undefined;
      const value = rustStructuralObjectCarrierValue(operation.receiverCarrier)?.representation === "value";
      const selected = value ? planRustSourceLocationStorage(receiver, rootExpression, context, planExpression)
        : planExpression(receiver, context);
      if (selected === undefined) return undefined;
      context.usedAliases?.add("rt");
      const result: RustExpr = { kind: "associated-call", owner,
        method: value ? "location_from_value" : "location_from_object", args: [
          { kind: "reference", expr: selected },
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
  if (context.input.program.records.nativeArrayStorage.get(expression)?.kind === "element") {
    return planNativeRustArrayAccess(expression, context, planExpression, "location_at");
  }
  const fieldOperation = context.input.program.records.targetOperation.get(expression);
  if (fieldOperation?.kind === "source-field" && fieldOperation.storage === "structural-object") {
    const field = context.input.program.structuralShapes.field(fieldOperation.receiverCarrier, fieldOperation.storageIndex);
    if (field?.nativeLayout !== undefined) {
      const receiver = Node_Expression(context.input.program.source.ast, expression);
      const value = receiver === undefined ? undefined : planExpression(receiver, context);
      return value === undefined ? undefined
        : readRustStructuralObjectField(value, field.targetName, rustLocationTargetType(field.carrier), context);
    }
  }
  if (expression === rootExpression) {
    const root = rustRawLocationRoot(expression, context, cloneRoot);
    return root === undefined
      ? rejectLocationStorage(
          expression,
          context,
          "The finalized local storage root did not emit a canonical Rust location.",
        )
      : ["cell", "borrow-cell"].includes(rustLocationStorageForReference(expression, context)?.storage ?? "")
        ? { kind: "reference", expr: root }
        : root;
  }
  if (context.input.program.source.ast.kindName(expression) === "KindParenthesizedExpression") {
    const inner = Node_Expression(context.input.program.source.ast, expression);
    return inner === undefined
      ? rejectLocationStorage(
          expression,
          context,
          "The finalized parenthesized storage has no inner expression.",
        )
      : planRustLocationStorage(
          inner,
          rootExpression,
          cloneRoot,
          context,
          planExpression,
        );
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, expression);
  if (receiverNode === undefined) {
    return rejectLocationStorage(
      expression,
      context,
      "The finalized projected storage has no exact receiver expression.",
    );
  }
  const kind = context.input.program.source.ast.kindName(expression);
  const operation = context.input.program.records.targetOperation.get(expression);
  if (kind === "KindElementAccessExpression" && operation?.kind === "provider-operation" &&
      operation.indexedLocationMethod !== undefined) {
    const contract = rustIndexedLocationContract(operation, context.input.program.typeDefinitions);
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, expression);
    if (contract === undefined || indexNode === undefined) {
      return rejectLocationStorage(expression, context, "The selected index location has no exact finalized receiver, value and index input contract.");
    }
    const receiver = planExpression(receiverNode, context);
    const index = planFinalizedTargetInput(context, contract.index, receiverNode, [indexNode], expression);
    return receiver === undefined || index === undefined ? undefined : {
      kind: "method-call", receiver, method: contract.method, args: [index],
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
  if (kind === "KindPropertyAccessExpression" &&
    operation?.kind === "source-field" &&
    operation.valueSemantics.kind === "stored") {
    const dispatchPlan = operation.dispatch === undefined
      ? undefined
      : operation.declaration === undefined
        ? undefined
        : context.input.program.projectFieldDispatch.planFor(operation.declaration);
    if (operation.dispatch !== undefined &&
      (dispatchPlan?.write === undefined ||
        dispatchPlan.read.fallible || dispatchPlan.write.fallible)) {
      return rejectLocationStorage(
        expression,
        context,
        "A typed location cannot expose a project field whose dynamic dispatch may execute a fallible accessor.",
      );
    }
    const dispatchRoles = dispatchPlan === undefined
      ? undefined
      : planRustProjectFieldDispatchRoles(dispatchPlan, context);
    if (dispatchPlan !== undefined && dispatchRoles?.write === undefined) {
      return rejectLocationStorage(
        expression,
        context,
        "The finalized projected member has no exact Rust dispatch ABI.",
      );
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
      return rejectLocationStorage(
        expression,
        context,
        "The finalized projected member has no exact Rust storage path.",
      );
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
  if (kind === "KindElementAccessExpression") {
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, expression);
    const indexInput = operation?.kind === "provider-operation" &&
      operation.abi.operationKind === "indexer" && operation.abi.target.form === "index" &&
      operation.abi.targetArguments.length === 1 ? operation.abi.targetArguments[0] : undefined;
    if (indexInput === undefined || indexNode === undefined) {
      return rejectLocationStorage(
        expression,
        context,
        "The finalized Rust element storage is not one exact built-in index operation.",
      );
    }
    const index = planFinalizedTargetInput(context, indexInput, receiverNode, [indexNode], expression);
    if (index === undefined) return undefined;
    return {
      kind: "method-call",
      receiver: receiverLocation,
      method: "project_index",
      args: [index],
    };
  }
  return rejectLocationStorage(
    expression,
    context,
    "The finalized Rust storage path contains an unsupported projection.",
  );
}

function rustPromotedStorageMethods(node: Node, context: RustPlanContext): RustBindingStorageOperations {
  const storage = rustLocationStorageForReference(node, context)?.storage;
  return rustBindingStorageOperations(storage === "cell" || storage === "borrow-cell" ? storage : "location");
}

export function findRustLocationStorageRoot(
  expression: Node,
  context: RustPlanContext,
): { readonly expression: Node; readonly declaration: Node } | undefined {
  let root = expression;
  while (true) {
    const native = context.input.program.records.nativeArrayStorage.get(root);
    if (native?.kind === "element") return { expression: root, declaration: native.declaration };
    if (native !== undefined) return undefined;
    const kind = context.input.program.source.ast.kindName(root);
    if (kind !== "KindPropertyAccessExpression" &&
      kind !== "KindElementAccessExpression" &&
      kind !== "KindParenthesizedExpression") {
      break;
    }
    const receiver = Node_Expression(context.input.program.source.ast, root);
    if (receiver === undefined) {
      return undefined;
    }
    root = receiver;
  }
  if (context.input.program.source.ast.kindName(root) !== "KindIdentifier") {
    return undefined;
  }
  const storage = rustLocationStorageForReference(root, context);
  return storage === undefined
    ? undefined
    : { expression: root, declaration: storage.declaration };
}

function rejectLocationStorage(
  node: Node,
  context: RustPlanContext,
  message: string,
): undefined {
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.typed-location-storage",
    message,
  ));
  return undefined;
}
