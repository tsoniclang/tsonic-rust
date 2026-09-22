import {
  isRustNeverCarrier,
  rustCallableProtocol,
  rustFutureOutputCarrier,
  rustSourceTypeCarrierValue,
  rustTargetGenericTypeArguments,
  substituteRustTargetGenericArgument,
} from "../../../../target-model/types/index.js";
import { rustClassStaticEnvironmentForCall, rustOwnedClassEnvironmentForCall } from "../../objects/class-environments.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
  rustErrorBoundaryForDeclaration,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  sourceModuleItemPath,
  sourceTypePath,
} from "../../program/plan-context.js";
import { invokeRustStructuralObjectMethod } from "../../objects/project-storage.js";
import { isDenseDataArray } from "../../../../target-model/metadata/closed-data.js";
import {
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import {
  planPromotedSourceMethodCall,
  shapeRustSourceCallParameters,
  sourceCallFinalizedResultCarrier,
  sourceCallSelectedMemberMatches,
} from "./arguments.js";
import { planRustNonConsumingValue, planRustPromotedStorageLocation } from "../typed-locations.js";
import { rustBottomAfterEffect, rustBottomExpression } from "../../types/fallible-shape.js";
import {
  planRustExactProjectMethodCall,
  planRustVirtualProjectMethodCall,
} from "../../objects/project-method-dispatch.js";
import { rustSourceCallEffectsFactKey } from "../../../../analysis/facts/keys.js";
import {
  rustTargetCallGenericArgumentToAstInContext,
  rustTypeFromCarrierInContext,
} from "../../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";
import { planRustUnionMethodCall } from "./union-methods.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableEffectsFactKey } from "../../../../analysis/facts/generic-callable-effects.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";

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
  if (fact.target.form === "union-method") {
    if (effects.unionBranches?.length !== fact.target.variants.length ||
      !effects.unionBranches.every(branch => branch === "infallible" || branch === "fallible")) return false;
    const selectedEffect = effects.unionBranches.some(branch => branch === "fallible") ? "fallible" : "infallible";
    return isAsync ? effects.invocation === "infallible" && effects.awaiting === selectedEffect
      : effects.invocation === selectedEffect && effects.awaiting === "not-applicable";
  }
  const callableCarrier = fact.target.form === "callable"
    ? fact.target.carrier
    : fact.target.form === "structural-method" || fact.target.form === "constructor-value"
      ? fact.target.callableCarrier
      : undefined;
  return isAsync
    ? effects.awaiting !== "not-applicable" &&
      (callableCarrier === undefined || callableCarrier.kind === "function-pointer" ||
        rustGenericCallableValue(callableCarrier) !== undefined ||
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
  const selected = context.input.program.facts.getSelectedTargetCall(node);
  const selectedMatches = selected !== undefined && sourceCallSelectedMemberMatches(
    fact,
    selected,
    sourceCallFinalizedResultCarrier(selected, context),
    context.input.program.typeFamilies.normalize,
  );
  if (!selectedMatches) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-selected-signature",
      "Selected project-source call fact conflicts with the TSTS-selected target member ABI.",
    ));
    return undefined;
  }
  const rawArgumentNodes = context.input.program.source.ast.arguments(node);
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
  const sourceGenericArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const targetGenericArguments = (fact.targetGenericArguments ?? []).map((argument) =>
    substituteRustTargetGenericArgument(
      argument,
      context.typeParameterSubstitutions ?? new Map(),
      context.lifetimeSubstitutions ?? new Map(),
    ));
  if (sourceGenericArguments.length !== targetGenericArguments.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-generic-arguments",
      "Selected project-source call has inconsistent source and target generic-argument evidence.",
    ));
    return undefined;
  }
  const targetAstGenericArguments = targetGenericArguments.flatMap(
    (argument): readonly (RustCallGenericArgument | undefined)[] =>
      argument.kind === "lifetime"
        ? []
        : [rustTargetCallGenericArgumentToAstInContext(argument, context)],
  );
  if (targetAstGenericArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-generic-arguments",
      "Selected project-source call generic arguments do not have exact Rust target representations.",
    ));
    return undefined;
  }
  const targetTypeArguments = rustTargetGenericTypeArguments(targetGenericArguments);
  const selectedDeclaration = selected.sourceDeclaration;
  const requiresCallableSpecialization = selectedDeclaration !== undefined &&
    context.input.program.sourceCallableSpecializations.requiresSpecialization(
      selectedDeclaration,
    );
  const callableSpecialization = requiresCallableSpecialization && selectedDeclaration !== undefined
    ? context.input.program.sourceCallableSpecializations.variantForCall(
        selectedDeclaration,
        targetTypeArguments,
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
  const callGenericArguments = targetAstGenericArguments.length === 0 ||
      callableSpecialization !== undefined
    ? undefined
    : targetAstGenericArguments as readonly RustCallGenericArgument[];

  const classReceiver = "classReceiver" in fact.target ? fact.target.classReceiver : undefined;
  const classBindings: { name: string; value: RustExpr }[] = [];
  let retainedClass: RustExpr | undefined;
  if (classReceiver !== undefined) {
    const value = planExpression(classReceiver, context);
    if (value === undefined || context.syntheticNames === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, "class_receiver");
    classBindings.push({ name, value });
    retainedClass = { kind: "path", path: name };
  }
  let planned: RustExpr | undefined;
  switch (fact.target.form) {
    case "constructor-value": {
      const constructor = context.input.program.structuralShapes.definitionForCarrier(fact.target.receiverCarrier)?.construction;
      const receiver = callee === undefined ? undefined : planExpression(callee, context);
      if (constructor === undefined || receiver === undefined || callee === undefined) break;
      const selected: RustExpr = { kind: "field", receiver: planRustNonConsumingValue(callee, receiver, context), name: "dispatch" };
      planned = { kind: "method-call", receiver: { kind: "method-call", receiver: selected, method: "clone", args: [] },
        method: constructor.targetName, args: shaped };
      break;
    }
    case "union-method": {
      planned = planRustUnionMethodCall(node, callee, shaped, fact, fact.target, callGenericArguments, targetTypeArguments, context);
      break;
    }
    case "function": {
      const targetName = callableSpecialization?.targetName ?? fact.target.name;
      const path = sourceModuleItemPath(context, fact.target.fileName, targetName);
      if (path === undefined || !isValidRustIdentifier(targetName)) {
        break;
      }
      const environment = rustClassStaticEnvironmentForCall(selected.sourceDeclaration, context, retainedClass);
      planned = {
        kind: "call",
        path,
        args: [...(environment === undefined ? [] : [{ kind: "reference" as const, expr: environment }]), ...shaped],
        ...(callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
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
      const receiverNode = callee !== undefined && context.input.program.source.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.program.source.ast, callee)
        : undefined;
      if (fact.target.dispatch !== undefined) {
        const dispatchDeclaration = selected.sourceDeclaration;
        const dispatchVariant = dispatchDeclaration === undefined
          ? undefined
          : context.input.program.projectMethodDispatch.variantForMember(
              dispatchDeclaration,
              targetTypeArguments,
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
          ...(callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
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
        const environment = rustClassStaticEnvironmentForCall(selected.sourceDeclaration, context, retainedClass);
        planned = {
          kind: "call",
          path: `${typePath}::${targetName}`,
          args: [...(environment === undefined ? [] : [{ kind: "reference" as const, expr: environment }]), ...shaped],
          ...(callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
        };
      }
      break;
    }
    case "constructor": {
      const owner = rustTypeFromCarrierInContext(fact.target.typeCarrier, context);
      const targetName = fact.target.name;
      if (owner !== undefined && isValidRustIdentifier(targetName)) {
        const definition = context.input.program.projectTypes.definitionForCarrier(fact.target.typeCarrier);
        const environment = definition === undefined ? undefined : rustOwnedClassEnvironmentForCall(definition.declaration, context, retainedClass);
        planned = {
          kind: "associated-call",
          owner,
          method: targetName,
          args: [...(environment === undefined ? [] : [environment]), ...shaped],
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
      if (fact.target.carrier.kind === "function-pointer" ||
        fact.target.carrier.kind === "closure") {
        planned = { kind: "invoke", callee: callable, args: shaped };
        break;
      }
      const generic = rustGenericCallableValue(fact.target.carrier);
      const protocol = rustGenericCallableProtocol(fact.target.carrier) ?? rustCallableProtocol(fact.target.carrier);
      if (protocol !== undefined && protocol.parameters.length === shaped.length) {
        planned = {
          kind: "method-call",
          receiver: callable,
          method: "call",
          args: generic === undefined ? [{ kind: "tuple-literal", elements: shaped }] : shaped,
          ...(generic === undefined || callGenericArguments === undefined ? {} : { genericArguments: callGenericArguments }),
        };
      }
      break;
    }
    case "structural-method": {
      const receiverNode = callee !== undefined &&
          context.input.program.source.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.program.source.ast, callee)
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
          context.input.program.structuralShapes.field(fact.target.receiverCarrier, fact.target.storageIndex)?.nativeMethod === true
            ? planRustNonConsumingValue(receiverNode, receiver, context) : receiver,
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
  if (classBindings.length > 0) planned = { kind: "block", bindings: classBindings, value: planned };
  const effects = context.input.program.facts.getFact(node, rustSourceCallEffectsFactKey);
  if (effects === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-effects",
      "Project-source call requires finalized post-fixpoint invocation and await effects.",
    ));
    return undefined;
  }
  if (fact.target.form === "callable" && rustGenericCallableValue(fact.target.carrier) !== undefined) {
    const definition = context.input.program.sourceCallableSpecializations.genericValues.definitionFor(fact.target.carrier);
    if (definition === undefined || !definition.implementations.every(implementation => {
      const selected = context.input.program.facts.getFact(implementation.declaration, rustGenericCallableEffectsFactKey);
      return selected?.invocation === effects.invocation && selected.awaiting === effects.awaiting;
    })) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.generic-callable-effects",
        "The invocation effects differ from the sealed generic implementation family."));
      return undefined;
    }
  }
  if (fact.target.form === "union-method") return planned;
  if (effects.invocation === "infallible") {
    return isRustNeverCarrier(fact.resultCarrier) ? rustBottomExpression(planned) : planned;
  }
  const resultErrorType = rustActiveErrorType(context);
  const callableCarrier = fact.target.form === "callable"
    ? fact.target.carrier
    : fact.target.form === "structural-method" || fact.target.form === "constructor-value"
      ? fact.target.callableCarrier
      : undefined;
  const genericDefinition = callableCarrier === undefined ? undefined
    : context.input.program.sourceCallableSpecializations.genericValues.definitionFor(callableCarrier);
  const genericDeclaration = genericDefinition?.implementations[0]?.declaration;
  const operandBoundary = genericDeclaration !== undefined
    ? rustErrorBoundaryForDeclaration(genericDeclaration, context)
    : rustCallableProtocol(callableCarrier) !== undefined || callableCarrier?.kind === "closure"
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
