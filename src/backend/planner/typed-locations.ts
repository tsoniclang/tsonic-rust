import type { Node } from "@tsonic/tsts";
import type {
  RustAssignmentOperator,
  RustBinaryOperator,
} from "../../common/rust-syntax.js";
import {
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
} from "../../common/source-ast.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustTargetOperationFact,
  RustTypedLocationPlan,
} from "../../source/rust-facts/keys.js";
import {
  rustLocationStorageFactKey,
  rustModuleBindingFactKey,
  rustSourceBindingFactKey,
  rustTargetOperationFactKey,
  rustTypedLocationPlanKey,
} from "../../source/rust-facts/keys.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustValueCarrierRequiresCloneOnRead,
} from "../../source/rust-target-types.js";
import type { RustExpr, RustStmt } from "../rust-ast/nodes.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "./diagnostics.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustSourceName,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustModuleCellAccess } from "./module-storage.js";
import { requireRustLocationValueCarrier } from "./generic-requirements.js";
import {
  readRustProjectObjectField,
  writeRustProjectObjectField,
} from "./project-objects.js";

export type RustExpressionPlanner = (
  node: Node,
  context: RustPlanContext,
) => RustExpr | undefined;

export function planRustTypedLocationCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "typed-location" }>,
  context: RustPlanContext,
  planExpression: RustExpressionPlanner,
): RustExpr | undefined {
  const plan = context.input.facts.getFact(node, rustTypedLocationPlanKey);
  if (plan === undefined || !typedLocationFactMatchesPlan(fact, plan)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.typed-location-plan",
      "Typed-location operation has no matching exact Rust-owned lowering plan.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  switch (plan.operation) {
    case "address-of":
      return planRustLocationStorage(
        plan.storageExpression,
        plan.rootExpression,
        plan.storageExpression === plan.rootExpression,
        context,
        planExpression,
      );
    case "allocate": {
      const initial = planExpression(plan.initialExpression, context);
      return initial === undefined || !requireRustLocationValueCarrier(
        fact.pointeeCarrier,
        node,
        context,
      )
        ? undefined
        : { kind: "call", path: "rt::Location::allocate", args: [initial] };
    }
    case "load": {
      const pointer = locationMethodReceiver(
        planExpression(plan.pointerExpression, context),
      );
      return pointer === undefined
        ? undefined
        : { kind: "method-call", receiver: pointer, method: "load", args: [] };
    }
    case "store": {
      const pointer = locationMethodReceiver(
        planExpression(plan.pointerExpression, context),
      );
      const value = planExpression(plan.valueExpression, context);
      return pointer === undefined || value === undefined
        ? undefined
        : { kind: "method-call", receiver: pointer, method: "store", args: [value] };
    }
    case "equal-pointer": {
      const left = planExpression(plan.leftExpression, context);
      const right = planExpression(plan.rightExpression, context);
      const locationType = rustTypeFromCarrierInContext(fact.locationCarrier, context);
      if (left === undefined || right === undefined || locationType === undefined) {
        return undefined;
      }
      return {
        kind: "associated-call",
        owner: locationType,
        method: "same",
        args: [optionReference(left), optionReference(right)],
      };
    }
  }
}

export function planRustIdentifierValue(
  node: Node,
  path: string,
  context: RustPlanContext,
): RustExpr {
  const storage = rustLocationStorageForReference(node, context);
  const value: RustExpr = {
    kind: "path",
    path: rustCapturedBindingPath(node, context) ?? path,
  };
  if (storage !== undefined) {
    context.usedAliases?.add("rt");
    return storage.storage === "module-cell"
      ? rustModuleCellAccess(value, "load", [])
      : { kind: "method-call", receiver: value, method: "load", args: [] };
  }
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  return rustReadRequiresClone(node, carrier, context)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] }
    : value;
}

export function planRustCaptureValue(
  node: Node,
  path: string,
  context: RustPlanContext,
): RustExpr {
  const capturedPath = rustCapturedBindingPath(node, context) ?? path;
  const storage = rustLocationStorageForReference(node, context);
  if (storage?.storage === "local-location") {
    return {
      kind: "method-call",
      receiver: { kind: "path", path: capturedPath },
      method: "clone",
      args: [],
    };
  }
  const value = planRustIdentifierValue(node, path, context);
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  return !isRustCopyCarrier(carrier) && rustCarrierSupportsClone(carrier) &&
      !(value.kind === "method-call" && value.method === "clone" && value.args.length === 0)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] }
    : value;
}

export function planRustNonConsumingValue(
  node: Node,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr {
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  return rustReadRequiresClone(node, carrier, context) &&
      expression.kind === "method-call" && expression.method === "clone" &&
      expression.args.length === 0
    ? expression.receiver
    : expression;
}

function rustReadRequiresClone(
  node: Node,
  carrier: TargetTypeRef | undefined,
  context: RustPlanContext,
): boolean {
  return rustValueCarrierRequiresCloneOnRead(carrier) ||
    (rustCapturedBindingPath(node, context) !== undefined &&
      !isRustCopyCarrier(carrier) && rustCarrierSupportsClone(carrier));
}

export function rustLocationStorageForReference(
  node: Node,
  context: RustPlanContext,
): {
  readonly declaration: Node;
  readonly storage: "local-location" | "module-cell";
  readonly valueCarrier: TargetTypeRef;
} | undefined {
  const reference = context.input.source.navigation.sourceReferenceFor(node);
  const declaration = reference?.project === true
    ? reference.declaration
    : undefined;
  const localStorage = declaration === undefined
    ? undefined
    : context.input.facts.getFact(declaration, rustLocationStorageFactKey);
  if (declaration !== undefined && localStorage !== undefined) {
    return {
      declaration,
      storage: "local-location",
      valueCarrier: localStorage.valueCarrier,
    };
  }
  const moduleBinding = declaration === undefined
    ? undefined
    : context.input.facts.getFact(declaration, rustModuleBindingFactKey);
  return declaration !== undefined && moduleBinding?.storage === "module-cell"
    ? {
        declaration,
        storage: "module-cell",
        valueCarrier: moduleBinding.valueCarrier,
      }
    : undefined;
}

export function rustLocationStorageForDeclaration(
  declaration: Node,
  context: RustPlanContext,
): { readonly valueCarrier: TargetTypeRef } | undefined {
  return context.input.facts.getFact(declaration, rustLocationStorageFactKey);
}

export function rustRawLocationRoot(
  expression: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const binding = context.input.facts.getFact(
    expression,
    rustSourceBindingFactKey,
  );
  if (binding === undefined) {
    return undefined;
  }
  const name = rustSourceName(context, binding.sourceName);
  if (!isValidRustIdentifier(name) ||
    rustLocationStorageForReference(expression, context) === undefined) {
    return undefined;
  }
  const declarationModule = context.moduleNameByFileName.get(binding.fileName);
  const path = rustCapturedBindingPath(expression, context) ??
    (declarationModule !== undefined && declarationModule !== context.moduleName
      ? `crate::${declarationModule}::${name}`
      : name);
  const storage = rustLocationStorageForReference(expression, context);
  const value: RustExpr = { kind: "path", path };
  return storage?.storage === "module-cell"
    ? rustModuleCellAccess(value, "location", [])
    : value;
}

function rustCapturedBindingPath(
  node: Node,
  context: RustPlanContext,
): string | undefined {
  const declaration = context.input.source.navigation.sourceReferenceFor(node)?.declaration;
  return declaration === undefined
    ? undefined
    : context.capturedBindingPaths?.get(declaration);
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
  if (operator === "=") {
    return {
      handled: true,
      statement: {
        kind: "expr",
        expr: { kind: "method-call", receiver: location, method: "store", args: [value] },
      },
    };
  }
  const binaryOperator = assignmentBinaryOperator(operator);
  if (binaryOperator === undefined) {
    return { handled: true };
  }
  const currentName = "__tsonic_location_current";
  return {
    handled: true,
    statement: {
      kind: "expr",
      expr: {
        kind: "method-call",
        receiver: location,
        method: "update_with",
        args: [{
          kind: "closure",
          params: [{ name: currentName, byRefCopy: false }],
          body: {
            kind: "binary",
            operator: binaryOperator,
            left: { kind: "path", path: currentName },
            right: value,
          },
        }],
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
    case "=":
      return undefined;
  }
}

function planRustLocationStorage(
  expression: Node,
  rootExpression: Node,
  cloneRoot: boolean,
  context: RustPlanContext,
  planExpression: RustExpressionPlanner,
): RustExpr | undefined {
  if (expression === rootExpression) {
    const root = rustRawLocationRoot(expression, context);
    return root === undefined
      ? rejectLocationStorage(
          expression,
          context,
          "The finalized local storage root did not emit a canonical Rust location.",
        )
      : cloneRoot
        ? { kind: "method-call", receiver: root, method: "clone", args: [] }
        : root;
  }
  if (context.input.ast.kindName(expression) === "KindParenthesizedExpression") {
    const inner = Node_Expression(context.input.ast, expression);
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
  const receiverNode = Node_Expression(context.input.ast, expression);
  if (receiverNode === undefined) {
    return rejectLocationStorage(
      expression,
      context,
      "The finalized projected storage has no exact receiver expression.",
    );
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
  const kind = context.input.ast.kindName(expression);
  const operation = context.input.facts.getFact(
    expression,
    rustTargetOperationFactKey,
  );
  if (kind === "KindPropertyAccessExpression" &&
    operation?.kind === "source-field") {
    const ownerName = "__tsonic_location_owner";
    const valueName = "__tsonic_location_value";
    return {
      kind: "method-call",
      receiver: receiverLocation,
      method: "project_member",
      args: [
        { kind: "str-literal", value: operation.operationId },
        {
          kind: "closure",
          params: [{ name: ownerName, byRefCopy: false }],
          body: readRustProjectObjectField(
            { kind: "path", path: ownerName },
            operation.storageIndex,
            operation.resultCarrier,
          ),
        },
        {
          kind: "closure",
          params: [
            { name: ownerName, byRefCopy: false },
            { name: valueName, byRefCopy: false },
          ],
          body: writeRustProjectObjectField(
            { kind: "path", path: ownerName },
            operation.storageIndex,
            "=",
            { kind: "path", path: valueName },
          ),
        },
      ],
    };
  }
  if (kind === "KindElementAccessExpression") {
    const ordinary = planExpression(expression, context);
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.ast, expression);
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

function locationMethodReceiver(
  expression: RustExpr | undefined,
): RustExpr | undefined {
  return expression?.kind === "method-call" &&
      expression.method === "clone" && expression.args.length === 0
    ? expression.receiver
    : expression;
}

function findRustLocationStorageRoot(
  expression: Node,
  context: RustPlanContext,
): { readonly expression: Node; readonly declaration: Node } | undefined {
  let root = expression;
  while (true) {
    const kind = context.input.ast.kindName(root);
    if (kind !== "KindPropertyAccessExpression" &&
      kind !== "KindElementAccessExpression" &&
      kind !== "KindParenthesizedExpression") {
      break;
    }
    const receiver = Node_Expression(context.input.ast, root);
    if (receiver === undefined) {
      return undefined;
    }
    root = receiver;
  }
  if (context.input.ast.kindName(root) !== "KindIdentifier") {
    return undefined;
  }
  const storage = rustLocationStorageForReference(root, context);
  return storage === undefined
    ? undefined
    : { expression: root, declaration: storage.declaration };
}

function locationIndexExpression(expression: RustExpr | undefined): RustExpr | undefined {
  if (expression?.kind === "index") {
    return expression.index;
  }
  return expression?.kind === "evaluate-then" && expression.value.kind === "index"
    ? {
        kind: "evaluate-then",
        effect: expression.effect,
        discard: expression.discard,
        value: expression.value.index,
      }
    : undefined;
}

function typedLocationFactMatchesPlan(
  fact: Extract<RustTargetOperationFact, { readonly kind: "typed-location" }>,
  plan: RustTypedLocationPlan,
): boolean {
  return fact.operation === plan.operation &&
    rustTargetTypeRefEquals(fact.pointeeCarrier, plan.pointeeCarrier) &&
    rustTargetTypeRefEquals(fact.locationCarrier, plan.locationCarrier);
}

function optionReference(value: RustExpr): RustExpr {
  return { kind: "method-call", receiver: value, method: "as_ref", args: [] };
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
