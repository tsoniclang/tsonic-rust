import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { requireRustRecord } from "../../program/records/objects/required-records.js";
import { rustTypeParameterFromSourceContract } from "../../../target-model/types/carriers/generic-references.js";

import { appendRustDiagnostic } from "../../program/walk.js";
import { KindBlock, KindFunctionExpression, KindBindingElement, KindParameter, KindVariableDeclaration, Node_Initializer, Node_Name, Node_Type, sourceLexicalEnvironment, sourceCallableValueParameters } from "@tsonic/target-api/source";

import { rustSourceOptionalTargetType, rustOptionElementCarrier, rustCallableProtocol, rustCallableInputProtocol, rustCallableTargetType, rustClosureProtocol, rustUnitTargetType } from "../../../target-model/types/index.js";
import { recordRustParameterAbiSelection, recordCallableDefaultParameterFacts, refuseRustParameterCarrier } from "./parameter-facts.js";
import { recordStatementFacts } from "../../control-flow/statements.js";
import { requireDenseSourceNodes } from "../../source-evidence/dense-nodes.js";
import { resolveExpressionCarrier } from "../../source-evidence/types/resolution/expression-carriers.js";
import { reconcileRequiredCarrier } from "../../conversions/contextual-values.js";
import { resolveRustContextualParameterAbi } from "../calls/source-callable-abi.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { rustResolutionContext } from "../../program/walk.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { setCarrierFact } from "../../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { closeRustRetainedCallableCarrier } from "../../../policy/ownership/retained-storage.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rebindRustCallableCarrier } from "../../../policy/types/callables/method-values.js";
import { selectedSourceCallableReturn } from "../calls/source-callable-abi.js";
import { finalizeRustCallableSignature } from "../calls/signature-query.js";
import { rustCapturedBindingStorage } from "../storage/capture-storage.js";
import { selectRustInferredReturn } from "../calls/inferred-return.js";
import { createRustCarrierProbe } from "../../program/carrier-probe.js";
import { recordCallableParameterSignatureFacts } from "./parameter-signature.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import { finalizeValueConversion } from "../../../policy/operations/members/abi/conversions.js";

import { rustCallableInvocationResult } from "../../../policy/types/callables/return-contexts.js";
import { rustCallableExpressionValueDeclaration, rustSourceClosureValueCarrier } from "./function-values.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { selectRustCallableConversion } from "../../../policy/conversions/callable.js";
import { selectRustClosedCallableContext } from "../../expected-types/callable-contexts.js";

export function resolveFunctionExpressionSignature(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier?: TargetTypeRef,
) {
  const { ast } = walk.context;
  const genericParameters = walk.context.sourceLifetimes.contractFor(expression)?.parameters
    .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const parameters = sourceCallableValueParameters(ast, expression, walk.context.semanticsFor(expression));
  if (parameters === undefined) return undefined;
  const sourceSelected = sourceCarrier ?? resolveRustTargetTypeRef(
    expression, { ...rustResolutionContext(walk, expression, "value"), callableRepresentation: "signature" }, walk.operationOptions,
  );
  const sourceProtocol = sourceSelected?.kind === "function-pointer"
    ? { parameters: sourceSelected.args, result: sourceSelected.result }
    : rustGenericCallableProtocol(sourceSelected, genericParameters) ?? rustClosureProtocol(sourceSelected) ?? rustCallableProtocol(sourceSelected);
  if (sourceSelected === undefined || sourceProtocol === undefined) return undefined;
  const query = parameters.every(parameter => walk.context.records.sourceParameterAbi.get(parameter) !== undefined)
    ? walk : createRustCarrierProbe(walk);
  if (query !== walk) recordCallableParameterSignatureFacts(query, expression, sourceSelected);
  const finalized = rustCallableInvocationResult(query.context.records, expression);
  const inference = finalized !== undefined ? { kind: "complete" as const, carrier: finalized }
    : ast.hasModifierKind(expression, "async") ? { kind: "complete" as const, carrier: sourceProtocol.result }
      : selectRustInferredReturn(query, expression, sourceProtocol.result);
  const sourceResult = inference.kind === "complete" ? inference.carrier : inference.hint;
  if (sourceResult === undefined) return undefined;
  const parameterCarriers = sourceProtocol.parameters.map((carrier, index) =>
    Node_Initializer(ast, parameters[index]) === undefined ? carrier : rustSourceOptionalTargetType(carrier));
  const carrier = rebindRustCallableCarrier(sourceSelected, parameterCarriers, sourceResult,
    { typeParameters: genericParameters ?? [] });
  return carrier === undefined ? undefined : {
    carrier,
    inference,
    sourceCarrier: sourceSelected,
    protocol: { ...sourceProtocol, result: sourceResult },
  };
}

export function resolveFunctionExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  options?: {
    readonly leadingParameters?: readonly {
      readonly kind: "this" | "receiver";
      readonly carrier: TargetTypeRef;
    }[];
    readonly preserveSourceParameterForms?: boolean;
    readonly selectedMethodDeclaration?: Node;
    readonly sourceCarrier?: TargetTypeRef;
  },
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  if (ast.is.IsArrowFunction(expression) || ast.is.IsFunctionExpression(expression)) {
    const participation = walk.context.records.nativeParticipation.get(expression);
    if (participation === undefined) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Anonymous callable source carrier requires its published native participation.",
        expression);
    }
    if (participation === "erased") return setCarrierFact(walk, expression, rustUnitTargetType());
  }
  const leadingParameters = options?.leadingParameters ?? [];
  const previousThis = walk.currentThisCarrier;
  walk.currentThisCarrier = ast.is.IsArrowFunction(expression)
    ? previousThis : leadingParameters.find(parameter => parameter.kind === "this")?.carrier;
  try {
    const genericParameters = walk.context.sourceLifetimes.contractFor(expression)?.parameters
      .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
    const parameters = sourceCallableValueParameters(ast, expression, walk.context.semanticsFor(expression));
    if (parameters === undefined) return undefined;
    const inferred = expected === undefined || options?.sourceCarrier !== undefined
      ? resolveFunctionExpressionSignature(walk, expression, options?.sourceCarrier) : undefined;
    if (expected === undefined && inferred?.inference.kind === "pending") return undefined;
    const sourceSelected = options?.sourceCarrier ?? inferred?.sourceCarrier;
    const resolvedSourceCallable = inferred?.protocol;
    const selectedExpected = selectRustClosedCallableContext(walk, expression, expected ?? inferred?.carrier);
    if (selectedExpected === undefined || (selectedExpected.kind !== "function-pointer" &&
      rustClosureProtocol(selectedExpected) === undefined &&
      rustGenericCallableProtocol(selectedExpected, genericParameters) === undefined &&
      rustCallableProtocol(selectedExpected) === undefined)) {
      return undefined;
    }
    const selectedGeneric = rustGenericCallableValue(selectedExpected);
    if ((genericParameters?.length ?? 0) > 0 && selectedGeneric === undefined &&
      (selectedExpected.kind !== "closure" || options?.selectedMethodDeclaration === undefined ||
        !ast.is.IsMethodDeclaration(expression) || rustGenericCallableValue(sourceSelected) === undefined)) {
      return undefined;
    }
    const callable = rustGenericCallableProtocol(selectedExpected, genericParameters) ?? rustCallableProtocol(selectedExpected);
    const closure = rustClosureProtocol(selectedExpected);
    const selectedParameters = selectedExpected.kind === "function-pointer"
      ? selectedExpected.args
      : closure?.parameters ?? callable?.parameters;
    const selectedResult = selectedExpected.kind === "function-pointer"
      ? selectedExpected.result
      : closure?.result ?? callable?.result;
    if (selectedParameters === undefined || selectedResult === undefined) {
      return undefined;
    }
    if (selectedParameters.length < leadingParameters.length ||
      !leadingParameters.every((parameter, index) =>
        rustTargetTypeRefEquals(parameter.carrier, selectedParameters[index]))) {
      return undefined;
    }
    const targetParameterCarriers = selectedParameters.slice(leadingParameters.length);
    const authoredBoundCallable = sourceSelected ?? (
      (selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure") &&
        selectedExpected.lifetimeBinder !== undefined
        ? resolveRustTargetTypeRef(
            expression,
            { ...rustResolutionContext(walk, expression), callableRepresentation: "signature" },
            walk.operationOptions,
          )
        : undefined
    );
    const sourceCallableIsAlphaEquivalent = authoredBoundCallable !== undefined &&
      rustTargetTypeRefEquals(authoredBoundCallable, selectedExpected);
    const authoredBoundProtocol = sourceCallableIsAlphaEquivalent
      ? authoredBoundCallable?.kind === "function-pointer"
        ? { parameters: authoredBoundCallable.args, result: authoredBoundCallable.result }
        : rustClosureProtocol(authoredBoundCallable)
      : undefined;
    const lifetimeBinders = sourceCallableIsAlphaEquivalent &&
        (authoredBoundCallable?.kind === "function-pointer" || authoredBoundCallable?.kind === "closure") &&
        (selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure") &&
        authoredBoundCallable.lifetimeBinder !== undefined &&
        selectedExpected.lifetimeBinder !== undefined
      ? {
          authored: authoredBoundCallable.lifetimeBinder,
          selected: selectedExpected.lifetimeBinder,
        }
      : undefined;
    if (parameters.length > targetParameterCarriers.length) {
      return undefined;
    }
    if (resolvedSourceCallable !== undefined &&
      parameters.length !== resolvedSourceCallable.parameters.length) {
      return undefined;
    }
    const parameterAbis: import("../../../target-model/records/callables/callables-and-resources.js").RustSourceParameterAbiFact[] = [];
    const byRefCopyParams: boolean[] = [];
    for (const [index, parameter] of parameters.entries()) {
      if (parameter === undefined) {
        return undefined;
      }
      const targetParameterCarrier = targetParameterCarriers[index];
      const sourceParameterCarrier = sourceCallableIsAlphaEquivalent
        ? authoredBoundProtocol?.parameters[index]
        : resolvedSourceCallable?.parameters[index];
      if (targetParameterCarrier === undefined ||
        (targetParameterCarrier.kind === "opaque" && targetParameterCarrier.id === "tsonic.rust.infer")) {
        return undefined;
      }
      const parameterSelection = resolveRustContextualParameterAbi(
        parameter,
        targetParameterCarrier,
        rustResolutionContext(walk, parameter),
        walk.operationOptions,
        lifetimeBinders,
        selectedExpected.kind === "closure" && selectedExpected.callTrait !== undefined
          ? targetParameterCarrier : undefined,
      );
      if (parameterSelection?.kind === "rejected") {
        refuseRustParameterCarrier(walk, parameter, parameterSelection.reason);
        return undefined;
      }
      const parameterAbi = parameterSelection?.abi;
      if (parameterAbi === undefined ||
        (sourceParameterCarrier !== undefined &&
          !rustTargetTypeRefEquals(parameterAbi.valueCarrier, parameterAbi.form === "default"
            ? rustOptionElementCarrier(sourceParameterCarrier) : sourceParameterCarrier)) ||
        rustCallableInputProtocol(selectedExpected) === undefined && !rustTargetTypeRefEquals(
          parameterAbi.parameterCarrier,
          retainedParameterContract(parameterAbi.parameterCarrier, targetParameterCarrier),
        )) {
        return undefined;
      }
      if (!recordRustParameterAbiSelection(walk, parameter, parameterAbi)) return undefined;
      parameterAbis.push(parameterAbi);
      byRefCopyParams.push(false);
    }
    if (rustCallableInputProtocol(selectedExpected) !== undefined) {
      const physical = rustCallableTargetType([
        ...leadingParameters.map(parameter => parameter.carrier),
        ...parameterAbis.map(abi => abi.parameterCarrier),
        ...targetParameterCarriers.slice(parameters.length),
      ], selectedResult);
      if (!rustTargetTypeRefEquals(physical, rustCallableTargetType(selectedParameters, selectedResult)) &&
        selectRustCallableConversion(physical, selectedExpected,
          (source, target) => selectRustSourceValueConversion(source, target, walk.context.typeDefinitions),
          walk.context.typeDefinitions) === undefined) return undefined;
    }
    const body = ast.body(expression);
    if (body === undefined) {
      return undefined;
    }
    const receiver = leadingParameters.find(parameter => parameter.kind === "this")?.carrier;
    const suspended = ast.hasModifierKind(expression, "async") ||
      walk.context.semanticsFor(expression).operations.generator(expression) !== undefined;
    const inferResult = selectedResult.kind === "opaque" && selectedResult.id === "tsonic.rust.infer";
    const signatureRequest = { parameterAbis, ownedReceiver: receiver?.kind === "reference" ? undefined : receiver,
      contextualResult: selectedResult, ...(!suspended && !inferResult ? { selectedReturn: selectedResult } : {}) };
    const completedSignature = finalizeRustCallableSignature(walk, expression, signatureRequest);
    const generator = walk.context.records.generator.get(expression);
    const asynchronous = walk.context.records.asyncFunction.get(expression);
    if (walk.context.semanticsFor(expression).operations.generator(expression) !== undefined
      ? generator === undefined
      : ast.hasModifierKind(expression, "async") && asynchronous === undefined) {
      return undefined;
    }
    const finalizedReturn = walk.context.records.sourceCallableReturn.get(expression)?.returnCarrier;
    const resultInference = selectedResult.kind === "opaque" && selectedResult.id === "tsonic.rust.infer"
      ? completedSignature.kind === "complete" ? { kind: "complete" as const, carrier: completedSignature.logicalReturn }
      : selectRustInferredReturn(walk, expression, resolveRustTargetTypeRef(Node_Type(ast, expression) ??
          (ast.kindName(body) === KindBlock ? selectedSourceCallableReturn(walk, expression) : undefined),
        rustResolutionContext(walk, expression), walk.operationOptions))
      : { kind: "complete" as const, carrier: selectedResult };
    const selectedResultExpectation = resultInference.kind === "complete" ? resultInference.carrier : undefined;
    const suspendedResult = generator?.resultCarrier ?? asynchronous?.futureCarrier;
    const invocationResult = suspendedResult === undefined || selectedResultExpectation === undefined ||
        rustTargetTypeRefEquals(suspendedResult, selectedResultExpectation)
      ? undefined : finalizeValueConversion(selectRustSourceValueConversion(suspendedResult,
          selectedResultExpectation, walk.context.typeDefinitions), suspendedResult,
          selectedResultExpectation, walk.context.typeDefinitions);
    if (suspendedResult !== undefined && selectedResultExpectation !== undefined &&
        !rustTargetTypeRefEquals(suspendedResult, selectedResultExpectation) && invocationResult === undefined) return undefined;
    const selectedValueResult = suspended ? selectedResultExpectation ?? suspendedResult : finalizedReturn ?? selectedResultExpectation;
    const selectedBodyResult = generator?.returnType ?? asynchronous?.outputCarrier ?? finalizedReturn ?? selectedResultExpectation;
    const resultExpectation = selectedBodyResult ?? finalizedReturn;
    const parameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
    const expressionName = Node_Name(ast, expression);
    if (ast.kindName(expression) === KindFunctionExpression && expressionName !== undefined) {
      if (selectedValueResult === undefined) {
        return undefined;
      }
      // The self binding holds the closure value itself, so it takes the value's retained lifetime, not the expected one.
      const rebound = rebindRustCallableCarrier(selectedExpected, parameterCarriers, selectedValueResult,
        { typeParameters: genericParameters ?? [] });
      const recursiveCarrier = rebound === undefined ? undefined : rustSourceClosureValueCarrier(walk, expression, rebound);
      if (recursiveCarrier === undefined) return undefined;
      setCarrierFact(walk, expression, recursiveCarrier);
      setCarrierFact(walk, expressionName, recursiveCarrier);
    }
    let bodyCarrier = resultExpectation;
    const previousCallable = walk.currentCallableDeclaration;
    const previousGenerator = walk.currentGeneratorDeclaration;
    const previousMethod = walk.currentMethodDeclaration;
    walk.currentCallableDeclaration = expression;
    walk.currentGeneratorDeclaration = generator === undefined ? undefined : expression;
    walk.currentMethodDeclaration = options?.selectedMethodDeclaration;
    try {
      if (!recordCallableDefaultParameterFacts(walk, expression)) return undefined;
      if (ast.kindName(body) === KindBlock) {
        if (bodyCarrier === undefined) {
          return undefined;
        }
        const statements = requireDenseSourceNodes(walk, ast.statements(body), "Callable-expression body contains an undefined or non-data statement slot.");
        if (statements === undefined) {
          return undefined;
        }
        for (const statement of statements) {
          recordStatementFacts(walk, statement, sourceFile, bodyCarrier);
        }
      } else {
        const resolved = resolveExpressionCarrier(walk, body, sourceFile, resultExpectation);
        if (resolved === undefined || resultExpectation !== undefined &&
          !reconcileRequiredCarrier(walk, body, resolved, resultExpectation)) {
          return undefined;
        }
        bodyCarrier = resultExpectation ?? resolved;
      }
    } finally {
      walk.currentCallableDeclaration = previousCallable;
      walk.currentGeneratorDeclaration = previousGenerator;
      walk.currentMethodDeclaration = previousMethod;
    }
    const finalizedParameterCarriers = [
      ...leadingParameters.map((parameter) => parameter.carrier),
      ...parameterCarriers,
      ...targetParameterCarriers.slice(parameters.length),
    ];
    const valueResult = selectedValueResult ?? bodyCarrier;
    if (finalizeRustCallableSignature(walk, expression,
      { ...signatureRequest, selectedReturn: generator?.resultCarrier ??
        (completedSignature.kind === "complete" ? completedSignature.logicalReturn : undefined) ?? selectedResultExpectation }).kind !== "complete") return undefined;
    const captures = collectRustLexicalCaptures(walk, expression, [...parameters.flatMap(parameter => {
      const initializer = parameter === undefined ? undefined : Node_Initializer(ast, parameter);
      return initializer === undefined ? [] : [initializer];
    }), body],
      generator === undefined && asynchronous === undefined && ast.typeParameters(expression).length === 0 &&
      ["KindArrowFunction", "KindFunctionExpression"].includes(ast.kindName(expression)),
      selectedExpected.kind === "closure" ? selectedExpected.callTrait : undefined);
    if (captures === undefined) {
      return undefined;
    }
    const logicalCarrier = rebindRustCallableCarrier(selectedExpected, finalizedParameterCarriers, valueResult,
      selectedGeneric === undefined ? {} : { typeParameters: genericParameters ?? [],
        environment: [...selectedGeneric.environment, ...captures.captures.map(capture => capture.carrier),
          ...captures.receiverFields.map(capture => capture.carrier), ...captures.receivers.map(capture => capture.carrier)],
      });
    const closureCarrier = logicalCarrier === undefined ? undefined : rustSourceClosureValueCarrier(walk, expression, logicalCarrier,
      [...captures.captures, ...captures.receiverFields, ...captures.receivers].map(capture => capture.carrier));
    if (closureCarrier === undefined) return undefined;
    requireRustRecord(walk.context.requiredRecords, "closureCapture", expression, "closure", "analysis/callables/values/closures.ts");
    walk.context.records.closureCaptures.capture(expression, captures.captures, captures.receivers, captures.receiverFields,
      captures, (generator !== undefined || asynchronous !== undefined) &&
          rustFrameCallableValue(closureCarrier) === undefined &&
          rustCallableProtocol(closureCarrier) !== undefined &&
          (captures.captures.length > 0 || captures.receiverFields.length > 0 || captures.receivers.length > 0 || captures.recursiveDeclaration !== undefined)
        ? "shared-state" : undefined);
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "closure", "analysis/callables/values/closures.ts");
    walk.context.records.targetOperations.source(expression, {
      kind: "closure",
      operationId: "tsonic.rust.closure",
      parameterForms: options?.preserveSourceParameterForms === true
        ? "source"
        : "required-only",
      byRefCopyParams,
      ignoredParameterCarriers: targetParameterCarriers.slice(parameters.length),
      ...(invocationResult === undefined ? {} : { invocationResult }),
      ...(leadingParameters.length === 0 ? {} : { leadingParameters }),
      resultCarrier: closureCarrier,
    });
    return setCarrierFact(walk, expression, closureCarrier);
  } finally {
    walk.currentThisCarrier = previousThis;
  }
}

export function collectRustLexicalCaptures(
  walk: RustFactWalk,
  expression: Node,
  roots: readonly Node[],
  permitSingleOwner = false,
  nativeCallTrait?: "Fn" | "FnMut" | "FnOnce",
): import("../../../target-model/records/operations/operation-selections.js").RustClosureCaptureFact | undefined {
  const { ast } = walk.context;
  const captures = new Map<Node, {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location" | "cell" | "borrow-cell";
    readonly mutable?: true;
  }>();
  let recursiveDeclaration: Node | undefined;
  let recursiveField: import("../../../target-model/records/operations/operation-selections.js").RustClosureCaptureFact["recursiveField"];
  const valueDeclaration = rustCallableExpressionValueDeclaration(expression, ast);
  const selected = sourceLexicalEnvironment(expression, roots, ast, walk.context.source.navigation, "source",
    (use, declaration) => walk.context.records.compileTimeSource.get(use.reference) !== true &&
      walk.context.runtimeValueUses.isRuntimeReference(declaration, use.reference));
  if (selected.kind === "unresolved") return undefined;
  const receiverFields: import("../../../target-model/records/operations/operation-selections.js").RustClosureCaptureFact["receiverFields"][number][] = [];
  const fieldCaptures = walk.context.objectRepresentations.receiverCaptures.capturesFor(expression);
  const fixedField = walk.context.objectRepresentations.receiverCaptures.fixedSelfFor(expression);
  if (fixedField !== undefined) {
    const carrier = walk.context.records.runtimeCarrier.get(fixedField.reference)?.carrier;
    if (carrier === undefined || !fixedField.references.every(reference => rustTargetTypeRefEquals(
      walk.context.records.runtimeCarrier.get(reference)?.carrier, carrier))) return undefined;
    recursiveDeclaration = fixedField.declaration;
    recursiveField = { ...fixedField, carrier };
  }
  for (const capture of fieldCaptures) {
    const storage = walk.context.records.capturedFieldStorage.get(capture.declaration);
    const carrier = walk.context.records.runtimeCarrier.get(capture.reference)?.carrier;
    if (storage === undefined || carrier === undefined) return undefined;
    receiverFields.push({ ...capture, storage: storage.storage, carrier });
  }
  const receivers: import("../../../target-model/records/operations/operation-selections.js").RustClosureCaptureFact["receivers"][number][] = [];
  for (const receiver of walk.context.objectRepresentations.receiverCaptures.receiversFor(expression)) {
    const carrier = walk.context.records.runtimeCarrier.get(receiver.reference)?.carrier;
    const definition = carrier === undefined ? undefined : walk.context.projectTypes.definitionForCarrier(carrier);
    const representation = walk.context.objectRepresentations.representationFor(definition);
    if (carrier === undefined || representation === undefined || representation.kind === "value" ||
      !receiver.references.every(reference => rustTargetTypeRefEquals(
        walk.context.records.runtimeCarrier.get(reference)?.carrier, carrier))) {
      appendRustDiagnostic(walk, "RUST_RECEIVER_CAPTURE_NOT_CLOSED",
        "A whole native receiver capture requires its exact retained native owner and selected carrier.", expression,
        ["target.capability=rust.callable.receiver-owner"]);
      return undefined;
    }
    receivers.push({ ...receiver, carrier });
  }
  if (selected.selfReferences.length > 0 && ast.kindName(expression) !== "KindClassDeclaration" &&
    ast.kindName(expression) !== "KindClassExpression") recursiveDeclaration = expression;
  for (const capture of selected.captures) {
    const declaration = capture.declaration;
    if (walk.context.records.compileTimeSource.get(declaration) === true) continue;
    if (declaration === valueDeclaration &&
      !walk.context.source.navigation.declarationUseSummary(declaration).bindingWritten) {
      recursiveDeclaration = declaration;
      continue;
    }
    const kind = ast.kindName(declaration);
    if (kind !== KindParameter && kind !== KindVariableDeclaration && kind !== KindBindingElement &&
      kind !== "KindFunctionDeclaration" && kind !== KindFunctionExpression) continue;
    const reference = capture.references[capture.references.length - 1];
    if (reference === undefined) return undefined;
    const carrier = walk.context.records.runtimeCarrier.get(reference)?.carrier ??
      walk.context.records.runtimeCarrier.get(declaration)?.carrier;
    const selectedStorage = rustCapturedBindingStorage(walk, declaration, reference, expression, carrier, permitSingleOwner,
      nativeCallTrait, selected.callableRoots);
    if (carrier === undefined || selectedStorage === undefined) return undefined;
    captures.set(declaration, { declaration, reference, carrier, storage: selectedStorage.storage,
      ...(selectedStorage.mutable === undefined ? {} : { mutable: selectedStorage.mutable }) });
  }
  return { receivers, receiverFields, captures: [...captures.values()],
    ...(recursiveDeclaration === undefined ? {} : { recursiveDeclaration }),
    ...(recursiveField === undefined ? {} : { recursiveField }) };
}

// A callable parameter this closure retains (a returned closure captures it) is closed with the closure's retained
// environment lifetime; the contract it implements leaves that environment open.
function retainedParameterContract(selected: TargetTypeRef, contract: TargetTypeRef): TargetTypeRef {
  const lifetime = rustCallableProtocol(rustOptionElementCarrier(selected) ?? selected)?.lifetime;
  return lifetime?.kind === "parameter" && lifetime.identity.startsWith("retained-environment\0")
    ? closeRustRetainedCallableCarrier(contract, lifetime) : contract;
}
