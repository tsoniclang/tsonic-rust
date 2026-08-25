import { allocateRustSyntheticName } from "../names/synthetic.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  sourceTypePath,
} from "../program/plan-context.js";
import { effectiveMemberResultCarrier, planOptionalChainExpression } from "./special.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, rustOperationFact, selectedOperationMatches } from "./fundamentals.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { planExpression } from "./entry.js";
import { planRustNonConsumingValue, planRustSharedReceiver } from "./typed-locations.js";
import { planRustSourceUnionFieldProjection } from "./unions.js";
import { readRustProjectDispatchedField, rustProjectObjectDispatchField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { readRustSourceStaticField } from "../declarations/static-field-storage.js";
import { readRustStoredObjectField } from "../objects/project-storage.js";
import { rustCallableProtocol, rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";
import { rustFallibleFactKey, rustSourceAccessorEffectsFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function planPropertyAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planOptionalChainExpression(
    node,
    context,
    "property",
    (innerContext) => planPropertyAccessInner(node, innerContext),
  );
}
function planPropertyAccessInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-method-property") {
    return planRustSourceMethodPropertyRead(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "source-accessor") {
    const read = fact.read;
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (read === undefined || resultCarrier === undefined ||
      !rustTargetTypeRefEquals(read.resultCarrier, fact.resultCarrier) ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-accessor-carrier")) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-accessor-read",
        "Project accessor read requires one exact getter and result carrier.",
      ));
      return undefined;
    }
    if (!sourceAccessorSelectedOperationMatches(node, fact, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-accessor-selected-evidence",
        "Project accessor read conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const planned = planRustSourceAccessorCall(node, fact, "read", [], context);
    return planned === undefined
      ? undefined
      : finishRustSourceAccessorCall(node, read.declaration, "read", planned, context);
  }
  if (fact !== undefined && fact.kind === "source-static-field") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-static-field-carrier")) {
      return undefined;
    }
    if (!sourceStaticFieldSelectedOperationMatches(node, fact, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-static-field-selected-evidence",
        "Project static-field read conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const value = readRustSourceStaticField(fact, context);
    if (value === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-static-field-storage",
        "Project static field has no exact generated Rust storage path.",
      ));
    }
    return value;
  }
  if (fact !== undefined && fact.kind === "source-field") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-field-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
        context.input.program.facts.getSelectedTargetProperty(node),
        fact.operationId,
        "property",
        resultCarrier,
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-field-selected-evidence",
        "Project-source field fact conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.program.source.ast, node);
    const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiverNode === undefined || plannedReceiver === undefined) {
      return undefined;
    }
    if (fact.dispatch === undefined) {
      return readRustStoredObjectField(
        fact.storage,
        fact.receiverCarrier,
        planRustNonConsumingValue(receiverNode, plannedReceiver, context),
        fact.storageIndex,
        fact.resultCarrier,
        context,
      );
    }
    if (context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-dispatch-temporary",
        "Project property dispatch requires a finalized hygienic-name scope.",
      ));
      return undefined;
    }
    const dispatchPlan = fact.declaration === undefined
      ? undefined
      : context.input.program.projectFieldDispatch.planFor(fact.declaration);
    if (dispatchPlan === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-field-dispatch-plan",
        "Project property dispatch has no exact finalized field-dispatch plan.",
      ));
      return undefined;
    }
    const dispatchRoles = planRustProjectFieldDispatchRoles(dispatchPlan, context);
    if (dispatchRoles === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(
      context.syntheticNames,
      "dispatch_receiver",
    );
    return {
      kind: "block",
      bindings: [{
        name: receiverName,
        value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
      }],
      value: readRustProjectDispatchedField(
        { kind: "path", path: receiverName },
        fact.dispatch.read,
        dispatchRoles.read,
      ),
    };
  }
  if (fact !== undefined && fact.kind === "source-union-field") {
    return planRustSourceUnionFieldRead(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "source-enum-member") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.enum-member-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.program.facts.getSelectedTargetProperty(node),
      fact.operationId,
      "property",
      resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum-member-selected-evidence",
        "Project-source enum member fact conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const value = rustSourceTypeCarrierValue(fact.resultCarrier);
    const typePath = value === undefined ? undefined : sourceTypePath(context, value);
    if (typePath === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum",
        "Enum member access does not resolve to a generated Rust enum path.",
      ));
      return undefined;
    }
    return { kind: "path", path: `${typePath}::${fact.name}` };
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.abi.operationKind !== "property") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.property",
      "Property access requires a finalized provider property fact.",
    ));
    return undefined;
  }
  const propertyResult = fact.abi.result.kind === "sync" ? fact.abi.result.carrier : fact.abi.result.futureCarrier;
  const selectedResult = effectiveMemberResultCarrier(node, propertyResult, context);
  if (selectedResult === undefined ||
    !requireExpressionCarrier(node, selectedResult, context, "rust.backend.provider-property-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    selectedResult,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-property-selected-evidence",
      "Provider property ABI conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  if (fact.abi.sourceArguments.length !== 0) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-property-abi",
      "Provider property access requires a finalized zero-argument ABI.",
    ));
    return undefined;
  }
  const diagnosticCount = context.diagnostics.length;
  const planned = planProviderOperationExpression(
    context,
    fact,
    Node_Expression(context.input.program.source.ast, node),
    [],
    node,
    { resultUse: "value" },
  );
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.property",
      "Provider property operation could not be lowered.",
    ));
  }
  if (planned === undefined) {
    return undefined;
  }
  return finishProviderOperationExpression(context, fact, planned, node);
}

function planRustSourceMethodPropertyRead(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  const callable = rustCallableProtocol(fact.callableCarrier);
  if (resultCarrier === undefined || callable === undefined ||
    !rustTargetTypeRefEquals(resultCarrier, fact.callableCarrier) ||
    !requireExpressionCarrier(
      node,
      resultCarrier,
      context,
      "rust.backend.source-method-property-carrier",
    ) || !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetProperty(node),
      fact.operationId,
      "property",
      resultCarrier,
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-method-property-selected-evidence",
      "Project method-property read conflicts with its exact selected callable evidence.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  if (receiverNode === undefined || plannedReceiver === undefined ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-method-property-plan",
      "Project method-property read has no exact receiver, callable type, or dispatch identity.",
    ));
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_receiver",
  );
  const callableValue = planRustBoundProjectMethodCallable(
    fact.declaration,
    fact.receiverCarrier,
    { kind: "path", path: receiverName },
    fact.callableCarrier,
    context,
  );
  if (callableValue === undefined) {
    return undefined;
  }
  return {
    kind: "block",
    bindings: [{
      name: receiverName,
      value: plannedReceiver,
    }],
    value: callableValue,
  };
}

export function planRustBoundProjectMethodCallable(
  declaration: Node,
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  callableCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const callable = rustCallableProtocol(callableCarrier);
  const callableType = rustTypeFromCarrierInContext(callableCarrier, context);
  const receiverDefinition = context.input.program.projectTypes.definitionForCarrier(receiverCarrier);
  const selectedImplementation = receiverDefinition === undefined
    ? undefined
    : context.input.program.projectTypes.memberImplementation(
        receiverDefinition,
        declaration,
      );
  const selectedDeclaration = selectedImplementation?.kind === "resolved"
    ? selectedImplementation.implementation.declaration
    : declaration;
  const variant = context.input.program.projectMethodDispatch.variantForMember(declaration, []);
  const implementation = context.input.program.sourceNavigation.callableImplementation(
    selectedDeclaration,
  );
  const implementationDeclaration = implementation.kind === "resolved"
    ? implementation.implementation.declaration
    : selectedDeclaration;
  const targetName = context.input.program.names.nameForDeclaration(
    implementationDeclaration,
  );
  if (callable === undefined || callableType === undefined ||
    receiverDefinition === undefined || context.syntheticNames === undefined ||
    (context.input.program.objectRepresentations.requiresDynamicDispatch(receiverDefinition)
      ? variant === undefined
      : !isValidRustIdentifier(targetName ?? ""))) {
    return undefined;
  }
  const argumentsName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_arguments",
  );
  const argumentsList = callable.parameters.map((_, index) => ({
    kind: "field" as const,
    receiver: { kind: "path" as const, path: argumentsName },
    name: String(index),
  }));
  const invocation: RustExpr = context.input.program.objectRepresentations
    .requiresDynamicDispatch(receiverDefinition)
    ? {
        kind: "method-call",
        receiver: {
          kind: "method-call",
          receiver: {
            kind: "field",
            receiver,
            name: rustProjectObjectDispatchField,
          },
          method: "clone",
          args: [],
        },
        method: variant!.virtualSlot,
        args: argumentsList,
      }
    : {
        kind: "method-call",
        receiver,
        method: targetName!,
        args: argumentsList,
      };
  const fallible = context.input.program.facts.getFact(
    implementationDeclaration,
    rustFallibleFactKey,
  ) !== undefined || context.input.program.facts.getFact(
    declaration,
    rustFallibleFactKey,
  ) !== undefined;
  context.usedAliases?.add("rt");
  return {
    kind: "associated-call",
    owner: callableType,
    method: "new",
    args: [{
      kind: "closure-block",
      params: [{ name: argumentsName, mutable: false }],
      move: true,
      async: false,
      body: {
        statements: [{
          kind: "tail",
          expr: fallible
            ? invocation
            : { kind: "call", path: "Ok", args: [invocation] },
        }],
      },
    }],
  };
}

function planRustSourceUnionFieldRead(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  if (resultCarrier === undefined ||
    !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-union-field-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    resultCarrier,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-union-field-selected-evidence",
      "Source-union field fact conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  if (receiverNode === undefined || receiver === undefined) {
    return undefined;
  }
  return planRustSourceUnionFieldProjection(
    node,
    planRustNonConsumingValue(receiverNode, receiver, context),
    fact,
    context,
    (payload, field, variantIndex) => {
      return readRustStoredObjectField(
        field.storage,
        fact.variants[variantIndex]!.carrier,
        payload,
        field.storageIndex,
        fact.resultCarrier,
        context,
      );
    },
  );
}

export function sourceFieldSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceMethodPropertySelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceStaticFieldSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceAccessorSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function planRustSourceAccessorCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  role: "read" | "write",
  args: readonly RustExpr[],
  context: RustPlanContext,
  receiverOverride?: RustExpr,
): RustExpr | undefined {
  const selected = role === "read" ? fact.read : fact.write;
  if (selected === undefined || args.length !== (role === "read" ? 0 : 1)) {
    return undefined;
  }
  if (fact.receiver.kind === "static") {
    const value = rustSourceTypeCarrierValue(fact.receiver.typeCarrier);
    const ownerPath = value === undefined ? undefined : sourceTypePath(context, value);
    return ownerPath === undefined
      ? undefined
      : { kind: "call", path: `${ownerPath}::${selected.method}`, args };
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const plannedReceiver = receiverOverride ?? (receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context));
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? plannedReceiver
    : planRustNonConsumingValue(receiverNode, plannedReceiver, context);
  if (receiver === undefined) {
    return undefined;
  }
  if (fact.dispatch === undefined) {
    return { kind: "method-call", receiver, method: selected.method, args };
  }
  const receiverCarrier = receiverNode === undefined
    ? undefined
    : effectivePlannedExpressionCarrier(receiverNode, context);
  const owner = context.input.program.projectTypes.definitionContainingDeclaration(selected.declaration);
  const relationship = owner === undefined || receiverCarrier === undefined
    ? undefined
    : context.input.program.projectTypes.relationship(receiverCarrier, owner);
  if (relationship?.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, fact.dispatch.ownerCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-accessor-dispatch-receiver",
      "Project accessor dispatch conflicts with its exact finalized receiver relationship.",
    ));
    return undefined;
  }
  return {
    kind: "method-call",
    receiver: {
      kind: "method-call",
      receiver: {
        kind: "field",
        receiver,
        name: rustProjectObjectDispatchField,
      },
      method: "clone",
      args: [],
    },
    method: selected.method,
    args,
  };
}

export function finishRustSourceAccessorCall(
  node: Node,
  selectedDeclaration: Node,
  role: "read" | "write",
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const effects = context.input.program.facts.getFact(node, rustSourceAccessorEffectsFactKey);
  const effect = effects?.[role];
  if (effect === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-accessor-effects",
      "Project accessor operation requires finalized post-fixpoint effects.",
    ));
    return undefined;
  }
  if (effect === "infallible") {
    return expression;
  }
  const resultErrorType = rustActiveErrorType(context);
  const operandBoundary = rustErrorBoundaryForProjectMember(selectedDeclaration, context);
  if (resultErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.accessor",
      "Fallible accessor operations require a throwing function or try block.",
    ));
    return undefined;
  }
  if (operandBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-accessor-error-boundary",
      "Fallible source accessor has no exact selected declaration error boundary.",
    ));
    return undefined;
  }
  return {
    kind: "try",
    expr: expression,
    resultErrorType,
    operandErrorType: rustErrorType(operandBoundary),
  };
}

export function sourceUnionFieldSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.program.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceIndexSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.program.facts.getSelectedTargetElementAccess(node),
    fact.operationId,
    "indexer",
    fact.resultCarrier,
  );
}
