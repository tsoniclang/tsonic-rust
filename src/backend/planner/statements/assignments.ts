import {
  expressionCarrier,
  planExpression,
  planRustOperatorCallExpression,
  finishRustSourceAccessorCall,
  planRustSourceAccessorCall,
  sourceAccessorSelectedOperationMatches,
  sourceIndexSelectedOperationMatches,
  sourceMethodPropertySelectedOperationMatches,
  sourceStaticFieldSelectedOperationMatches,
} from "../expressions/index.js";
import {
  readRustProjectObjectIndex,
  rustProjectObjectDispatchField,
  writeRustProjectMethodOverride,
  writeRustProjectObjectIndex,
} from "../objects/project-objects.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import {
  ElementAccessExpression_ArgumentExpression,
  KindIdentifier,
  Node_Expression,
} from "@tsonic/target-api/source";
import { isRustAssignmentOperator } from "../../model/syntax.js";
import { isRustCopyCarrier, isRustStringCarrier } from "../../../policy/types/target-types.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planRustSharedReceiver, planRustPromotedStorageLocation } from "../expressions/typed-locations.js";
import { rustSelectedAccessorRequiresUnsafe } from "../safety/explicit-safety.js";
import { rustSourceStaticFieldLocation } from "../declarations/static-field-storage.js";
import { rustStringConcat } from "../../rust-ast/expressions.js";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustAssignmentOperationFact } from "./core.js";
import type { RustAssignmentOperator, RustBinaryOperator } from "../../model/syntax.js";
import type { RustExpr, RustStmt } from "../../rust-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";

export function planRustSourceMethodPropertyAssignment(
  left: Node,
  valueNode: Node,
  method: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>,
  assignment: RustAssignmentOperationFact,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (assignment.kind !== "operator-token" || assignment.operator !== "=" ||
    method.write === undefined ||
    !sourceMethodPropertySelectedOperationMatches(left, method, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, left),
      "rust.backend.source-method-property-assignment",
      "Project method replacement requires exact writable property evidence and plain assignment.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, left);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const value = planExpression(valueNode, context);
  const receiverDefinition = context.input.projectTypes.definitionForCarrier(
    method.receiverCarrier,
  );
  if (receiverNode === undefined || plannedReceiver === undefined || value === undefined ||
    receiverDefinition === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_receiver",
  );
  const valueName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_replacement",
  );
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const replacement: RustExpr = { kind: "path", path: valueName };
  const write = context.input.projectTypes.isPolymorphic(receiverDefinition)
    ? {
        kind: "method-call" as const,
        receiver: {
          kind: "field" as const,
          receiver,
          name: rustProjectObjectDispatchField,
        },
        method: method.write.dispatchSlot,
        args: [replacement],
      }
    : method.write.storageName === undefined
      ? undefined
      : writeRustProjectMethodOverride(
          receiver,
          method.write.storageName,
          replacement,
        );
  if (write === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, left),
      "rust.backend.source-method-property-storage",
      "Project method replacement has no exact generated storage route.",
    ));
    return undefined;
  }
  return [{
    kind: "expr",
    expr: {
      kind: "block",
      bindings: [{
        name: receiverName,
        value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
      }, {
        name: valueName,
        value,
      }],
      value: write,
    },
  }];
}

export function planRustSourceStaticFieldAssignment(
  target: Node,
  valueNode: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>,
  assignment: RustAssignmentOperationFact,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (!isRustAssignmentOperator(assignment.operator)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-static-field-operator",
      "Project static-field assignment requires an exact Rust assignment operator.",
    ));
    return undefined;
  }
  if (!sourceStaticFieldSelectedOperationMatches(target, field, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-static-field-selected-evidence",
      "Project static-field assignment conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const location = rustSourceStaticFieldLocation(field, context);
  const value = planExpression(valueNode, context);
  if (location === undefined || value === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "static_field_location");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "static_field_value");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  const valuePath: RustExpr = { kind: "path", path: valueName };
  if (assignment.operator === "=") {
    return [{
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [
          { name: locationName, value: location },
          { name: valueName, value },
        ],
        value: {
          kind: "method-call",
          receiver: locationPath,
          method: "store",
          args: [valuePath],
        },
      },
    }];
  }
  const currentName = allocateRustSyntheticName(context.syntheticNames, "static_field_current");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "static_field_next");
  const nextValue = planRustCompoundAssignmentValue(
    assignment,
    { kind: "path", path: currentName },
    valuePath,
    target,
    context,
  );
  if (nextValue === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-static-field-operator",
      "Project static-field compound assignment has no exact Rust value operation.",
    ));
    return undefined;
  }
  return [{
    kind: "expr",
    expr: {
      kind: "block",
      bindings: [
        { name: locationName, value: location },
        {
          name: currentName,
          value: { kind: "method-call", receiver: locationPath, method: "load", args: [] },
        },
        { name: valueName, value },
        { name: nextName, value: nextValue },
      ],
      value: {
        kind: "method-call",
        receiver: locationPath,
        method: "store",
        args: [{ kind: "path", path: nextName }],
      },
    },
  }];
}

export function planRustDirectOperatorCallAssignment(
  targetNode: Node,
  target: RustExpr,
  value: RustExpr,
  assignment: Extract<RustAssignmentOperationFact, { readonly kind: "operator-call" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, targetNode),
      "rust.backend.compound-assignment-temporary",
      "Fallible compound assignment requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const promoted = planRustPromotedStorageLocation(
    targetNode,
    context,
    planExpression,
    false,
  );
  if (promoted.kind === "promoted") {
    if (promoted.expression === undefined) {
      return undefined;
    }
    const locationName = allocateRustSyntheticName(context.syntheticNames, "location");
    const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
    const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
    const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
    const locationPath: RustExpr = { kind: "path", path: locationName };
    const next = planRustCompoundAssignmentValue(
      assignment,
      { kind: "path", path: currentName },
      { kind: "path", path: valueName },
      targetNode,
      context,
    );
    if (next === undefined) {
      return undefined;
    }
    return [{
      kind: "expr",
      expr: {
        kind: "block",
        bindings: [
          { name: locationName, value: promoted.expression },
          {
            name: currentName,
            value: { kind: "method-call", receiver: locationPath, method: "load", args: [] },
          },
          { name: valueName, value },
          { name: nextName, value: next },
        ],
        value: {
          kind: "method-call",
          receiver: locationPath,
          method: "store",
          args: [{ kind: "path", path: nextName }],
        },
      },
    }];
  }

  const currentName = allocateRustSyntheticName(context.syntheticNames, "current");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "value");
  const nextName = allocateRustSyntheticName(context.syntheticNames, "next");
  const directIdentifier = context.input.ast.kindName(targetNode) === KindIdentifier;
  const locationName = directIdentifier
    ? undefined
    : allocateRustSyntheticName(context.syntheticNames, "location");
  const locationPath: RustExpr = locationName === undefined
    ? target
    : { kind: "dereference", pointer: { kind: "path", path: locationName } };
  const current = isRustCopyCarrier(assignment.resultCarrier)
    ? locationPath
    : { kind: "method-call", receiver: locationPath, method: "clone", args: [] } as RustExpr;
  const next = planRustCompoundAssignmentValue(
    assignment,
    { kind: "path", path: currentName },
    { kind: "path", path: valueName },
    targetNode,
    context,
  );
  if (next === undefined) {
    return undefined;
  }
  return [{
    kind: "expr",
    expr: {
      kind: "block",
      bindings: [
        ...(locationName === undefined
          ? []
          : [{
              name: locationName,
              value: { kind: "reference" as const, expr: target, mutable: true },
            }]),
        { name: currentName, value: current },
        { name: valueName, value },
        { name: nextName, value: next },
      ],
      value: {
        kind: "assignment",
        operator: "=",
        target: locationPath,
        value: { kind: "path", path: nextName },
      },
    },
  }];
}

function rustBinaryOperatorForAssignment(
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

export function planRustSourceAccessorAssignment(
  target: Node,
  valueNode: Node,
  accessor: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  assignment: RustAssignmentOperationFact,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const operator = assignment.operator;
  if (!isRustAssignmentOperator(operator)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-assignment-operator",
      "Project accessor assignment requires a finalized Rust assignment operator.",
    ));
    return undefined;
  }
  if (!sourceAccessorSelectedOperationMatches(target, accessor, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-selected-evidence",
      "Project accessor assignment conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const unsafeAccessor = rustSelectedAccessorRequiresUnsafe(
    target,
    "setter",
    context.input,
  ) || (operator !== "=" && rustSelectedAccessorRequiresUnsafe(
    target,
    "getter",
    context.input,
  ));
  if (unsafeAccessor && (context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
      sourceNode: target,
    });
    return undefined;
  }
  const write = accessor.write;
  const read = operator === "=" ? undefined : accessor.read;
  if (write === undefined || (operator !== "=" && read === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-assignment",
      "Project accessor assignment requires the exact selected setter and compound assignments also require the selected getter.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-temporary",
      "Project accessor assignment requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const bindings: { name: string; value: RustExpr }[] = [];
  let receiver: RustExpr | undefined;
  if (accessor.receiver.kind === "instance") {
    const receiverNode = Node_Expression(context.input.ast, target);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    if (receiverNode === undefined || plannedReceiver === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(context.syntheticNames, "accessor_receiver");
    bindings.push({
      name: receiverName,
      value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
    });
    receiver = { kind: "path", path: receiverName };
  }
  let current: RustExpr | undefined;
  if (read !== undefined) {
    const plannedRead = planRustSourceAccessorCall(
      target,
      accessor,
      "read",
      [],
      context,
      receiver,
    );
    const finalizedRead = plannedRead === undefined
      ? undefined
      : finishRustSourceAccessorCall(target, "read", plannedRead, context);
    if (finalizedRead === undefined) {
      return undefined;
    }
    const currentName = allocateRustSyntheticName(context.syntheticNames, "accessor_current");
    bindings.push({ name: currentName, value: finalizedRead });
    current = { kind: "path", path: currentName };
  }
  const plannedValue = planExpression(valueNode, context);
  if (plannedValue === undefined) {
    return undefined;
  }
  const valueName = allocateRustSyntheticName(context.syntheticNames, "accessor_value");
  bindings.push({ name: valueName, value: plannedValue });
  const selectedValue: RustExpr = { kind: "path", path: valueName };
  const next = operator === "="
    ? selectedValue
    : current === undefined
      ? undefined
      : planRustCompoundAssignmentValue(
          assignment,
          current,
          selectedValue,
          target,
          context,
        );
  if (next === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.source-accessor-operator",
      "Project accessor compound assignment has no exact Rust value operation.",
    ));
    return undefined;
  }
  const plannedWrite = planRustSourceAccessorCall(
    target,
    accessor,
    "write",
    [next],
    context,
    receiver,
  );
  const finalizedWrite = plannedWrite === undefined
    ? undefined
    : finishRustSourceAccessorCall(target, "write", plannedWrite, context);
  return finalizedWrite === undefined
    ? undefined
    : [{ kind: "expr", expr: { kind: "block", bindings, value: finalizedWrite } }];
}

export function planRustCompoundAssignmentValue(
  assignment: RustAssignmentOperationFact,
  current: RustExpr,
  value: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (assignment.kind === "operator-call") {
    return planRustOperatorCallExpression(assignment, current, value, node, context);
  }
  const operator = assignment.operator;
  if (!isRustAssignmentOperator(operator)) {
    return undefined;
  }
  if (operator === "=") {
    return value;
  }
  if (operator === "+=" && isRustStringCarrier(assignment.resultCarrier)) {
    return rustStringConcat([current, value]);
  }
  const binary = rustBinaryOperatorForAssignment(operator);
  if (binary === undefined) {
    return undefined;
  }
  return { kind: "binary", operator: binary, left: current, right: value };
}

export function planRustSourceIndexAssignment(
  target: Node,
  valueNode: Node,
  index: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  assignment: RustAssignmentOperationFact,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  if (!index.writable || !sourceIndexSelectedOperationMatches(target, index, context) ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, target),
      "rust.backend.project-index-assignment-contract",
      "Project index assignment requires the exact writable selected index-signature fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, target);
  const keyNode = ElementAccessExpression_ArgumentExpression(context.input.ast, target);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
  const value = planExpression(valueNode, context);
  if (receiverNode === undefined || plannedReceiver === undefined || keyNode === undefined ||
    key === undefined || value === undefined ||
    !rustTargetTypeRefEquals(expressionCarrier(keyNode, context), index.keyCarrier)) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_receiver");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "index_key");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "index_value");
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const keyPath: RustExpr = { kind: "path", path: keyName };
  const valuePath: RustExpr = { kind: "path", path: valueName };
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
  }[] = [{
    name: receiverName,
    value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
  }, {
    name: keyName,
    value: key,
  }];
  let next: RustExpr = valuePath;
  if (assignment.operator !== "=") {
    const currentName = allocateRustSyntheticName(context.syntheticNames, "index_current");
    bindings.push({
      name: currentName,
      value: readRustProjectObjectIndex(
        receiverPath,
        index.storageName,
        keyPath,
        index.resultCarrier,
      ),
    }, {
      name: valueName,
      value,
    });
    const plannedNext = planRustCompoundAssignmentValue(
      assignment,
      { kind: "path", path: currentName },
      valuePath,
      target,
      context,
    );
    if (plannedNext === undefined) {
      return undefined;
    }
    const nextName = allocateRustSyntheticName(context.syntheticNames, "index_next");
    bindings.push({ name: nextName, value: plannedNext });
    next = { kind: "path", path: nextName };
  } else {
    bindings.push({ name: valueName, value });
  }
  return [{
    kind: "expr",
    expr: {
      kind: "block",
      bindings,
      value: writeRustProjectObjectIndex(
        receiverPath,
        index.storageName,
        keyPath,
        next,
      ),
    },
  }];
}
