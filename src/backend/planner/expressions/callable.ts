import {
  applyFallibleShape,
  applyRustFallibleResultExpression,
} from "../types/fallible-shape.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustCurrentErrorBoundary,
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
  rustClosureCaptureFactKey,
  rustFallibleFactKey,
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustSourceBindingFactKey,
  rustSourceParameterAbiFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustTailShape, rustBlockTerminates } from "../statements/block-flow.js";
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
import { rustOptionDefaultValue } from "../option-default.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

function collapseExactForwardingClosure(
  closure: RustExpr,
  captureCount: number,
): RustExpr {
  if (captureCount !== 0 || closure.kind !== "closure" || closure.move === true ||
    closure.params.some((parameter) => parameter.byRefCopy) ||
    closure.body.kind !== "call" || (closure.body.genericArguments?.length ?? 0) !== 0 ||
    closure.body.args.length !== closure.params.length ||
    !closure.body.args.every((argument, index) =>
      argument.kind === "path" && argument.path === closure.params[index]?.name)) {
    return closure;
  }
  return { kind: "path", path: closure.body.path };
}

export function planCallableExpression(
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
    const objectRepresentation = context.input.program.objectRepresentations.representationFor(
      context.input.program.projectTypes.definitionForCarrier(parameterCarrier),
    );
    const referentMutationRequiresMutableBinding =
      rustCarrierReferentMutationRequiresMutableBinding(parameterCarrier) &&
      (objectRepresentation === undefined || objectRepresentation.kind === "value");
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
  const resultIsFallible = callableProtocol !== undefined || fallible;
  const callableErrorBoundary = resultIsFallible
    ? context.fallibleBoundary ?? rustCurrentErrorBoundary(context)
    : undefined;
  if (resultIsFallible && callableErrorBoundary === undefined) {
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
  const leadingParameterPlans = leadingParameters.map((parameter) => ({
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
    asyncContext: false,
    generator: undefined,
    expressionOverrides,
  };
  const captureBindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const capturedBindings = [...(context.capturedBindings ?? [])];
  for (const capture of captureFact.captures) {
    if (context.syntheticNames === undefined || !requireRustCarrierRequirements(
      capture.carrier,
      nativeClosureProtocol === undefined ? ["clone", "static"] : ["clone"],
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
    const name = allocateRustSyntheticName(context.syntheticNames, `capture_${sourceName}`);
    const captureValue = planRustCaptureValue(
      capture.reference,
      sourcePath,
      capture.storage,
      context,
    );
    captureBindings.push({
      name,
      value: captureValue,
    });
    capturedBindings.push({
      declaration: capture.declaration,
      path: name,
      storage: capture.storage,
      valueCarrier: capture.carrier,
    });
  }
  let recursiveName: string | undefined;
  if (captureFact.recursiveDeclaration !== undefined) {
    if (context.syntheticNames === undefined || callableProtocol === undefined) {
      return undefined;
    }
    recursiveName = allocateRustSyntheticName(context.syntheticNames, "recursive_callable");
    capturedBindings.push({
      declaration: captureFact.recursiveDeclaration,
      path: recursiveName,
      storage: "value",
      valueCarrier: closureFact.resultCarrier,
    });
  }
  const callableClosureContext: RustPlanContext = {
    ...closureContext,
    capturedBindings,
  };
  const bindingStatements: RustStmt[] = [];
  let closureParams: { name: string; mutable: boolean; byRefCopy?: boolean }[];
  let closureMove = nativeClosureProtocol !== undefined && captureBindings.length > 0;
  if (callableProtocol === undefined) {
    closureParams = [
      ...leadingParameterPlans.map((parameter) => ({
        name: parameter.name!,
        mutable: false,
      })),
      ...sourceParameterPlans.map((parameter) => ({
        name: parameter.name,
        mutable: parameter.mutable,
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
        initializer = rustOptionDefaultValue(initializer, defaultValue);
      }
      bindingStatements.push({
        kind: "let",
        name: parameter.name,
        mutable: parameter.mutable,
        init: initializer,
      });
    }
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
  if (context.input.program.source.ast.kindName(bodyNode) !== "KindBlock") {
    const body = planExpression(bodyNode, callableClosureContext);
    if (body === undefined) {
      return undefined;
    }
    const unitFallibleEffect = resultIsFallible &&
      isRustUnitCarrier(resultCarrier) && body.kind !== "bottom";
    const resultBody = !resultIsFallible || body.kind === "bottom"
      ? body
      : applyRustFallibleResultExpression(
          unitFallibleEffect ? { kind: "path", path: "()" } : body,
          { errorType: rustActiveErrorType(callableClosureContext)! },
        );
    const closure: RustExpr = !unitFallibleEffect && bindingStatements.length === 0 &&
        closureParams.every((parameter) => !parameter.mutable)
      ? {
          kind: "closure",
          params: closureParams.map((parameter) => ({
            name: parameter.name,
            byRefCopy: parameter.byRefCopy === true,
          })),
          ...(closureMove ? { move: true } : {}),
          body: resultBody,
        }
      : {
          kind: "closure-block",
          params: closureParams,
          move: closureMove,
          async: false,
          body: {
            statements: [
              ...bindingStatements,
              ...(unitFallibleEffect ? [{ kind: "expr" as const, expr: body }] : []),
              { kind: "tail", expr: resultBody },
            ],
          },
        };
    if (callableProtocol === undefined) {
      const nativeCallable = collapseExactForwardingClosure(closure, captureBindings.length);
      return nativeClosureProtocol === undefined || captureBindings.length === 0
        ? nativeCallable
        : { kind: "block", bindings: captureBindings, value: closure };
    }
    const callableType = rustCallableConstructionType(
      closureFact.resultCarrier,
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
  const resultType = rustTypeFromCarrierInContext(resultCarrier, context);
  if (resultType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.closure-result",
      "Block-bodied callable expressions require one finalized renderable result carrier.",
    ));
    return undefined;
  }
  const block = context.planBlock(bodyNode, {
    ...callableClosureContext,
    functionReturnType: resultType,
  });
  if (block === undefined) {
    return undefined;
  }
  if (!isRustUnitCarrier(resultCarrier) && !rustBlockTerminates(block)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.closure-return-flow",
      "Value-returning callable expressions require finalized control flow that returns on every path.",
    ));
    return undefined;
  }
  const finalizedBlock = applyFallibleShape(applyRustTailShape(
    { statements: [...bindingStatements, ...block.statements] },
    !isRustUnitCarrier(resultCarrier),
  ), resultIsFallible
    ? {
        fallible: true,
        hasReturnValue: !isRustUnitCarrier(resultCarrier),
        errorType: rustActiveErrorType(callableClosureContext)!,
        inferErrorTypeFromReturnType: false,
      }
    : { fallible: false, hasReturnValue: !isRustUnitCarrier(resultCarrier) });
  const onlyStatement = finalizedBlock.statements.length === 1
    ? finalizedBlock.statements[0]
    : undefined;
  const closure: RustExpr = onlyStatement?.kind === "tail" &&
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
        async: false,
        body: finalizedBlock,
      };
  if (callableProtocol === undefined) {
    const nativeCallable = collapseExactForwardingClosure(closure, captureBindings.length);
    return nativeClosureProtocol === undefined || captureBindings.length === 0
      ? nativeCallable
      : { kind: "block", bindings: captureBindings, value: closure };
  }
  const callableType = rustCallableConstructionType(
    closureFact.resultCarrier,
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
