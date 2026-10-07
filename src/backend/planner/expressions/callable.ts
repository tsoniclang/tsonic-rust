import { rustValueBlock } from "../../target-ast/value-block.js";
import {
  applyFallibleShape,
} from "../types/fallible-shape.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
  rustErrorType,
} from "../program/plan-context.js";
import {
  isRustUnitCarrier,
  rustCarrierReferentMutationRequiresMutableBinding,
  rustCallableProtocol,
  rustClosureProtocol,
} from "../../../target-model/types/index.js";
import {
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  Node_Initializer,
} from "@tsonic/target-api/source";
import { planRustCapturedEnvironment } from "./capture-environments.js";
import { planRustAbsentValue } from "./optional-storage.js";
import {
  rustAsyncFunctionFactKey,
  rustClosureCaptureFactKey,
  rustFallibleFactKey,
  rustGeneratorFactKey,
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustTailShape, rustBlockTerminates, retainRustCheckedCompletion } from "../../target-ast/normalization/block-flow.js";
import { planRustReturnExit } from "../statements/completion-exits.js";
import {
  finishRuntimeCallableExpression,
  requireExpressionCarrier,
  rustCallableConstructionType,
  rustOperationFact,
} from "./fundamentals.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression, type RustExpressionResultUse } from "./entry.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import { rustOptionDefaultValue } from "./option-default.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustReceiverIndependentMethodFactKey } from "../../../analysis/facts/operations/keys.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustCallableInputProtocol } from "../../../target-model/types/carriers/callables.js";
import { planRustFrameCallableValue } from "./frame-callables.js";
import { planRustGenericCallableValue } from "./generic-callables.js";
import { planRustGeneratorBody } from "../declarations/callables/generator-body.js";
import { wrapRustJsPromiseBody } from "../declarations/callables/async-promise.js";
import { planRustSuspendedCallableConstruction } from "./suspended-callables.js";
import { planRustParameterEntryConversion } from "../declarations/callables/parameter-entry-conversion.js";
import { planRustCallableLeadingParameters } from "../declarations/callables/leading-parameters.js";
import { finalizedConversionIsValid } from "../../../analysis/facts/finalized-operation/conversions.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { planRustCapturedReceiverFields, planRustCapturedReceivers, rustRecursiveReceiverFieldContext,
  validateRustRecursiveReceiverField } from "./receiver-captures.js";

export function planCallableExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse = "value",
): RustExpr | undefined {
  return resultUse !== "discarded" && context.input.program.facts.getFact(node, rustClosureCaptureFactKey)?.invocationOwner === "shared-state"
    ? planRustSuspendedCallableConstruction(node, context)
    : planRustCallableExpressionBody(node, context, resultUse);
}

export function planRustCallableExpressionBody(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse = "value",
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const closureFact = rustOperationFact(node, context);
  if (closureFact === undefined || closureFact.kind !== "closure") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure",
      "Callable expressions require a finalized closure fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, closureFact.resultCarrier, context, "rust.backend.closure-carrier")) {
    return undefined;
  }
  const captureFact = context.input.program.facts.getFact(node, rustClosureCaptureFactKey);
  if (captureFact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-captures",
      "Callable expressions require finalized exact capture evidence.",
    ));
    return undefined;
  }
  if (!validateRustRecursiveReceiverField(node, captureFact, closureFact.resultCarrier, context)) return undefined;
  if (resultUse === "discarded") return { kind: "tuple-literal", elements: [] };
  const independent = context.input.program.facts.getFact(node, rustReceiverIndependentMethodFactKey);
  const constructionCarrier = independent?.carrier ?? closureFact.resultCarrier;
  if (rustFrameCallableValue(constructionCarrier) !== undefined)
    return planRustFrameCallableValue(node, constructionCarrier, context);
  if (rustGenericCallableValue(constructionCarrier) !== undefined) {
    return planRustGenericCallableValue(node, constructionCarrier, context);
  }
  const sourceCallableProtocol = rustCallableProtocol(closureFact.resultCarrier);
  const callableProtocol = rustCallableProtocol(constructionCarrier);
  const borrowedInput = rustCallableInputProtocol(constructionCarrier) !== undefined;
  const nativeClosureProtocol = rustClosureProtocol(closureFact.resultCarrier);
  const allParameterCarriers = closureFact.resultCarrier.kind === "function-pointer"
    ? closureFact.resultCarrier.args
    : nativeClosureProtocol?.parameters ?? sourceCallableProtocol?.parameters;
  const resultCarrier = closureFact.resultCarrier.kind === "function-pointer"
    ? closureFact.resultCarrier.result
    : nativeClosureProtocol?.result ?? sourceCallableProtocol?.result;
  if (closureFact.resultCarrier.kind === "function-pointer" &&
    (captureFact.captures.length !== 0 || captureFact.receiverFields.length !== 0 || captureFact.receivers.length !== 0 || captureFact.recursiveDeclaration !== undefined)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function-pointer-capture",
      "Native Rust function pointers cannot carry captured or recursive callable state.",
    ));
    return undefined;
  }
  if (nativeClosureProtocol !== undefined && captureFact.recursiveDeclaration !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.native-closure-recursion",
      "A native Rust closure passed to a provider operation cannot recursively invoke itself.",
    ));
    return undefined;
  }
  const sourceParams = context.input.program.source.ast.parameters(node);
  const leadingParameters = closureFact.leadingParameters ?? [];
  if (allParameterCarriers === undefined || resultCarrier === undefined ||
    leadingParameters.length > allParameterCarriers.length ||
    !leadingParameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter.carrier, allParameterCarriers[index])) ||
    closureFact.byRefCopyParams.length !== sourceParams.length ||
    allParameterCarriers.length - leadingParameters.length !== sourceParams.length + closureFact.ignoredParameterCarriers.length ||
    !closureFact.ignoredParameterCarriers.every((carrier, index) =>
      rustTargetTypeRefEquals(carrier, allParameterCarriers[leadingParameters.length + sourceParams.length + index]))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-abi",
      "Callable-expression parameter count does not match its finalized Rust closure ABI.",
    ));
    return undefined;
  }
  const parameterCarriers = allParameterCarriers.slice(leadingParameters.length);
  if (callableProtocol !== undefined && context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-argument-tuple",
      "Runtime callable expressions require a finalized hygienic-name scope.",
    ));
    return undefined;
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
  for (const [index, parameter] of sourceParams.entries()) {
    if (parameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.closure-parameter",
        "Callable expression contains an undefined parameter slot.",
      ));
      return undefined;
    }
    const nameNode = ast.name(parameter);
    const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
    const bindingPattern = nameNode !== undefined &&
        (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern)
      ? nameNode
      : undefined;
    if (bindingPattern !== undefined && context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.closure-binding-name",
        "Binding-pattern closure parameter requires a finalized hygienic-name scope.",
      ));
      return undefined;
    }
    const parameterName = bindingPattern === undefined
      ? context.input.program.names.nameForDeclaration(parameter) ?? ""
      : allocateRustSyntheticName(context.syntheticNames!, "binding_parameter");
    if (!isValidRustIdentifier(parameterName)) {
      return undefined;
    }
    const parameterCarrier = parameterCarriers[index];
    const parameterAbi = context.input.program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
    if (parameterCarrier === undefined || parameterAbi === undefined ||
      !rustTargetTypeRefEquals(parameterCarrier, parameterAbi.parameterCarrier) ||
      (callableProtocol === undefined && closureFact.parameterForms === "required-only" &&
        parameterAbi.form !== "required")) {
      return undefined;
    }
    const byRefCopy = closureFact.byRefCopyParams[index] === true;
    const ownedBinding = parameterCarrier.kind !== "pointer" && parameterCarrier.kind !== "reference";
    const referentMutationRequiresMutableBinding =
      rustCarrierReferentMutationRequiresMutableBinding(parameterCarrier, carrier => {
        const representation = context.input.program.objectRepresentations.representationFor(
          context.input.program.projectTypes.definitionForCarrier(carrier));
        return representation !== undefined && (representation.kind !== "value" || !representation.mutable);
      });
    sourceParameterPlans.push({
      parameter,
      name: parameterName,
      ...(bindingPattern === undefined ? {} : { pattern: bindingPattern }),
      carrier: parameterCarrier,
      valueCarrier: parameterAbi.valueCarrier,
      form: parameterAbi.form,
      byRefCopy,
      mutable: bindingPattern === undefined &&
        (context.input.program.facts.getFact(parameter, rustMutatedBindingFactKey) !== undefined ||
          ownedBinding && referentMutationRequiresMutableBinding &&
            context.input.program.facts.getFact(parameter, rustMutatedReferentFactKey) !== undefined),
    });
    if (bindingPattern !== undefined) {
      if (byRefCopy) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, parameter),
          "rust.backend.closure-binding-carrier",
          "Binding-pattern closure parameter requires one exact by-value source carrier.",
        ));
        return undefined;
      }
      bindingParameters.push({
        pattern: bindingPattern,
        name: parameterName,
        sourceCarrier: parameterAbi.valueCarrier,
      });
    }
  }
  const bodyNode = context.input.program.source.ast.body(node);
  if (bodyNode === undefined) {
    return undefined;
  }
  const fallible = context.input.program.facts.getFact(node, rustFallibleFactKey) !== undefined;
  const generator = context.input.program.facts.getFact(node, rustGeneratorFactKey);
  const asynchronous = context.input.program.facts.getFact(node, rustAsyncFunctionFactKey);
  const suspended = generator !== undefined || asynchronous !== undefined;
  const bodyResultCarrier = generator?.returnType ?? asynchronous?.outputCarrier ?? resultCarrier;
  if (ast.hasModifierKind(node, "async") && !suspended) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.closure-suspension", "Async callable expressions require sealed suspension evidence."));
    return undefined;
  }
  if (generator !== undefined && fallible) {
    context.diagnostics.push(unsupportedConstructDiagnostic(diagnosticInput(context, node),
      "rust.backend.generator-fallibility", "Throwing generator bodies require a closed Rust generator error protocol."));
    return undefined;
  }
  const resultIsFallible = callableProtocol !== undefined || nativeClosureProtocol?.fallible === true || fallible;
  const bodyIsFallible = suspended ? fallible : resultIsFallible;
  const callableErrorBoundary = resultIsFallible || generator !== undefined
    ? context.fallibleBoundary ?? rustCurrentErrorBoundary(context)
    : undefined;
  if ((resultIsFallible || generator !== undefined) && callableErrorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-error-boundary",
      "Callable expression has no exact source-package error boundary.",
    ));
    return undefined;
  }
  if (resultIsFallible) {
    context.usedAliases?.add("rt");
  }
  const controllerName = generator === undefined || context.syntheticNames === undefined
    ? undefined : allocateRustSyntheticName(context.syntheticNames, "generator");
  if (generator !== undefined && controllerName === undefined) return undefined;
  const ownedStateName = captureFact.invocationOwner !== "shared-state" || context.syntheticNames === undefined
    ? undefined : allocateRustSyntheticName(context.syntheticNames, "callable_state");
  if (captureFact.invocationOwner === "shared-state" &&
      (!suspended || callableProtocol === undefined || ownedStateName === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.closure-invocation-owner", "A suspended callable's retained owner conflicts with its finalized callable contract."));
    return undefined;
  }
  const leadingPlan = planRustCallableLeadingParameters(node, leadingParameters, context);
  if (leadingPlan === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-leading-parameter",
      "Callable expression leading parameters require a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const leadingParameterPlans = leadingPlan.parameters;
  const constructionParameters = [
    ...leadingParameterPlans.map(parameter => parameter.carrier),
    ...parameterCarriers,
  ];
  if (callableProtocol !== undefined &&
    (!rustTargetTypeRefEquals(callableProtocol.result, resultCarrier) ||
      callableProtocol.parameters.length !== constructionParameters.length ||
      !callableProtocol.parameters.every((carrier, index) =>
        rustTargetTypeRefEquals(carrier, constructionParameters[index])))) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.closure-construction-abi", "Callable construction requires its exact finalized receiver and source parameter ABI."));
    return undefined;
  }
  const closureContext: RustPlanContext = {
    ...leadingPlan.context,
    callableDeclaration: node,
    controlFlow: { nextLoopId: 0 },
    controlTargets: undefined,
    completionBoundary: undefined,
    construction: undefined,
    expressionOverrides: context.construction === undefined ? leadingPlan.context.expressionOverrides : undefined,
    valueFieldLocations: context.construction === undefined ? leadingPlan.context.valueFieldLocations : undefined,
    capturedFieldOwners: undefined,
    capturedFieldIdentities: undefined,
    fallibleBoundary: callableErrorBoundary,
    asyncContext: asynchronous !== undefined || generator?.kind === "async",
    generator: generator === undefined ? undefined : {
      declaration: node, controllerName: controllerName!, protocol: generator,
    },
  };
  const environment = planRustCapturedEnvironment(node, captureFact.captures, closureContext, {
    staticStorage: nativeClosureProtocol === undefined && !borrowedInput,
    mutableValueCapture: closureFact.resultCarrier.kind === "closure" &&
      (closureFact.resultCarrier.callTrait === "FnMut" || closureFact.resultCarrier.callTrait === "FnOnce"),
    ...(ownedStateName === undefined ? {} : { sharedStateName: ownedStateName }),
  });
  if (environment === undefined) return undefined;
  const receiverEnvironment = planRustCapturedReceiverFields(node, captureFact.receiverFields, context, closureContext, {
    staticStorage: nativeClosureProtocol === undefined && !borrowedInput, offset: captureFact.captures.length,
    ...(ownedStateName === undefined ? {} : { sharedStateName: ownedStateName }),
  });
  if (receiverEnvironment === undefined) return undefined;
  const wholeEnvironment = planRustCapturedReceivers(node, captureFact.receivers, context, receiverEnvironment.context, {
    staticStorage: nativeClosureProtocol === undefined && !borrowedInput, offset: captureFact.captures.length + captureFact.receiverFields.length,
    ...(ownedStateName === undefined ? {} : { sharedStateName: ownedStateName }),
  });
  if (wholeEnvironment === undefined) return undefined;
  const captureBindings = [...environment.bindings, ...receiverEnvironment.bindings, ...wholeEnvironment.bindings];
  const capturedBindings = [...environment.capturedBindings];
  let recursiveName: string | undefined;
  if (captureFact.recursiveDeclaration !== undefined) {
    if (context.syntheticNames === undefined || callableProtocol === undefined) {
      return undefined;
    }
    recursiveName = ownedStateName === undefined
      ? allocateRustSyntheticName(context.syntheticNames, "recursive_callable") : undefined;
    capturedBindings.push({
      declaration: captureFact.recursiveDeclaration,
      expression: ownedStateName === undefined ? { kind: "path", path: recursiveName! } : {
        kind: "associated-call", owner: rustCallableConstructionType(constructionCarrier, context)!,
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
        mutable: parameter.mutable && context.input.program.facts.getFact(parameter.parameter, rustSourceParameterAbiFactKey)?.entryConversion === undefined,
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
        initializer = rustOptionDefaultValue(initializer, defaultValue, parameter.carrier, callableClosureContext);
      }
      bindingStatements.push({
        kind: "let",
        name: parameter.name,
        mutable: parameter.mutable && context.input.program.facts.getFact(parameter.parameter, rustSourceParameterAbiFactKey)?.entryConversion === undefined,
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-result",
      "Block-bodied callable expressions require one finalized renderable result carrier.",
    ));
    return undefined;
  }
  const sourceReturn = context.input.program.facts.getFact(node, rustSourceCallableReturnFactKey);
  const bodyContext: RustPlanContext = {
    ...callableClosureContext,
    functionReturnType: resultType,
    functionAbsenceReturnCarrier: sourceReturn?.undefinedReturn === true ? bodyResultCarrier : undefined,
  };
  const plannedBody = ast.kindName(bodyNode) === "KindBlock"
    ? context.planBlock(bodyNode, bodyContext)
    : (() => {
      const expression = planExpression(bodyNode, bodyContext);
      return expression === undefined ? undefined : {
        statements: [{ kind: "tail" as const, expr: expression }],
      };
    })();
  if (plannedBody === undefined) {
    return undefined;
  }
  const block = retainRustCheckedCompletion({
    statements: [...plannedBody.statements, ...(sourceReturn?.fallthroughUndefined
      ? [planRustReturnExit(planRustAbsentValue(bodyResultCarrier, bodyContext), bodyContext)] : [])],
  }, !isRustUnitCarrier(bodyResultCarrier) && generator === undefined ? sourceReturn?.canFallThrough : undefined);
  if (!isRustUnitCarrier(bodyResultCarrier) && !rustBlockTerminates(block)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.closure-return-flow",
      "Value-returning callable expressions require finalized control flow that returns on every path.",
    ));
    return undefined;
  }
  const bodyWithBindings = { statements: [...bindingStatements, ...block.statements] };
  const loweredBody = generator === undefined ? applyFallibleShape(applyRustTailShape(
    bodyWithBindings,
    !isRustUnitCarrier(bodyResultCarrier),
  ), bodyIsFallible
    ? {
        fallible: true,
        hasReturnValue: !isRustUnitCarrier(bodyResultCarrier),
        errorType: rustActiveErrorType(callableClosureContext)!,
        inferErrorTypeFromReturnType: false,
      }
    : { fallible: false, hasReturnValue: !isRustUnitCarrier(bodyResultCarrier) }) : block;
  let finalizedBlock: RustBlock = loweredBody;
  if (generator !== undefined) {
    context.usedAliases?.add("rt");
    finalizedBlock = { statements: [...bindingStatements, {
      kind: "tail", expr: planRustGeneratorBody(loweredBody, generator, controllerName!, rustErrorType(callableErrorBoundary!)),
    }] };
  } else if (asynchronous?.kind === "js-promise") {
    context.usedAliases?.add("js_abi");
    finalizedBlock = wrapRustJsPromiseBody(loweredBody, bodyIsFallible);
  }
  if (closureFact.invocationResult !== undefined) {
    const conversion = closureFact.invocationResult;
    const tail = finalizedBlock.statements[finalizedBlock.statements.length - 1];
    if (!finalizedConversionIsValid(conversion, context.input.program.typeDefinitions) ||
      !rustTargetTypeRefEquals(conversion.sourceCarrier, generator?.resultCarrier ?? asynchronous?.futureCarrier) ||
      !rustTargetTypeRefEquals(conversion.targetCarrier, resultCarrier) ||
      asynchronous?.kind === "native-future" || tail?.kind !== "tail") {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.closure-result-conversion", "A suspended closure result conversion requires its exact constructed value and invocation ABI."));
      return undefined;
    }
    const converted = applyFinalizedValueConversion(callableClosureContext, tail.expr,
      conversion, node, "operation-result");
    if (converted === undefined) return undefined;
    finalizedBlock = { statements: [...finalizedBlock.statements.slice(0, -1), { kind: "tail", expr: converted }] };
  }
  if (suspended && resultIsFallible && asynchronous?.kind !== "native-future") {
    finalizedBlock = applyFallibleShape(finalizedBlock, {
      fallible: true, hasReturnValue: true,
      errorType: rustActiveErrorType(callableClosureContext)!, inferErrorTypeFromReturnType: false,
    });
  }
  const onlyStatement = finalizedBlock.statements.length === 1
    ? finalizedBlock.statements[0]
    : undefined;
  const closure: RustExpr = asynchronous?.kind !== "native-future" && onlyStatement?.kind === "tail" &&
      closureParams.every((parameter) => !parameter.mutable)
    ? {
      kind: "closure",
      params: closureParams.map((parameter) => ({
        name: parameter.name,
        byRefCopy: parameter.byRefCopy === true,
      })),
      ...(closureMove ? { move: true } : {}),
      body: onlyStatement.expr,
    }
    : {
        kind: "closure-block",
        params: closureParams,
        move: closureMove,
        async: asynchronous?.kind === "native-future",
        body: finalizedBlock,
      };
  if (ownedStateName !== undefined) return closure;
  if (borrowedInput) return { kind: "reference", mutable: false, expr: rustValueBlock(captureBindings, closure) };
  if (callableProtocol === undefined) {
    return nativeClosureProtocol === undefined || captureBindings.length === 0
      ? closure
      : rustValueBlock(captureBindings, closure);
  }
  const callableType = rustCallableConstructionType(
    constructionCarrier,
    context,
  );
  if (callableType === undefined) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  const callable = {
    kind: "associated-call" as const,
    owner: callableType,
    method: recursiveName === undefined ? "new" : "recursive",
    args: [closure],
  };
  return finishRuntimeCallableExpression(
    callable,
    captureBindings,
  );
}
