import {
  isRustNeverCarrier,
  rustCallableProtocol,
  rustFutureOutputCarrier,
  rustSourceTypeCarrierValue,
  substituteRustTargetTypeParameters,
} from "../../../../policy/types/target-types.js";
import { applyRustSourceCallableRequirements } from "../../artifacts/source-callable-contracts.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  sourceModuleItemPath,
  sourceTypePath,
} from "../../program/plan-context.js";
import { invokeRustStructuralObjectMethod } from "../../objects/project-storage.js";
import { isDenseDataArray } from "../../../../policy/model/closed-data.js";
import {
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import { planPromotedSourceMethodCall, shapeRustSourceCallParameters, sourceCallSelectedMemberMatches } from "./arguments.js";
import { planRustNonConsumingValue, planRustPromotedStorageLocation } from "../typed-locations.js";
import { rustBottomAfterEffect, rustBottomExpression } from "../../types/fallible-shape.js";
import {
  planRustExactProjectMethodCall,
  planRustVirtualProjectMethodCall,
} from "../../objects/project-method-dispatch.js";
import { rustSourceCallEffectsFactKey } from "../../../../analysis/facts/keys.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustType } from "../../../rust-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";

export function sourceCallEffectsMatch(
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  effects: import("../../../../analysis/facts/keys.js").RustSourceCallEffectsFact | undefined,
): boolean {
  if (effects === undefined ||
    (effects.invocation !== "infallible" && effects.invocation !== "fallible") ||
    (effects.awaiting !== "not-applicable" && effects.awaiting !== "infallible" && effects.awaiting !== "fallible")) {
    return false;
  }
  const isAsync = rustFutureOutputCarrier(fact.resultCarrier) !== undefined;
  const callableCarrier = fact.target.form === "callable"
    ? fact.target.carrier
    : fact.target.form === "structural-method"
      ? fact.target.callableCarrier
      : undefined;
  return isAsync
    ? effects.awaiting !== "not-applicable" &&
      (callableCarrier === undefined || callableCarrier.kind === "function-pointer" ||
        effects.invocation === "fallible")
    : effects.awaiting === "not-applicable";
}

export function planSelectedSourceCall(
  node: Node,
  callee: Node | undefined,
  args: readonly RustExpr[],
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.facts.getSelectedTargetCall(node);
  const selectedMatches = selected !== undefined && sourceCallSelectedMemberMatches(fact, selected);
  if (!selectedMatches) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-selected-signature",
      "Selected project-source call fact conflicts with the TSTS-selected target member ABI.",
    ));
    return undefined;
  }
  if (!applyRustSourceCallableRequirements(node, selected, fact, context)) {
    return undefined;
  }
  const rawArgumentNodes = context.input.ast.arguments(node);
  if (!isDenseDataArray(rawArgumentNodes) || rawArgumentNodes.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-arguments",
      "Selected project-source call contains an undefined or non-data argument slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArgumentNodes as readonly Node[];
  if (argumentNodes.length !== args.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-arguments",
      "Selected project-source call arguments do not match the finalized Rust expression plan.",
    ));
    return undefined;
  }
  const shaped = shapeRustSourceCallParameters(
    argumentNodes,
    args,
    fact,
    context,
  );
  if (shaped === undefined) {
    return undefined;
  }
  const sourceTypeArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const targetTypeArgumentCarriers = (fact.targetTypeArguments ?? []).map((argument) =>
    context.typeParameterSubstitutions === undefined
      ? argument
      : substituteRustTargetTypeParameters(
          argument,
          context.typeParameterSubstitutions,
        ));
  if (sourceTypeArguments.length !== targetTypeArgumentCarriers.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-type-arguments",
      "Selected project-source call has inconsistent source and target type-argument evidence.",
    ));
    return undefined;
  }
  const targetTypeArguments = targetTypeArgumentCarriers.map((carrier) =>
    rustTypeFromCarrierInContext(carrier, context));
  if (targetTypeArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-type-arguments",
      "Selected project-source call type arguments do not have exact Rust target types.",
    ));
    return undefined;
  }
  const selectedDeclaration = selected.sourceDeclaration;
  const requiresCallableSpecialization = selectedDeclaration !== undefined &&
    context.input.sourceCallableSpecializations.requiresSpecialization(
      selectedDeclaration,
    );
  const callableSpecialization = requiresCallableSpecialization && selectedDeclaration !== undefined
    ? context.input.sourceCallableSpecializations.variantForCall(
        selectedDeclaration,
        targetTypeArgumentCarriers,
      )
    : undefined;
  if (requiresCallableSpecialization && callableSpecialization === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-callable-specialization",
      "Selected project-source call has no exact finite Rust callable specialization.",
    ));
    return undefined;
  }
  const callTypeArguments = targetTypeArguments.length === 0 ||
      callableSpecialization !== undefined
    ? undefined
    : targetTypeArguments as readonly RustType[];

  let planned: RustExpr | undefined;
  switch (fact.target.form) {
    case "function": {
      const targetName = callableSpecialization?.targetName ?? fact.target.name;
      const path = sourceModuleItemPath(context, fact.target.fileName, targetName);
      if (path === undefined || !isValidRustIdentifier(targetName)) {
        break;
      }
      planned = {
        kind: "call",
        path,
        args: shaped,
        ...(callTypeArguments === undefined ? {} : { typeArguments: callTypeArguments }),
      };
      break;
    }
    case "method": {
      const targetName = fact.target.dispatch === undefined
        ? callableSpecialization?.targetName ?? fact.target.name
        : fact.target.name;
      if (!isValidRustIdentifier(targetName)) {
        break;
      }
      const receiverNode = callee !== undefined && context.input.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.ast, callee)
        : undefined;
      if (fact.target.dispatch !== undefined) {
        const dispatchDeclaration = selected.sourceDeclaration;
        const dispatchVariant = dispatchDeclaration === undefined
          ? undefined
          : context.input.projectMethodDispatch.variantForMember(
              dispatchDeclaration,
              targetTypeArgumentCarriers,
            );
        if (dispatchVariant === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.project-method-specialization",
            "Selected polymorphic project call has no exact finalized Rust dispatch specialization.",
          ));
          break;
        }
        planned = fact.target.dispatch.selected === "exact"
          ? planRustExactProjectMethodCall(
              node,
              context.projectDispatchRoot,
              fact.target.dispatch.ownerCarrier,
              dispatchVariant.exactSlot,
              shaped,
              context,
            )
          : receiverNode === undefined
            ? undefined
            : (() => {
                const receiver = planExpression(receiverNode, context);
                return receiver === undefined
                  ? undefined
                  : planRustVirtualProjectMethodCall(
                      node,
                      receiver,
                      fact.target.dispatch.ownerCarrier,
                      dispatchVariant.virtualSlot,
                      shaped,
                      context,
                    );
              })();
        break;
      }
      const promoted = receiverNode === undefined || !fact.target.mutatesSelf
        ? { kind: "not-promoted" as const }
        : planRustPromotedStorageLocation(
            receiverNode,
            context,
            planExpression,
            shaped.length > 0,
          );
      if (promoted.kind === "promoted") {
        if (promoted.expression === undefined) {
          break;
        }
        planned = planPromotedSourceMethodCall(
          node,
          promoted.expression,
          targetName,
          shaped,
          context,
        );
        break;
      }
      const receiverOverride = receiverNode === undefined
        ? undefined
        : context.expressionOverrides?.get(receiverNode);
      const receiver = receiverOverride?.valueForm === "storage"
        ? receiverOverride.expression
        : receiverNode === undefined
          ? undefined
          : planExpression(receiverNode, context);
      if (receiver !== undefined) {
        planned = {
          kind: "method-call",
          receiver: receiverNode === undefined
            ? receiver
            : planRustNonConsumingValue(receiverNode, receiver, context),
          method: targetName,
          ...(callTypeArguments === undefined ? {} : { typeArguments: callTypeArguments }),
          args: shaped,
          receiverMode: fact.target.mutatesSelf ? "mut-ref" : "ref",
        };
      }
      break;
    }
    case "static-method": {
      const value = rustSourceTypeCarrierValue(fact.target.typeCarrier);
      const typePath = value === undefined ? undefined : sourceTypePath(context, value);
      const targetName = callableSpecialization?.targetName ?? fact.target.name;
      if (typePath !== undefined && isValidRustIdentifier(targetName)) {
        planned = {
          kind: "call",
          path: `${typePath}::${targetName}`,
          args: shaped,
          ...(callTypeArguments === undefined ? {} : { typeArguments: callTypeArguments }),
        };
      }
      break;
    }
    case "constructor": {
      const owner = rustTypeFromCarrierInContext(fact.target.typeCarrier, context);
      const targetName = fact.target.name;
      if (owner !== undefined && isValidRustIdentifier(targetName)) {
        planned = {
          kind: "associated-call",
          owner,
          method: targetName,
          args: shaped,
        };
      }
      break;
    }
    case "callable": {
      const plannedCallable = callee === undefined ? undefined : planExpression(callee, context);
      if (callee === undefined || plannedCallable === undefined) {
        break;
      }
      const callable = planRustNonConsumingValue(callee, plannedCallable, context);
      if (fact.target.carrier.kind === "function-pointer") {
        planned = { kind: "invoke", callee: callable, args: shaped };
        break;
      }
      const protocol = rustCallableProtocol(fact.target.carrier);
      if (protocol !== undefined && protocol.parameters.length === shaped.length) {
        planned = {
          kind: "method-call",
          receiver: callable,
          method: "call",
          args: [{ kind: "tuple-literal", elements: shaped }],
        };
      }
      break;
    }
    case "structural-method": {
      const receiverNode = callee !== undefined &&
          context.input.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.ast, callee)
        : undefined;
      const receiver = receiverNode === undefined
        ? undefined
        : planExpression(receiverNode, context);
      const storageOverride = callee === undefined
        ? undefined
        : context.expressionOverrides?.get(callee);
      if (receiverNode !== undefined && receiver !== undefined) {
        planned = invokeRustStructuralObjectMethod(
          fact.target.receiverCarrier,
          receiver,
          fact.target.storageIndex,
          shaped,
          fact.resultCarrier,
          context,
          storageOverride === undefined
            ? undefined
            : {
                expression: storageOverride.expression,
                carrier: storageOverride.carrier,
              },
        );
      }
      break;
    }
  }
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-target",
      "Selected project-source call target does not resolve to a finalized Rust path or receiver operation.",
    ));
    return undefined;
  }
  const effects = context.input.facts.getFact(node, rustSourceCallEffectsFactKey);
  if (effects === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-effects",
      "Project-source call requires finalized post-fixpoint invocation and await effects.",
    ));
    return undefined;
  }
  if (effects.invocation === "infallible") {
    return isRustNeverCarrier(fact.resultCarrier) ? rustBottomExpression(planned) : planned;
  }
  const resultErrorType = rustActiveErrorType(context);
  const callableCarrier = fact.target.form === "callable"
    ? fact.target.carrier
    : fact.target.form === "structural-method"
      ? fact.target.callableCarrier
      : undefined;
  const operandBoundary = rustCallableProtocol(callableCarrier) !== undefined
    ? rustCurrentErrorBoundary(context)
    : selected.sourceDeclaration === undefined
      ? undefined
      : rustErrorBoundaryForProjectMember(selected.sourceDeclaration, context);
  if (resultErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  if (operandBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-error-boundary",
      "Fallible source call has no exact selected declaration error boundary.",
    ));
    return undefined;
  }
  const propagated: RustExpr = {
    kind: "try",
    expr: planned,
    resultErrorType,
    operandErrorType: rustErrorType(operandBoundary),
  };
  return isRustNeverCarrier(fact.resultCarrier)
    ? rustBottomAfterEffect(propagated, "fallible never call returned")
    : propagated;
}
