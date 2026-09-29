import {
  applyFallibleShape,
} from "../types/fallible-shape.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
  rustErrorType,
  rustSourceBindingPath,
} from "../program/plan-context.js";
import {
  isRustUnitCarrier,
  rustCarrierReferentMutationRequiresMutableBinding,
  rustCallableProtocol,
  rustClosureProtocol,
} from "../../../target-model/types/index.js";
import {
  KindArrayBindingPattern,
  KindFunctionExpression,
  KindObjectBindingPattern,
  Node_Initializer,
} from "@tsonic/target-api/source";
import { planRustCaptureValue } from "./typed-locations.js";
import {
  rustAsyncFunctionFactKey,
  rustClosureCaptureFactKey,
  rustFallibleFactKey,
  rustGeneratorFactKey,
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustSourceBindingFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustTailShape, rustBlockTerminates, retainRustCheckedCompletion } from "../statements/block-flow.js";
import { planRustReturnExit } from "../statements/completion-exits.js";
import {
  finishRuntimeCallableExpression,
  requireExpressionCarrier,
  rustCallableConstructionType,
  rustOperationFact,
} from "./fundamentals.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustOptionDefaultValue } from "./option-default.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustReceiverIndependentMethodFactKey } from "../../../analysis/facts/operations/keys.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { planRustGenericCallableValue } from "./generic-callables.js";
import { planRustGeneratorBody } from "../declarations/callables/generator-body.js";
import { wrapRustJsPromiseBody } from "../declarations/callables/async-promise.js";
import { planRustSuspendedCallableConstruction } from "./suspended-callables.js";
import { planRustParameterEntryConversion } from "../declarations/callables/parameter-entry-conversion.js";

export function planCallableExpression(
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  return context.input.program.facts.getFact(node, rustClosureCaptureFactKey)?.invocationOwner === "shared-state"
    ? planRustSuspendedCallableConstruction(node, context)
    : planRustCallableExpressionBody(node, context);
}

export function planRustCallableExpressionBody(
  node: Node,
  context: RustPlanContext,
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
  if (rustGenericCallableValue(closureFact.resultCarrier) !== undefined) {
    return planRustGenericCallableValue(node, closureFact.resultCarrier, context);
  }
  const callableProtocol = rustCallableProtocol(closureFact.resultCarrier);
  const nativeClosureProtocol = rustClosureProtocol(closureFact.resultCarrier);
  const allParameterCarriers = closureFact.resultCarrier.kind === "function-pointer"
    ? closureFact.resultCarrier.args
    : nativeClosureProtocol?.parameters ?? callableProtocol?.parameters;
  const resultCarrier = closureFact.resultCarrier.kind === "function-pointer"
    ? closureFact.resultCarrier.result
    : nativeClosureProtocol?.result ?? callableProtocol?.result;
  const captureFact = context.input.program.facts.getFact(node, rustClosureCaptureFactKey);
  if (captureFact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-captures",
      "Callable expressions require finalized exact capture evidence.",
    ));
    return undefined;
  }
  if (closureFact.resultCarrier.kind === "function-pointer" &&
    (captureFact.captures.length !== 0 || captureFact.recursiveDeclaration !== undefined)) {
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
  const independent = context.input.program.facts.getFact(node, rustReceiverIndependentMethodFactKey);
  const constructionCarrier = independent?.carrier ?? closureFact.resultCarrier;
  if (allParameterCarriers === undefined || resultCarrier === undefined ||
    leadingParameters.length > allParameterCarriers.length ||
    !leadingParameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter.carrier, allParameterCarriers[index])) ||
    closureFact.byRefCopyParams.length !== sourceParams.length ||
    allParameterCarriers.length - leadingParameters.length !== sourceParams.length) {
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
        return representation !== undefined && representation.kind !== "value";
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
  const leadingParameterPlans = (independent === undefined ? leadingParameters : []).map((parameter) => ({
    ...parameter,
    name: context.syntheticNames === undefined
      ? undefined
      : allocateRustSyntheticName(
          context.syntheticNames,
          parameter.kind === "this" ? "_object_this" : "_object_receiver",
        ),
  }));
  if (leadingParameterPlans.some((parameter) => parameter.name === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-leading-parameter",
      "Callable expression leading parameters require a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const expressionOverrides = new Map(context.expressionOverrides ?? []);
  for (const parameter of leadingParameterPlans) {
    if (parameter.kind !== "this") {
      continue;
    }
    const visitThis = (candidate: Node): void => {
      const kind = context.input.program.source.ast.kindName(candidate);
      if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
        const carrier = context.input.program.facts.getRuntimeCarrierFact(candidate)?.carrier;
        if (rustTargetTypeRefEquals(carrier, parameter.carrier)) {
          expressionOverrides.set(candidate, {
            carrier: parameter.carrier,
            valueForm: "value",
            expression: { kind: "path", path: parameter.name! },
          });
        }
        return;
      }
      if (candidate !== node &&
        (kind === KindFunctionExpression || kind === "KindFunctionDeclaration" ||
          kind === "KindMethodDeclaration" || kind === "KindGetAccessor" ||
          kind === "KindSetAccessor" || kind === "KindClassDeclaration")) {
        return;
      }
      context.input.program.source.ast.forEachChild(candidate, (child) => {
        if (child !== undefined) {
          visitThis(child);
        }
      });
    };
    visitThis(node);
  }
  const closureContext: RustPlanContext = {
    ...context,
    callableDeclaration: node,
    controlFlow: { nextLoopId: 0 },
    controlTargets: undefined,
    completionBoundary: undefined,
    fallibleBoundary: callableErrorBoundary,
    asyncContext: asynchronous !== undefined || generator?.kind === "async",
    generator: generator === undefined ? undefined : {
      declaration: node, controllerName: controllerName!, protocol: generator,
    },
    expressionOverrides,
  };
  const captureBindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const capturedBindings = [...(context.capturedBindings ?? [])];
  for (const [index, capture] of captureFact.captures.entries()) {
    const moveCapture = capture.storage === "cell" || capture.storage === "borrow-cell" ||
      context.input.program.valueLifetimes.canMoveCapture(node, capture.declaration);
    if (context.syntheticNames === undefined || !requireRustCarrierRequirements(
      capture.carrier,
      [...(moveCapture ? [] : ["clone" as const]), ...(nativeClosureProtocol === undefined ? ["static" as const] : [])],
      capture.reference,
      closureContext,
    )) {
      return undefined;
    }
    const binding = context.input.program.facts.getFact(capture.reference, rustSourceBindingFactKey);
    if (binding === undefined) {
      return undefined;
    }
    const sourceName = context.input.program.names.nameForDeclaration(binding.sourceDeclaration) ?? "";
    const sourcePath = rustSourceBindingPath(context, binding);
    if (!isValidRustIdentifier(sourceName)) {
      return undefined;
    }
    if (sourcePath === undefined) {
      return undefined;
    }
    if (capture.mutable === true) {
      if (capture.storage !== "value" || closureFact.resultCarrier.kind !== "closure" ||
        (closureFact.resultCarrier.callTrait !== "FnMut" && closureFact.resultCarrier.callTrait !== "FnOnce")) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
          "rust.backend.native-mutable-capture", "A mutable value capture requires its exact owning native callable contract."));
        return undefined;
      }
      capturedBindings.push({ declaration: capture.declaration, expression: { kind: "path", path: sourcePath },
        storage: "value", valueCarrier: capture.carrier });
      continue;
    }
    const name = allocateRustSyntheticName(context.syntheticNames, `capture_${sourceName}`);
    const captureValue = planRustCaptureValue(
      capture.reference,
      sourcePath,
      capture.storage,
      moveCapture,
      context,
    );
    captureBindings.push({
      name,
      value: captureValue,
    });
    capturedBindings.push({
      declaration: capture.declaration,
      expression: ownedStateName === undefined ? { kind: "path", path: name } : {
        kind: "field", receiver: {
          kind: "field", receiver: { kind: "path", path: ownedStateName }, name: "state",
        }, name: String(index),
      },
      storage: capture.storage,
      valueCarrier: capture.carrier,
      ...(ownedStateName === undefined ? {} : { borrowed: true }),
    });
  }
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
  const callableClosureContext: RustPlanContext = {
    ...closureContext,
    functionUndefinedReturn: false,
    capturedBindings,
  };
  const bindingStatements: RustStmt[] = [];
  let closureParams: { name: string; mutable: boolean; byRefCopy?: boolean }[];
  let closureMove = nativeClosureProtocol !== undefined && captureFact.captures.length > 0;
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
    ];
  } else {
    const allocatedTupleName = allocateRustSyntheticName(
      context.syntheticNames!,
      "callable_arguments",
    );
    const tupleName = leadingParameterPlans.length + sourceParameterPlans.length === 0
      ? `_${allocatedTupleName}`
      : allocatedTupleName;
    closureParams = [
      ...(ownedStateName === undefined ? [] : [{ name: ownedStateName, mutable: false }]),
      ...(recursiveName === undefined ? [] : [{ name: recursiveName, mutable: false }]),
      { name: tupleName, mutable: false },
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
    functionUndefinedReturn: sourceReturn?.undefinedReturn === true,
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
      ? [planRustReturnExit({ kind: "path", path: "None" }, bodyContext)] : [])],
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
  if (callableProtocol === undefined) {
    return nativeClosureProtocol === undefined || captureBindings.length === 0
      ? closure
      : { kind: "block", bindings: captureBindings, value: closure };
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
