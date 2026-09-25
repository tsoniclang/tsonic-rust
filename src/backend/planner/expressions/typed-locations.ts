import type { Node } from "@tsonic/tsts";
import { locationIndexExpression } from "./location-expressions.js";
import type {
  RustAssignmentOperator,
  RustBinaryOperator,
} from "../../../target-model/syntax/tokens.js";
import {
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { rustIndexedLocationContract } from "../../../analysis/facts/indexed-location.js";
import { planFinalizedTargetInput } from "./conversions.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  rustBindingStorageFactKey,
  rustModuleBindingFactKey,
  rustSourceBindingFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import {
  isRustStringCarrier,
  rustLocationTargetType,
  rustProgramErrorTargetType,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustSourceBindingPath,
  rustCurrentErrorBoundary,
  rustErrorType,
} from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustProjectObjectRepresentation } from "../objects/project-storage.js";
import { rustModuleCellAccess } from "../project/module-storage.js";
import { rustCarrierHasCloneContract, rustCarrierHasCopyContract } from "../types/generic-requirements.js";
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
import { rustNativeArrayStorageKey } from "../../../target-model/operations/native-memory.js";
import { planNativeRustArrayAccess } from "./native-arrays.js";
import { rustRecordFieldStorageType, rustRecordFieldSelector } from "../objects/record-fields.js";
import { rustExpressionHasReferenceObjectField, planRustReferenceObjectFieldLocation } from "./object-field-locations.js";

export type RustExpressionPlanner = (
  node: Node,
  context: RustPlanContext,
) => RustExpr | undefined;

export function fallibleLocationAccess(node: Node, expression: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const operandBoundary = rustCurrentErrorBoundary(context);
  if (operandBoundary === undefined || context.fallibleBoundary === undefined) {
    return rejectLocationStorage(node, context, "A source pointer access requires its exact retained callback error boundary.");
  }
  return { kind: "try", expr: expression,
    resultErrorType: rustErrorType(context.fallibleBoundary), operandErrorType: rustErrorType(operandBoundary) };
}

export function planRustIdentifierValue(
  node: Node,
  path: string,
  context: RustPlanContext,
): RustExpr {
  const binding = context.input.program.facts.getFact(node, rustSourceBindingFactKey);
  const module = binding === undefined ? undefined
    : context.input.program.facts.getFact(binding.sourceDeclaration, rustModuleBindingFactKey);
  if (module?.storage === "native-const" && isRustStringCarrier(module.valueCarrier)) {
    return { kind: "owned-string-from-borrowed-str", expression: { kind: "path", path } };
  }
  const captured = rustCapturedBinding(node, context);
  const storage = rustLocationStorageForReference(node, context);
  const value: RustExpr = captured?.expression ?? { kind: "path", path };
  if (context.input.program.facts.getFact(node, rustNativeArrayStorageKey)?.kind === "reference") {
    return { kind: "method-call", receiver: value, method: "clone", args: [] };
  }
  if (captured !== undefined && captured.storage !== "value") {
    return { kind: "method-call", receiver: value.kind === "reference" ? value.expr : value,
      method: captured.storage === "cell" ? "get" : "load", args: [] };
  }
  if (storage !== undefined) {
    return storage.storage === "module-cell"
      ? rustModuleCellAccess(value, "load", [])
      : { kind: "method-call", receiver: value, method: storage.storage === "cell" ? "get" : "load", args: [] };
  }
  if (captured?.borrowed === true) {
    const referent = value.kind === "reference" ? value.expr : undefined;
    return rustCarrierHasCopyContract(captured.valueCarrier, context)
      ? referent ?? { kind: "dereference", pointer: value }
      : { kind: "method-call", receiver: referent ?? value, method: "clone", args: [] };
  }
  return planRustValueRead(node, value, context);
}

export function planRustValueRead(
  node: Node,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr {
  const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  return rustReadRequiresClone(carrier, context) &&
      !context.input.program.valueLifetimes.canMove(node)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] }
    : value;
}

export function planRustCaptureValue(
  node: Node,
  path: string,
  storage: "value" | "location" | "cell",
  move: boolean,
  context: RustPlanContext,
): RustExpr {
  const captured = rustCapturedBinding(node, context);
  const capturedValue: RustExpr = captured?.expression ?? { kind: "path", path };
  if (storage === "cell") return capturedValue;
  if (storage === "location") {
    return {
      kind: "method-call",
      receiver: capturedValue,
      method: "clone",
      args: [],
    };
  }
  if (move && captured?.borrowed !== true) return capturedValue;
  const value = planRustIdentifierValue(node, path, context);
  const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  return rustReadRequiresClone(carrier, context) &&
      !(value.kind === "method-call" && value.method === "clone" && value.args.length === 0)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] }
    : value;
}

export function planRustNonConsumingValue(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr {
  const { ast } = context.input.program.source;
  let source = node;
  while (ast.is.IsParenthesizedExpression(source) || ast.is.IsAsExpression(source) ||
    ast.is.IsSatisfiesExpression(source) || ast.is.IsNonNullExpression(source) ||
    ast.is.IsTypeAssertion(source)) {
    const inner = Node_Expression(ast, source);
    if (inner === undefined) return expression;
    source = inner;
  }
  const operation = context.input.program.facts.getFact(source, rustTargetOperationFactKey);
  const kind = ast.kindName(source);
  const storageRead = ast.is.IsIdentifier(source) || ast.is.IsElementAccessExpression(source) ||
    kind === "KindThisExpression" || kind === "KindThisKeyword" ||
    operation?.kind === "source-field" && operation.valueSemantics.kind === "stored";
  if (!storageRead) return expression;
  const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  return rustReadRequiresClone(carrier, context) &&
      expression.kind === "method-call" && expression.method === "clone" &&
      expression.args.length === 0
    ? expression.receiver
    : expression;
}

export function planRustSharedReceiver(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr {
  const value = planRustNonConsumingValue(node, expression, context);
  const override = context.expressionOverrides?.get(node);
  if (override?.valueForm === "shared-reference") {
    return value;
  }
  const loaded = planRustLoadedSharedReference(node, value, context);
  if (loaded !== undefined) return loaded;
  const kind = context.input.program.source.ast.kindName(node);
  return override === undefined &&
      (kind === "KindThisExpression" || kind === "KindThisKeyword")
    ? value
    : { kind: "reference", expr: value };
}

export function planRustLoadedSharedReference(
  node: Node,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  return operation?.kind === "reference-operation" && operation.operation === "load" &&
    !operation.operandCarrier.mutable && value.kind === "dereference" ? value.pointer : undefined;
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
  const value = planRustNonConsumingValue(node, expression, context);
  const kind = context.input.program.source.ast.kindName(node);
  const target = kind === "KindThisExpression" || kind === "KindThisKeyword"
    ? { kind: "dereference" as const, pointer: value }
    : value;
  return { kind: "reference", expr: target, mutable: true };
}

function rustReadRequiresClone(carrier: TargetTypeRef | undefined, context: RustPlanContext): boolean {
  return carrier !== undefined && !rustCarrierHasCopyContract(carrier, context) &&
    rustCarrierHasCloneContract(carrier, context);
}

export function rustLocationStorageForReference(
  node: Node,
  context: RustPlanContext,
): {
  readonly declaration: Node;
  readonly storage: "local-location" | "module-cell" | "cell";
  readonly valueCarrier: TargetTypeRef;
} | undefined {
  const declaration = context.input.program.facts.getFact(node, rustSourceBindingFactKey)
    ?.sourceDeclaration;
  const captured = declaration === undefined
    ? undefined
    : rustCapturedBindingForDeclaration(declaration, context);
  if (declaration !== undefined && captured !== undefined) {
    return captured.storage !== "value"
      ? {
          declaration,
          storage: captured.storage === "cell" ? "cell" : "local-location",
          valueCarrier: captured.valueCarrier,
        }
      : undefined;
  }
  const localStorage = declaration === undefined
    ? undefined
    : context.input.program.facts.getFact(declaration, rustBindingStorageFactKey);
  if (declaration !== undefined && localStorage !== undefined) {
    return {
      declaration,
      storage: localStorage.storage === "cell" ? "cell" : "local-location",
      valueCarrier: localStorage.valueCarrier,
    };
  }
  const moduleBinding = declaration === undefined
    ? undefined
    : context.input.program.facts.getFact(declaration, rustModuleBindingFactKey);
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
): { readonly storage: "location" | "cell"; readonly valueCarrier: TargetTypeRef } | undefined {
  return context.input.program.facts.getFact(declaration, rustBindingStorageFactKey);
}

export function rustRawLocationRoot(
  expression: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const binding = context.input.program.facts.getFact(
    expression,
    rustSourceBindingFactKey,
  );
  if (binding === undefined) {
    return undefined;
  }
  const name = context.input.program.names.nameForDeclaration(binding.sourceDeclaration) ?? "";
  if (!isValidRustIdentifier(name) ||
    rustLocationStorageForReference(expression, context) === undefined) {
    return undefined;
  }
  const sourcePath = rustSourceBindingPath(context, binding);
  if (sourcePath === undefined) {
    return undefined;
  }
  const storage = rustLocationStorageForReference(expression, context);
  const value: RustExpr = rustCapturedBinding(expression, context)?.expression ?? { kind: "path", path: sourcePath };
  return storage?.storage === "module-cell"
    ? rustModuleCellAccess(value, "location", [])
    : value;
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
  const binding = context.input.program.facts.getFact(target, rustSourceBindingFactKey);
  if (binding === undefined || rustLocationStorageForReference(target, context)?.storage !== "module-cell") {
    return undefined;
  }
  const path = rustSourceBindingPath(context, binding);
  if (path === undefined || context.syntheticNames === undefined) return undefined;
  const valueName = allocateRustSyntheticName(context.syntheticNames, "module_value");
  return {
    kind: "block",
    bindings: [{ name: valueName, value }],
    value: rustModuleCellAccess({ kind: "path", path }, "store", [{ kind: "path", path: valueName }]),
  };
}

function rustCapturedBinding(
  node: Node,
  context: RustPlanContext,
): import("../program/plan-context.js").RustCapturedBinding | undefined {
  const declaration = context.input.program.facts.getFact(node, rustSourceBindingFactKey)
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
      readonly readMethod: "get" | "load";
      readonly writeMethod: "set" | "store";
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
    return { handled: true, ...(write === undefined ? {} : { statement: { kind: "expr", expr: {
      kind: "block", bindings: [{ name: locationName, value: location },
        ...(current === undefined ? [] : [{ name: currentName, value: current }])], value: write,
    } } }) };
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
        expr: { kind: "method-call", receiver: location, method: methods.writeMethod, args: [value] },
      },
    };
  }
  const binaryOperator = assignmentBinaryOperator(operator);
  if (binaryOperator === undefined) {
    return { handled: true };
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.compound-assignment-temporary",
      "Promoted-location compound assignment requires a finalized hygienic-name scope.",
    ));
    return { handled: true };
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
  const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  return {
    handled: true,
    statement: {
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [
          {
            name: locationName,
            value: { kind: "reference", expr: location },
          },
          {
            name: currentName,
            value: { kind: "method-call", receiver: locationPath, method: methods.readMethod, args: [] },
          },
          { name: valueName, value },
        ],
        value: {
          kind: "method-call",
          receiver: locationPath,
          method: methods.writeMethod,
          args: [{
            kind: "binary",
            operator: binaryOperator,
            left: { kind: "path", path: currentName },
            right: { kind: "path", path: valueName },
          }],
        },
      },
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
  const operation = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
  return operation?.kind === "source-field" && operation.storage === "structural-object" &&
    context.input.program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex)?.storage === "bound";
}

export function planRustSourceLocationStorage(
  expression: Node, rootExpression: Node, context: RustPlanContext, planExpression: RustExpressionPlanner,
): RustExpr | undefined {
  if (rustExpressionHasReferenceObjectField(expression, context)) {
    return planRustReferenceObjectFieldLocation(expression, context, planExpression);
  }
  const operation = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
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
  const location = planRustLocationStorage(expression, rootExpression, true, context, planExpression);
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
  if (context.input.program.facts.getFact(expression, rustNativeArrayStorageKey)?.kind === "element") {
    return planNativeRustArrayAccess(expression, context, planExpression, "location_at");
  }
  const fieldOperation = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
  if (fieldOperation?.kind === "source-field" && fieldOperation.storage === "structural-object") {
    const field = context.input.program.structuralShapes.field(fieldOperation.receiverCarrier, fieldOperation.storageIndex);
    if (field?.nativeLayout !== undefined) {
      const receiver = Node_Expression(context.input.program.source.ast, expression);
      const value = receiver === undefined ? undefined : planExpression(receiver, context);
      return value === undefined ? undefined
        : readRustStructuralObjectField(value, field.targetName, rustLocationTargetType(field.carrier));
    }
  }
  if (expression === rootExpression) {
    const root = rustRawLocationRoot(expression, context);
    return root === undefined
      ? rejectLocationStorage(
          expression,
          context,
          "The finalized local storage root did not emit a canonical Rust location.",
        )
      : rustLocationStorageForReference(expression, context)?.storage === "cell"
        ? { kind: "reference", expr: root }
        : cloneRoot
        ? { kind: "method-call", receiver: root, method: "clone", args: [] }
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
  const operation = context.input.program.facts.getFact(expression, rustTargetOperationFactKey);
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
    const ordinary = planExpression(expression, context);
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, expression);
    const index = locationIndexExpression(ordinary);
    if (index === undefined || indexNode === undefined) {
      return rejectLocationStorage(
        expression,
        context,
        "The finalized Rust element storage is not one exact built-in index operation.",
      );
    }
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

function rustPromotedStorageMethods(node: Node, context: RustPlanContext): {
  readonly readMethod: "get" | "load";
  readonly writeMethod: "set" | "store";
} {
  return rustLocationStorageForReference(node, context)?.storage === "cell"
    ? { readMethod: "get", writeMethod: "set" }
    : { readMethod: "load", writeMethod: "store" };
}


export function findRustLocationStorageRoot(
  expression: Node,
  context: RustPlanContext,
): { readonly expression: Node; readonly declaration: Node } | undefined {
  let root = expression;
  while (true) {
    const native = context.input.program.facts.getFact(root, rustNativeArrayStorageKey);
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
