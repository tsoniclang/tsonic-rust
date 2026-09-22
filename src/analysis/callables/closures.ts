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
  sourceLexicalCaptures,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustClosureCaptureFactKey,
  rustGeneratorFactKey,
  rustLocationStorageFactKey,
  rustMutatedBindingFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import {
  rustOptionTargetType,
  rustCallableProtocol,
  rustClosureProtocol,
  rustCallableTargetType,
} from "../../target-model/types/index.js";
import { recordBindingPatternFacts, recordDefaultParameterInitializerFacts, setParameterAbiFact } from "../declarations/types-and-bindings.js";
import { recordStatementFacts, resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
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
import { recordCallableReturnFact, recordCallableSuspensionFacts } from "./signatures.js";

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
  const genericNames = walk.context.sourceLifetimes.contractFor(expression)?.parameters
    .flatMap(parameter => parameter.kind === "type" ? [parameter.targetName] : []);
  const parameters = ast.parameters(expression);
  const sourceSelected = options?.sourceCarrier ?? (expected === undefined
    ? resolveRustTargetTypeRef(
        expression,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      )
    : undefined);
  const resolvedSourceCallable = sourceSelected?.kind === "function-pointer"
    ? { parameters: sourceSelected.args, result: sourceSelected.result }
    : rustGenericCallableProtocol(sourceSelected, genericNames) ?? rustClosureProtocol(sourceSelected) ?? rustCallableProtocol(sourceSelected);
  const fallbackParameterCarriers = resolvedSourceCallable?.parameters.map((carrier, index) =>
    Node_Initializer(ast, parameters[index]) === undefined
      ? carrier
      : rustOptionTargetType(carrier));
  const selectedExpected = expected ?? (sourceSelected === undefined ||
      resolvedSourceCallable === undefined || fallbackParameterCarriers === undefined
    ? undefined
    : sourceSelected.kind === "function-pointer" || sourceSelected.kind === "closure"
    ? {
        ...sourceSelected,
        args: fallbackParameterCarriers,
        result: resolvedSourceCallable.result,
      }
    : rustGenericCallableValue(sourceSelected) !== undefined && genericNames !== undefined
      ? rustGenericCallableTargetType(genericNames, fallbackParameterCarriers, resolvedSourceCallable.result)
      : rustCallableTargetType(fallbackParameterCarriers, resolvedSourceCallable.result));
  if (selectedExpected === undefined || (selectedExpected.kind !== "function-pointer" &&
    rustClosureProtocol(selectedExpected) === undefined &&
    rustGenericCallableProtocol(selectedExpected, genericNames) === undefined &&
    rustCallableProtocol(selectedExpected) === undefined)) {
    return undefined;
  }
  const callable = rustGenericCallableProtocol(selectedExpected, genericNames) ?? rustCallableProtocol(selectedExpected);
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
  if (parameters.length !== targetParameterCarriers.length) {
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
    );
    if (parameterAbi === undefined ||
      (sourceParameterCarrier !== undefined &&
        !rustTargetTypeRefEquals(parameterAbi.valueCarrier, sourceParameterCarrier)) ||
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
  recordCallableSuspensionFacts(walk, expression);
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
    ? resolveTypeNodeCarrier(walk, Node_Type(ast, expression))
    : selectedResult;
  const selectedValueResult = generator?.resultCarrier ?? asynchronous?.futureCarrier ?? selectedResultExpectation;
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
      bodyCarrier = resolveExpressionCarrier(walk, body, sourceFile, resultExpectation);
      if (bodyCarrier === undefined) {
        return undefined;
      }
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
  ];
  const valueResult = generator?.resultCarrier ?? asynchronous?.futureCarrier ?? bodyCarrier;
  const closureCarrier = selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure"
    ? { ...selectedExpected, args: finalizedParameterCarriers, result: valueResult }
    : rustGenericCallableValue(selectedExpected) !== undefined && genericNames !== undefined
      ? rustGenericCallableTargetType(genericNames, finalizedParameterCarriers, valueResult)
    : rustCallableTargetType(finalizedParameterCarriers, valueResult);
  if (closureCarrier === undefined ||
    !recordCallableReturnFact(walk, expression, generator?.resultCarrier ?? bodyCarrier)) return undefined;
  const captures = collectRustLexicalCaptures(walk, expression, [body]);
  if (captures === undefined) {
    return undefined;
  }
  walk.context.facts.set(expression, rustClosureCaptureFactKey, {
    ...captures,
    ...((generator !== undefined || asynchronous !== undefined) &&
        rustCallableProtocol(closureCarrier) !== undefined &&
        (captures.captures.length > 0 || captures.recursiveDeclaration !== undefined)
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
    ...(leadingParameters.length === 0 ? {} : { leadingParameters }),
    resultCarrier: closureCarrier,
  });
  return setCarrierFact(walk, expression, closureCarrier);
}

export function collectRustLexicalCaptures(
  walk: RustFactWalk,
  expression: Node,
  roots: readonly Node[],
): import("../facts/keys.js").RustClosureCaptureFact | undefined {
  const { ast } = walk.context;
  const captures = new Map<Node, {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location";
  }>();
  let recursiveDeclaration: Node | undefined;
  const valueDeclaration = callableExpressionValueDeclaration(expression, ast);
  const selected = sourceLexicalCaptures(expression, roots, ast, walk.context.source.navigation);
  if (selected.selfReferences.length > 0 && ast.kindName(expression) !== "KindClassDeclaration" &&
    ast.kindName(expression) !== "KindClassExpression") recursiveDeclaration = expression;
  for (const capture of selected.captures) {
    const declaration = capture.declaration;
    if (declaration === valueDeclaration) { recursiveDeclaration = declaration; continue; }
    const kind = ast.kindName(declaration);
    if (kind !== KindParameter && kind !== KindVariableDeclaration && kind !== KindBindingElement) continue;
    const reference = capture.references[capture.references.length - 1];
    if (reference === undefined) return undefined;
    const carrier = walk.context.facts.get(reference, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.resolve(reference, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
    const storage = rustCapturedBindingStorage(walk, declaration, reference);
    if (carrier === undefined || storage === undefined) return undefined;
    if (storage === "location") walk.context.facts.set(declaration, rustLocationStorageFactKey, {
      valueCarrier: carrier,
    }, [{ message: "rust captured mutable binding storage" }]);
    captures.set(declaration, { declaration, reference, carrier, storage });
  }
  return { captures: [...captures.values()], ...(recursiveDeclaration === undefined ? {} : { recursiveDeclaration }) };
}

function rustCapturedBindingStorage(
  walk: RustFactWalk,
  declaration: Node,
  reference: Node,
): "value" | "location" | undefined {
  const cached = walk.capturedBindingStorage.get(declaration);
  if (cached !== undefined) {
    return cached;
  }
  const selected = walk.context.source.navigation.sourceReferenceFor(reference);
  const sourceFile = walk.context.ast.getSourceFile(declaration);
  if (
    selected?.declaration !== declaration ||
    selected.symbol === undefined ||
    sourceFile === undefined
  ) {
    return undefined;
  }
  const mutated = walk.context.facts.get(declaration, rustMutatedBindingFactKey) !== undefined ||
    walk.context.source.navigation.bindingWritesWithin(selected.symbol, sourceFile).length > 0;
  const storage = mutated ? "location" : "value";
  walk.capturedBindingStorage.set(declaration, storage);
  return storage;
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
