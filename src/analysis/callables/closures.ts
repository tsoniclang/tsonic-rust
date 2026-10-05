import { rustTypeParameterFromSourceContract } from "../../target-model/names/type-parameters.js";
import { rustCapturedFieldStorageFactKey } from "../facts/receiver-captures.js";
import { appendRustDiagnostic } from "../program/walk.js";
import {
  KindBlock,
  KindFunctionExpression,
  KindArrayBindingPattern,
  KindBindingElement,
  KindNonNullExpression,
  KindObjectBindingPattern,
  KindParameter,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  sourceLexicalEnvironment,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustClosureCaptureFactKey,
  rustGeneratorFactKey,
  rustBindingStorageFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import {
  rustSourceOptionalTargetType,
  rustOptionElementCarrier,
  rustCallableProtocol,
  rustClosureProtocol,
  rustCallableTargetType,
} from "../../target-model/types/index.js";
import { recordBindingPatternFacts, recordDefaultParameterInitializerFacts, setParameterAbiFact } from "../declarations/types-and-bindings.js";
import { recordStatementFacts } from "../control-flow/statements.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { reconcileRequiredCarrier, resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveRustContextualParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustResolutionContext } from "../program/walk.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustGenericCallableProtocol, rustGenericCallableTargetType, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { recordCallableReturnFact, recordCallableSuspensionFacts, selectedSourceCallableReturn } from "./signatures.js";
import { rustCapturedBindingStorage } from "./capture-storage.js";
import { selectRustInferredReturn } from "./inferred-return.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { finalizeValueConversion } from "../facts/finalized-operation/conversions.js";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";
import { rustCallableInvocationResult } from "../facts/callable-results.js";

export function resolveFunctionExpressionSignature(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier?: TargetTypeRef,
) {
  const { ast } = walk.context;
  const genericParameters = walk.context.sourceLifetimes.contractFor(expression)?.parameters
    .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const parameters = ast.parameters(expression);
  const sourceSelected = sourceCarrier ?? resolveRustTargetTypeRef(
    expression, rustResolutionContext(walk, expression), walk.operationOptions,
  );
  const sourceProtocol = sourceSelected?.kind === "function-pointer"
    ? { parameters: sourceSelected.args, result: sourceSelected.result }
    : rustGenericCallableProtocol(sourceSelected, genericParameters) ?? rustClosureProtocol(sourceSelected) ?? rustCallableProtocol(sourceSelected);
  const sourceResult = sourceProtocol === undefined ? undefined
    : rustCallableInvocationResult(walk.context.facts, expression) ??
      (ast.hasModifierKind(expression, "async") ? sourceProtocol.result
        : selectRustInferredReturn(walk, expression, sourceProtocol.result));
  if (sourceSelected === undefined || sourceProtocol === undefined || sourceResult === undefined) return undefined;
  const parameterCarriers = sourceProtocol.parameters.map((carrier, index) =>
    Node_Initializer(ast, parameters[index]) === undefined ? carrier : rustSourceOptionalTargetType(carrier));
  const carrier = sourceSelected.kind === "function-pointer" || sourceSelected.kind === "closure"
    ? { ...sourceSelected, args: parameterCarriers, result: sourceResult }
    : rustGenericCallableValue(sourceSelected) !== undefined
      ? rustGenericCallableTargetType(genericParameters ?? [], parameterCarriers, sourceResult,
        rustGenericCallableValue(sourceSelected)!.origin, rustGenericCallableValue(sourceSelected)!.environment)
      : rustCallableTargetType(parameterCarriers, sourceResult);
  return carrier === undefined ? undefined : {
    carrier,
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
  const genericParameters = walk.context.sourceLifetimes.contractFor(expression)?.parameters
    .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const parameters = ast.parameters(expression);
  const inferred = expected === undefined || options?.sourceCarrier !== undefined
    ? resolveFunctionExpressionSignature(walk, expression, options?.sourceCarrier) : undefined;
  const sourceSelected = options?.sourceCarrier ?? inferred?.sourceCarrier;
  const resolvedSourceCallable = inferred?.protocol;
  const selectedExpected = expected ?? inferred?.carrier;
  if (selectedExpected === undefined || (selectedExpected.kind !== "function-pointer" &&
    rustClosureProtocol(selectedExpected) === undefined &&
    rustGenericCallableProtocol(selectedExpected, genericParameters) === undefined &&
    rustCallableProtocol(selectedExpected) === undefined)) {
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
  const leadingParameters = options?.leadingParameters ?? [];
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
          rustResolutionContext(walk, expression),
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
  const parameterAbis: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi[] = [];
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
    const finalizedAbi = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
      walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey);
    const parameterAbi = finalizedAbi ?? resolveRustContextualParameterAbi(
      parameter,
      targetParameterCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
      lifetimeBinders,
      selectedExpected.kind === "closure" && selectedExpected.callTrait !== undefined
        ? targetParameterCarrier : undefined,
    );
    if (parameterAbi === undefined ||
      (sourceParameterCarrier !== undefined &&
        !rustTargetTypeRefEquals(parameterAbi.valueCarrier, parameterAbi.form === "default"
          ? rustOptionElementCarrier(sourceParameterCarrier) : sourceParameterCarrier)) ||
      !rustTargetTypeRefEquals(
        parameterAbi.parameterCarrier,
        targetParameterCarrier,
      )) {
      return undefined;
    }
    if (finalizedAbi === undefined) {
      setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
      setParameterAbiFact(walk, parameter, parameterAbi);
      if (!recordDefaultParameterInitializerFacts(walk, parameter, parameterAbi)) {
        return undefined;
      }
      const name = Node_Name(ast, parameter);
      const nameKind = name === undefined ? "" : ast.kindName(name);
      if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
        !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
        return undefined;
      }
    }
    parameterAbis.push(parameterAbi);
    byRefCopyParams.push(false);
  }
  const body = ast.body(expression);
  if (body === undefined) {
    return undefined;
  }
  const receiver = leadingParameters.find(parameter => parameter.kind === "this")?.carrier;
  recordCallableSuspensionFacts(walk, expression, receiver?.kind === "reference" ? undefined : receiver);
  const generator = walk.context.facts.get(expression, rustGeneratorFactKey);
  const asynchronous = walk.context.facts.get(expression, rustAsyncFunctionFactKey);
  if (walk.context.semanticsFor(expression).operations.generator(expression) !== undefined
    ? generator === undefined
    : ast.hasModifierKind(expression, "async") && asynchronous === undefined) {
    return undefined;
  }
  const finalizedReturn = walk.context.facts.get(expression, rustSourceCallableReturnFactKey)?.returnCarrier ??
    walk.context.facts.resolve(expression, rustSourceCallableReturnFactKey)?.returnCarrier;
  const selectedResultExpectation = selectedResult.kind === "opaque" && selectedResult.id === "tsonic.rust.infer"
    ? selectRustInferredReturn(walk, expression, resolveRustTargetTypeRef(Node_Type(ast, expression) ??
        (ast.kindName(body) === KindBlock ? selectedSourceCallableReturn(walk, expression) : undefined),
      rustResolutionContext(walk, expression), walk.operationOptions))
    : selectedResult;
  const suspendedResult = generator?.resultCarrier ?? asynchronous?.futureCarrier;
  const invocationResult = suspendedResult === undefined || selectedResultExpectation === undefined ||
      rustTargetTypeRefEquals(suspendedResult, selectedResultExpectation)
    ? undefined : finalizeValueConversion(selectRustSourceValueConversion(suspendedResult,
        selectedResultExpectation, walk.context.typeDefinitions), suspendedResult,
        selectedResultExpectation, walk.context.typeDefinitions);
  if (suspendedResult !== undefined && selectedResultExpectation !== undefined &&
      !rustTargetTypeRefEquals(suspendedResult, selectedResultExpectation) && invocationResult === undefined) return undefined;
  const selectedValueResult = selectedResultExpectation ?? suspendedResult;
  const selectedBodyResult = generator?.returnType ?? asynchronous?.outputCarrier ?? selectedResultExpectation;
  const selectedReturnFact = generator?.resultCarrier ?? selectedBodyResult;
  if (finalizedReturn !== undefined && selectedReturnFact !== undefined &&
    !rustTargetTypeRefEquals(finalizedReturn, selectedReturnFact)) {
    return undefined;
  }
  const resultExpectation = selectedBodyResult ?? finalizedReturn;
  const parameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
  const expressionName = Node_Name(ast, expression);
  if (ast.kindName(expression) === KindFunctionExpression && expressionName !== undefined) {
    if (selectedValueResult === undefined) {
      return undefined;
    }
    const recursiveCarrier: TargetTypeRef = selectedExpected.kind === "function-pointer" ||
        selectedExpected.kind === "closure"
      ? { ...selectedExpected, args: parameterCarriers, result: selectedValueResult }
      : rustCallableTargetType(parameterCarriers, selectedValueResult);
    setCarrierFact(walk, expression, recursiveCarrier);
    setCarrierFact(walk, expressionName, recursiveCarrier);
  }
  let bodyCarrier = resultExpectation;
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  const previousMethod = walk.currentMethodDeclaration;
  const previousThis = walk.currentThisCarrier;
  walk.currentCallableDeclaration = expression;
  walk.currentGeneratorDeclaration = generator === undefined ? undefined : expression;
  walk.currentMethodDeclaration = options?.selectedMethodDeclaration;
  walk.currentThisCarrier = walk.context.ast.kindName(expression) === "KindArrowFunction"
    ? previousThis
    : leadingParameters.find((parameter) => parameter.kind === "this")?.carrier;
  try {
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
    walk.currentThisCarrier = previousThis;
  }
  const finalizedParameterCarriers = [
    ...leadingParameters.map((parameter) => parameter.carrier),
    ...parameterCarriers,
    ...targetParameterCarriers.slice(parameters.length),
  ];
  const valueResult = selectedValueResult ?? bodyCarrier;
  if (!recordCallableReturnFact(walk, expression, generator?.resultCarrier ?? bodyCarrier)) return undefined;
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
  const selectedGeneric = rustGenericCallableValue(selectedExpected);
  const closureCarrier = selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure"
    ? { ...selectedExpected, args: finalizedParameterCarriers, result: valueResult }
    : selectedGeneric !== undefined
      ? rustGenericCallableTargetType(genericParameters ?? [], finalizedParameterCarriers, valueResult, selectedGeneric.origin,
        [...selectedGeneric.environment, ...captures.captures.map(capture => capture.carrier),
          ...captures.receiverFields.map(capture => capture.carrier), ...captures.receivers.map(capture => capture.carrier)])
    : rustCallableTargetType(finalizedParameterCarriers, valueResult);
  if (closureCarrier === undefined) return undefined;
  walk.context.facts.set(expression, rustClosureCaptureFactKey, {
    ...captures,
    ...((generator !== undefined || asynchronous !== undefined) &&
        rustCallableProtocol(closureCarrier) !== undefined &&
        (captures.captures.length > 0 || captures.receiverFields.length > 0 || captures.receivers.length > 0 || captures.recursiveDeclaration !== undefined)
      ? { invocationOwner: "shared-state" as const } : {}),
  }, [
    { message: "rust exact callable-expression captures" },
  ]);
  setRustOperationFact(walk, expression, {
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
}

export function collectRustLexicalCaptures(
  walk: RustFactWalk,
  expression: Node,
  roots: readonly Node[],
  permitSingleOwner = false,
  nativeCallTrait?: "Fn" | "FnMut" | "FnOnce",
): import("../facts/keys.js").RustClosureCaptureFact | undefined {
  const { ast } = walk.context;
  const captures = new Map<Node, {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location" | "cell" | "borrow-cell";
    readonly mutable?: true;
  }>();
  let recursiveDeclaration: Node | undefined;
  const valueDeclaration = callableExpressionValueDeclaration(expression, ast);
  const selected = sourceLexicalEnvironment(expression, roots, ast, walk.context.source.navigation,
    (use, declaration) => walk.context.facts.get(use.reference, rustCompileTimeSourceKey) !== true &&
      walk.context.runtimeValueUses.isRuntimeReference(declaration, use.reference));
  if (selected.kind === "unresolved") return undefined;
  const receiverFields: import("../facts/keys.js").RustClosureCaptureFact["receiverFields"][number][] = [];
  const fieldCaptures = walk.context.objectRepresentations.receiverCaptures.capturesFor(expression);
  for (const capture of fieldCaptures) {
    const storage = walk.context.facts.get(capture.declaration, rustCapturedFieldStorageFactKey);
    const carrier = walk.context.facts.get(capture.reference, rustRuntimeCarrierKey)?.carrier;
    if (storage === undefined || carrier === undefined) return undefined;
    receiverFields.push({ ...capture, storage: storage.storage, carrier });
  }
  const receivers: import("../facts/keys.js").RustClosureCaptureFact["receivers"][number][] = [];
  for (const receiver of walk.context.objectRepresentations.receiverCaptures.receiversFor(expression)) {
    const carrier = walk.context.facts.get(receiver.reference, rustRuntimeCarrierKey)?.carrier;
    const definition = carrier === undefined ? undefined : walk.context.projectTypes.definitionForCarrier(carrier);
    const representation = walk.context.objectRepresentations.representationFor(definition);
    if (carrier === undefined || representation === undefined || representation.kind === "value" ||
      !receiver.references.every(reference => rustTargetTypeRefEquals(
        walk.context.facts.get(reference, rustRuntimeCarrierKey)?.carrier, carrier))) {
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
    if (walk.context.facts.get(declaration, rustCompileTimeSourceKey) === true) continue;
    if (declaration === valueDeclaration &&
      !walk.context.source.navigation.declarationUseSummary(declaration).bindingWritten) {
      recursiveDeclaration = declaration;
      continue;
    }
    const kind = ast.kindName(declaration);
    if (kind !== KindParameter && kind !== KindVariableDeclaration && kind !== KindBindingElement &&
      kind !== "KindFunctionDeclaration") continue;
    const reference = capture.references[capture.references.length - 1];
    if (reference === undefined) return undefined;
    const carrier = walk.context.facts.get(reference, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.resolve(reference, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
    const selectedStorage = rustCapturedBindingStorage(walk, declaration, reference, expression, carrier, permitSingleOwner,
      nativeCallTrait, selected.callableRoots);
    if (carrier === undefined || selectedStorage === undefined) return undefined;
    if (selectedStorage.storage !== "value") walk.context.facts.set(declaration, rustBindingStorageFactKey, {
      storage: selectedStorage.storage,
      valueCarrier: carrier,
      ...(selectedStorage.initialization === undefined ? {} : { initialization: selectedStorage.initialization }),
    }, [{ message: "rust captured mutable binding storage" }]);
    captures.set(declaration, { declaration, reference, carrier, ...selectedStorage });
  }
  return { receivers, receiverFields, captures: [...captures.values()], ...(recursiveDeclaration === undefined ? {} : { recursiveDeclaration }) };
}

function callableExpressionValueDeclaration(
  expression: Node,
  ast: RustFactWalk["context"]["ast"],
): Node | undefined {
  let current = expression;
  let parent = ast.parent(current);
  while (parent !== undefined) {
    const kind = ast.kindName(parent);
    if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
      kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      break;
    }
    if (Node_Expression(ast, parent) !== current) {
      return undefined;
    }
    current = parent;
    parent = ast.parent(current);
  }
  return parent !== undefined && ast.kindName(parent) === KindVariableDeclaration &&
      Node_Initializer(ast, parent) === current
    ? parent
    : undefined;
}

// --- RegExp constant lane ----------------------------------------------------

// Compile-time mirror of the runtime RegExp parser contract: a faithful
// TypeScript port of `rust-js/crates/tsonic_rust_js/src/regexp/parser.rs`
// (`parse_flags` + `parse_pattern`). The returned violation string is the
// engine's exact construction-time error message, and the acceptance
// decision is held equal to the engine by the shared corpus at
// `rust-js/tests/oracle/regexp-acceptance-corpus.json`.

// Mirrors `MAX_QUANTIFIER_BOUND` in parser.rs.
