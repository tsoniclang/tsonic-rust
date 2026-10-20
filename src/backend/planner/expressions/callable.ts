import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustPackageFallibleBoundary } from "../program/fallible-boundaries.js";
import {
  applyFallibleShape,
} from "../types/fallible-shape.js";
import {
  isValidRustIdentifier,
  rustActiveErrorType,
  rustErrorBoundaryForDeclaration,
} from "../program/plan-context.js";
import { Node_Initializer } from "@tsonic/target-api/source";
import { planRustCapturedEnvironment } from "./capture-environments.js";
import { planRustAbsentValue } from "./optional-storage.js";

import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustTailShape, retainRustCheckedCompletion } from "../../target-ast/normalization/block-flow.js";
import { planRustReturnExit } from "../statements/completion-exits.js";
import { rustOperationFact } from "./fundamentals.js";
import { finishRuntimeCallableExpression } from "./lambda-creation.js";
import { rustCallableConstructionType } from "../types/constructions.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planExpression, type RustExpressionResultUse } from "./entry.js";
import { planRustBindingPattern } from "../bindings/binding-patterns.js";
import { rustOptionDefaultValue } from "./option-default.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { planRustFrameCallableValue, rustIndependentFrameConstruction } from "./frame-callables.js";
import { planRustGenericCallableValue } from "./generic-callables.js";
import { planRustGeneratorBody } from "../declarations/callables/generator-body.js";
import { wrapRustJsPromiseBody } from "../declarations/callables/async-promise.js";
import { planRustSuspendedCallableConstruction } from "./suspended-callables.js";
import { planRustParameterEntryConversion } from "../declarations/callables/parameter-entry-conversion.js";
import { planRustCallableLeadingParameters } from "../declarations/callables/leading-parameters.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers, rustRecursiveReceiverFieldContext } from "./receiver-captures.js";
import { planRustErrorRegion } from "../program/error-regions.js";

function rustCallableCreationIsErased(node: Node, context: RustPlanContext): boolean {
  const participation = context.input.program.records.nativeParticipation.get(node);
  if (participation === undefined) failRustPlannerInvariant(
    "Callable creation rendering requires its original sealed native participation.", node);
  return participation === "erased";
}

export function planCallableExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse = "value",
): RustExpr | undefined {
  if (resultUse === "discarded" || rustCallableCreationIsErased(node, context))
    return { kind: "tuple-literal", elements: [] };
  return context.input.program.records.closureCapture.get(node)?.invocationOwner === "shared-state"
    ? planRustSuspendedCallableConstruction(node, context)
    : planRustCallableExpressionBody(node, context, resultUse)?.expression;
}

export interface RustCallableExpressionPlan {
  readonly expression: RustExpr;
  readonly sharedInvocation?: { readonly ownerName: string; readonly argumentsName: string; readonly body: RustBlock };
}

export function planRustCallableExpressionBody(
  node: Node,
  outerContext: RustPlanContext,
  resultUse: RustExpressionResultUse = "value",
  representation: "value" | "producer" = "value",
): RustCallableExpressionPlan | undefined {
  const { promiseBody: _enclosingPromiseBody, promiseBodyName: _enclosingPromiseBodyName, ...context } = outerContext;
  const { ast } = context.input.program.source;
  if (resultUse === "discarded" || rustCallableCreationIsErased(node, context))
    return { expression: { kind: "tuple-literal", elements: [] } };
  const closureFact = rustOperationFact(node, context);
  if (closureFact === undefined || closureFact.kind !== "closure") {
    failRustPlannerInvariant("Callable expressions require a finalized closure fact.", node);
  }
  const captureFact = context.input.program.records.closureCapture.get(node);
  if (captureFact === undefined) {
    failRustPlannerInvariant("Callable expressions require finalized exact capture evidence.", node);
  }
  const emission = context.input.program.records.lambdaBody.get(node)
    ?? failRustPlannerInvariant("An admitted callable requires its exact native construction plan.", node);
  const frameAlternative = rustIndependentFrameConstruction(node, closureFact.resultCarrier, context);
  const constructionCarrier = emission.constructionCarrier;
  if (emission.construction === "frame") {
    const expression = planRustFrameCallableValue(node, constructionCarrier, context);
    return expression === undefined ? undefined : { expression };
  }
  if (emission.construction === "generic") {
    const expression = planRustGenericCallableValue(node, constructionCarrier, context);
    return expression === undefined ? undefined : { expression };
  }
  const callableProtocol = emission.protocol;
  const borrowedInput = emission.borrowedInput;
  const nativeClosureProtocol = emission.nativeClosure;
  if (callableProtocol !== undefined && context.syntheticNames === undefined) {
    failRustPlannerInvariant("Runtime callable expressions require a finalized hygienic-name scope.", node);
  }
  const sourceParameterPlans: {
    readonly parameter: Node;
    readonly name: string;
    readonly pattern?: Node;
    readonly carrier: TargetTypeRef;
    readonly valueCarrier: TargetTypeRef;
    readonly form: "required" | "optional" | "default" | "rest";
    readonly byRefCopy: boolean;
    readonly mutable: boolean;
  }[] = [];
  const bindingParameters: {
    readonly pattern: Node;
    readonly name: string;
    readonly sourceCarrier: TargetTypeRef;
  }[] = [];
  for (const selected of emission.parameters) {
    const parameter = selected.declaration;
    const bindingPattern = selected.pattern;
    if (bindingPattern !== undefined && context.syntheticNames === undefined) {
      failRustPlannerInvariant("Binding-pattern closure parameter requires a finalized hygienic-name scope.", parameter);
    }
    const parameterName = bindingPattern === undefined
      ? context.input.program.names.nameForDeclaration(parameter) ?? ""
      : allocateRustSyntheticName(context.syntheticNames!, "binding_parameter");
    if (!isValidRustIdentifier(parameterName)) {
      failRustPlannerInvariant("An admitted callable parameter requires its sealed native name.", parameter);
    }
    sourceParameterPlans.push({
      parameter,
      name: parameterName,
      ...(bindingPattern === undefined ? {} : { pattern: bindingPattern }),
      carrier: selected.carrier,
      valueCarrier: selected.valueCarrier,
      form: selected.form,
      byRefCopy: selected.byRefCopy,
      mutable: selected.mutable,
    });
    if (bindingPattern !== undefined) {
      bindingParameters.push({
        pattern: bindingPattern,
        name: parameterName,
        sourceCarrier: selected.valueCarrier,
      });
    }
  }
  const bodyNode = context.input.program.source.ast.body(node);
  if (bodyNode === undefined) {
    failRustPlannerInvariant("An admitted callable requires its checked source body.", node);
  }
  const errorRegion = planRustErrorRegion(node, { ...context, callableDeclaration: node, fallibleBoundary: undefined });
  if (errorRegion === undefined) {
    failRustPlannerInvariant("Callable expression has no exact finalized native error region.", node);
  }
  const fallible = errorRegion.boundary !== undefined;
  const generator = context.input.program.records.generator.get(node);
  const asynchronous = context.input.program.records.asyncFunction.get(node);
  const suspended = generator !== undefined || asynchronous !== undefined;
  const bodyResultCarrier = emission.bodyCarrier;
  const resultIsFallible = emission.resultFallible;
  const bodyIsFallible = emission.bodyFallible;
  const generatorErrorOwner = generator === undefined ? undefined : rustErrorBoundaryForDeclaration(node, context);
  const callableErrorBoundary = generator === undefined ? errorRegion.boundary
    : generatorErrorOwner === undefined ? undefined : rustPackageFallibleBoundary(generatorErrorOwner);
  const producerContext = { ...context, callableDeclaration: node, fallibleBoundary: callableErrorBoundary };
  const physicalCarrier = emission.physicalCarrier;
  const invocationErrorCarrier = emission.invocationError;
  const invocationErrorType = invocationErrorCarrier === undefined ? undefined
    : rustTypeFromCarrierInContext(invocationErrorCarrier, producerContext);
  if (resultIsFallible && invocationErrorType === undefined || generator !== undefined && callableErrorBoundary === undefined) {
    failRustPlannerInvariant("Callable expression has no exact producer-owned invocation or suspension error channel.", node);
  }
  if (resultIsFallible) {
    context.usedAliases?.add("rt");
  }
  const callableType = physicalCarrier === undefined || borrowedInput ? undefined
    : rustCallableConstructionType(physicalCarrier, producerContext);
  if (callableProtocol !== undefined && (physicalCarrier === undefined || !borrowedInput && callableType === undefined)) {
    failRustPlannerInvariant("Callable construction requires its exact producer-owned physical carrier.", node);
  }
  const controllerName = generator === undefined || context.syntheticNames === undefined
    ? undefined : allocateRustSyntheticName(context.syntheticNames, "generator");
  if (generator !== undefined && controllerName === undefined) failRustPlannerInvariant("An admitted generator requires its hygienic controller name.", node);
  const ownedStateName = captureFact.invocationOwner !== "shared-state" || context.syntheticNames === undefined
    ? undefined : allocateRustSyntheticName(context.syntheticNames, "callable_state");
  if (captureFact.invocationOwner === "shared-state" &&
      (!suspended || callableProtocol === undefined || ownedStateName === undefined)) {
    failRustPlannerInvariant("A suspended callable's retained owner conflicts with its finalized callable contract.", node);
  }
  const leadingPlan = planRustCallableLeadingParameters(node, context);
  if (leadingPlan === undefined) {
    failRustPlannerInvariant("Callable expression leading parameters require a finalized hygienic-name scope.", node);
  }
  const leadingParameterPlans = leadingPlan.parameters;
  const closureContext: RustPlanContext = {
    ...leadingPlan.context,
    callableDeclaration: node,
    controlFlow: { nextLoopId: 0 },
    controlTargets: undefined,
    completionBoundary: undefined,
    returnResult: undefined,
    construction: undefined,
    expressionOverrides: context.construction === undefined ? leadingPlan.context.expressionOverrides : undefined,
    valueFieldLocations: context.construction === undefined ? leadingPlan.context.valueFieldLocations : undefined,
    capturedFieldOwners: undefined,
    capturedFieldIdentities: undefined,
    fallibleBoundary: callableErrorBoundary,
    asyncContext: asynchronous?.kind === "native-future" ||
      asynchronous?.kind === "js-promise" && asynchronous.lowering.kind === "factory" || generator?.kind === "async",
    generator: generator === undefined ? undefined : {
      declaration: node, controllerName: controllerName!, protocol: generator,
    },
  };
  const environment = planRustCapturedEnvironment(node, captureFact.captures, closureContext, {
    staticStorage: emission.staticStorage,
    mutableValueCapture: emission.mutableCapture,
    ...(ownedStateName === undefined ? {} : { sharedStateName: ownedStateName }),
  });
  if (environment === undefined) return undefined;
  const receiverEnvironment = planRustCapturedReceiverFields(node, captureFact.receiverFields, context, closureContext, {
    staticStorage: emission.staticStorage, offset: captureFact.captures.length,
    ...(ownedStateName === undefined ? {} : { sharedStateName: ownedStateName }),
  });
  if (receiverEnvironment === undefined) return undefined;
  const wholeEnvironment = planRustCapturedReceivers(node, captureFact.receivers, context, receiverEnvironment.context, {
    staticStorage: emission.staticStorage, offset: captureFact.captures.length + captureFact.receiverFields.length,
    ...(ownedStateName === undefined ? {} : { sharedStateName: ownedStateName }),
  });
  if (wholeEnvironment === undefined) return undefined;
  const captureBindings = [...environment.bindings, ...receiverEnvironment.bindings, ...wholeEnvironment.bindings];
  const capturedBindings = [...environment.capturedBindings];
  let recursiveName: string | undefined;
  if (captureFact.recursiveDeclaration !== undefined) {
    if (context.syntheticNames === undefined || callableProtocol === undefined) {
      failRustPlannerInvariant("An admitted recursive callable requires its selected runtime protocol and hygienic name scope.", node);
    }
    recursiveName = ownedStateName === undefined
      ? allocateRustSyntheticName(context.syntheticNames, "recursive_callable") : undefined;
    capturedBindings.push({
      declaration: captureFact.recursiveDeclaration,
      referent: undefined,
      expression: ownedStateName === undefined ? { kind: "path", path: recursiveName! } : {
        kind: "associated-call", owner: callableType!,
        method: "from_shared", args: [{
          kind: "method-call", receiver: { kind: "path", path: ownedStateName }, method: "clone", args: [],
        }],
      },
      storage: "value",
      valueCarrier: closureFact.resultCarrier,
    });
  }
  const recursiveContext = captureFact.recursiveField === undefined ? wholeEnvironment.context
    : recursiveName === undefined ? undefined
      : rustRecursiveReceiverFieldContext(captureFact.recursiveField, { kind: "path", path: recursiveName }, wholeEnvironment.context);
  if (recursiveContext === undefined) return undefined;
  const callableClosureContext: RustPlanContext = {
    ...recursiveContext,
    functionAbsenceReturnCarrier: undefined,
    capturedBindings,
  };
  const bindingStatements: RustStmt[] = [];
  let invocationArgumentsName: string | undefined;
  let closureParams: { name: string; mutable: boolean; byRefCopy?: boolean; type?: RustType }[];
  let closureMove = nativeClosureProtocol !== undefined &&
    (captureFact.captures.length > 0 || captureFact.receiverFields.length > 0 || captureFact.receivers.length > 0);
  if (callableProtocol === undefined) {
    closureParams = [
      ...leadingParameterPlans.map((parameter) => ({
        name: parameter.name!,
        mutable: false,
      })),
      ...sourceParameterPlans.map((parameter) => ({
        name: parameter.name,
        mutable: parameter.mutable && context.input.program.records.sourceParameterAbi.get(parameter.parameter)?.entryConversion === undefined,
        byRefCopy: parameter.byRefCopy,
      })),
      ...closureFact.ignoredParameterCarriers.map(() => ({ name: "_", mutable: false })),
    ];
  } else {
    const allocatedTupleName = allocateRustSyntheticName(
      context.syntheticNames!,
      "callable_arguments",
    );
    const tupleName = leadingParameterPlans.length + sourceParameterPlans.length === 0
      ? `_${allocatedTupleName}`
      : allocatedTupleName;
    invocationArgumentsName = tupleName;
    const tupleType = rustTypeFromCarrierInContext({ kind: "tuple", elements: callableProtocol.parameters }, context);
    if (tupleType === undefined) return undefined;
    closureParams = [
      ...(ownedStateName === undefined ? [] : [{ name: ownedStateName, mutable: false }]),
      ...(recursiveName === undefined ? [] : [{ name: recursiveName, mutable: false }]),
      { name: tupleName, mutable: false, type: tupleType },
    ];
    closureMove = true;
    for (const [index, parameter] of leadingParameterPlans.entries()) {
      bindingStatements.push({
        kind: "let",
        name: parameter.name!,
        mutable: false,
        init: {
          kind: "field",
          receiver: { kind: "path", path: tupleName },
          name: String(index),
        },
      });
    }
    for (const [index, parameter] of sourceParameterPlans.entries()) {
      let initializer: RustExpr = {
        kind: "field",
        receiver: { kind: "path", path: tupleName },
        name: String(leadingParameterPlans.length + index),
      };
      if (parameter.form === "default") {
        const defaultNode = Node_Initializer(context.input.program.source.ast, parameter.parameter);
        const defaultValue = defaultNode === undefined
          ? undefined
          : planExpression(defaultNode, callableClosureContext);
        if (defaultValue === undefined) {
          return undefined;
        }
        initializer = rustOptionDefaultValue(initializer, defaultValue, parameter.carrier, callableClosureContext, parameter.valueCarrier);
      }
      bindingStatements.push({
        kind: "let",
        name: parameter.name,
        mutable: parameter.mutable && context.input.program.records.sourceParameterAbi.get(parameter.parameter)?.entryConversion === undefined,
        init: initializer,
      });
    }
  }
  for (const parameter of sourceParameterPlans) {
    const entry = planRustParameterEntryConversion(parameter.parameter, parameter.name, parameter.mutable, callableClosureContext);
    if (entry === undefined) return undefined;
    bindingStatements.push(...entry);
  }
  for (const binding of bindingParameters) {
    const planned = planRustBindingPattern(
      binding.pattern,
      { kind: "path", path: binding.name },
      binding.sourceCarrier,
      callableClosureContext,
      planExpression,
    );
    if (planned === undefined) {
      return undefined;
    }
    bindingStatements.push(...planned);
  }
  const resultType = rustTypeFromCarrierInContext(bodyResultCarrier, context);
  if (resultType === undefined) {
    failRustPlannerInvariant("Block-bodied callable expressions require one finalized renderable result carrier.", node);
  }
  const sourceReturn = context.input.program.records.sourceCallableReturn.get(node);
  const bodyContext: RustPlanContext = {
    ...callableClosureContext,
    functionReturnType: resultType,
    returnResult: generator === undefined ? undefined : { errorType: callableErrorBoundary!.errorType },
    functionAbsenceReturnCarrier: sourceReturn?.undefinedReturn === true ? bodyResultCarrier : undefined,
  };
  const plannedBody = ast.kindName(bodyNode) === "KindBlock"
    ? context.planBlock(bodyNode, bodyContext)
    : (() => {
      const expression = planRustReturnValueExpression(bodyNode, bodyContext, planExpression);
      return expression === undefined ? undefined : {
        statements: [{ kind: "tail" as const, expr: expression }],
      };
    })();
  if (plannedBody === undefined) {
    return undefined;
  }
  const block = retainRustCheckedCompletion({
    statements: [...plannedBody.statements, ...(sourceReturn?.fallthroughUndefined
      ? [planRustReturnExit(planRustAbsentValue(bodyResultCarrier, bodyContext), bodyContext)]
      : generator !== undefined && emission.unitBody && context.input.program.records.callableDeclaration.get(node)?.canFallThrough === true
        ? [planRustReturnExit(undefined, bodyContext)] : [])],
  }, !emission.unitBody && generator === undefined ? sourceReturn?.canFallThrough : undefined);
  const bodyWithBindings = { statements: [...bindingStatements, ...block.statements] };
  const bodyErrorType = suspended && fallible ? rustActiveErrorType(callableClosureContext) : invocationErrorType;
  const loweredBody = generator === undefined ? applyFallibleShape(applyRustTailShape(
    bodyWithBindings,
    !emission.unitBody,
  ), bodyIsFallible
    ? {
        fallible: true,
        hasReturnValue: !emission.unitBody,
        errorType: bodyErrorType!,
        inferErrorTypeFromReturnType: nativeClosureProtocol?.fallible === true && !fallible,
        canFallThrough: context.input.program.records.callableDeclaration.get(node)?.canFallThrough === true,
      }
    : { fallible: false, hasReturnValue: !emission.unitBody }) : block;
  let finalizedBlock: RustBlock = loweredBody;
  if (generator !== undefined) {
    context.usedAliases?.add("rt");
    finalizedBlock = { statements: [...bindingStatements, {
      kind: "tail", expr: planRustGeneratorBody(loweredBody, generator, controllerName!, callableErrorBoundary!.errorType),
    }] };
  } else if (asynchronous?.kind === "js-promise") {
    context.usedAliases?.add("js_abi");
    finalizedBlock = wrapRustJsPromiseBody(loweredBody, bodyIsFallible, asynchronous.lowering);
  }
  if (closureFact.invocationResult !== undefined) {
    const conversion = closureFact.invocationResult;
    const converted = applyFinalizedValueConversion(callableClosureContext, { kind: "block", body: finalizedBlock },
      conversion, node);
    if (converted === undefined) return undefined;
    finalizedBlock = { statements: [{ kind: "tail", expr: converted }] };
  }
  if (suspended && resultIsFallible && asynchronous?.kind !== "native-future") {
    finalizedBlock = applyFallibleShape(finalizedBlock, {
      fallible: true, hasReturnValue: true,
      errorType: invocationErrorType!, inferErrorTypeFromReturnType: false,
      canFallThrough: false,
    });
  }
  const closure: RustExpr = {
    kind: "closure-block",
    params: closureParams,
    move: closureMove,
    async: asynchronous?.kind === "native-future",
    body: finalizedBlock,
  };
  if (ownedStateName !== undefined) {
    if (invocationArgumentsName === undefined) failRustPlannerInvariant("An admitted shared callable requires its selected invocation argument name.", node);
    return { expression: closure, sharedInvocation: { ownerName: ownedStateName, argumentsName: invocationArgumentsName, body: finalizedBlock } };
  }
  if (borrowedInput) return { expression: { kind: "reference", mutable: false, expr: rustValueBlock(captureBindings, closure) } };
  if (callableProtocol === undefined) {
    return { expression: nativeClosureProtocol === undefined || captureBindings.length === 0
      ? closure : rustValueBlock(captureBindings, closure) };
  }
  if (callableType === undefined) return undefined;
  if (representation === "producer") return { expression: rustValueBlock(captureBindings, closure) };
  context.usedAliases?.add("rt");
  const callable = {
    kind: "associated-call" as const,
    owner: callableType,
    method: recursiveName === undefined ? "new" : "recursive",
    args: [closure],
  };
  const result = finishRuntimeCallableExpression(callable, captureBindings);
  return { expression: frameAlternative === undefined ? result : frameAlternative.wrap(result) };
}
import { planRustReturnValueExpression } from "./value-destinations.js";
