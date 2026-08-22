import {
  KindBlock,
  KindExportAssignment,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindIdentifier,
  KindArrayBindingPattern,
  KindBindingElement,
  KindNonNullExpression,
  KindObjectBindingPattern,
  KindParameter,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  KindVariableDeclaration,
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  rustClosureCaptureFactKey,
  rustLocationStorageFactKey,
  rustMutatedBindingFactKey,
  rustSourceBindingFactKey,
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
    : rustClosureProtocol(sourceSelected) ?? rustCallableProtocol(sourceSelected);
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
    : rustCallableTargetType(fallbackParameterCarriers, resolvedSourceCallable.result));
  if (selectedExpected === undefined || (selectedExpected.kind !== "function-pointer" &&
    rustClosureProtocol(selectedExpected) === undefined &&
    rustCallableProtocol(selectedExpected) === undefined)) {
    return undefined;
  }
  if (ast.hasModifierKind(expression, "async") ||
    walk.context.semanticsFor(expression).operations.generator(expression) !== undefined) {
    return undefined;
  }
  const callable = rustCallableProtocol(selectedExpected);
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
    const sourceParameterCarrier = resolvedSourceCallable?.parameters[index];
    const targetParameterCarrier = targetParameterCarriers[index];
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
  const finalizedReturn = walk.context.facts.get(expression, rustSourceCallableReturnFactKey)?.returnCarrier ??
    walk.context.facts.resolve(expression, rustSourceCallableReturnFactKey)?.returnCarrier;
  const selectedResultExpectation = selectedResult.kind === "opaque" && selectedResult.id === "tsonic.rust.infer"
    ? resolveTypeNodeCarrier(walk, Node_Type(ast, expression))
    : selectedResult;
  if (finalizedReturn !== undefined && selectedResultExpectation !== undefined &&
    !rustTargetTypeRefEquals(finalizedReturn, selectedResultExpectation)) {
    return undefined;
  }
  const resultExpectation = finalizedReturn ?? selectedResultExpectation;
  const parameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
  const expressionName = Node_Name(ast, expression);
  if (ast.kindName(expression) === KindFunctionExpression && expressionName !== undefined) {
    if (resultExpectation === undefined) {
      return undefined;
    }
    const recursiveCarrier: TargetTypeRef = selectedExpected.kind === "function-pointer" ||
        selectedExpected.kind === "closure"
      ? { ...selectedExpected, args: parameterCarriers, result: resultExpectation }
      : rustCallableTargetType(parameterCarriers, resultExpectation);
    setCarrierFact(walk, expression, recursiveCarrier);
    setCarrierFact(walk, expressionName, recursiveCarrier);
  }
  let bodyCarrier = resultExpectation;
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  const previousMethod = walk.currentMethodDeclaration;
  const previousThis = walk.currentThisCarrier;
  walk.currentCallableDeclaration = expression;
  walk.currentGeneratorDeclaration = undefined;
  walk.currentMethodDeclaration = options?.selectedMethodDeclaration;
  walk.currentThisCarrier = leadingParameters.find((parameter) => parameter.kind === "this")?.carrier;
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
  const closureCarrier: TargetTypeRef = selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure"
    ? { ...selectedExpected, args: finalizedParameterCarriers, result: bodyCarrier }
    : rustCallableTargetType(finalizedParameterCarriers, bodyCarrier);
  const captures = collectRustClosureCaptures(walk, expression, body);
  if (captures === undefined) {
    return undefined;
  }
  walk.context.facts.set(expression, rustClosureCaptureFactKey, captures, [
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

function collectRustClosureCaptures(
  walk: RustFactWalk,
  expression: Node,
  body: Node,
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
  let valid = true;
  const visit = (node: Node): void => {
    if (!valid) {
      return;
    }
    if (ast.kindName(node) === KindIdentifier) {
      const binding = walk.context.facts.get(node, rustSourceBindingFactKey) ??
        walk.context.facts.resolve(node, rustSourceBindingFactKey);
      const declaration = binding?.sourceDeclaration;
      if (declaration === expression || declaration === valueDeclaration) {
        recursiveDeclaration = declaration;
      } else if (declaration !== undefined && !nodeIsWithin(declaration, expression, ast) &&
        !declarationIsModuleScoped(declaration, ast)) {
        const declarationKind = ast.kindName(declaration);
        if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration ||
          declarationKind === KindBindingElement) {
          const carrier = walk.context.facts.get(node, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.resolve(node, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
          if (carrier === undefined) {
            valid = false;
            return;
          }
          const storage = rustCapturedBindingStorage(walk, declaration, node);
          if (storage === undefined) {
            valid = false;
            return;
          }
          if (storage === "location") {
            walk.context.facts.set(declaration, rustLocationStorageFactKey, {
              valueCarrier: carrier,
            }, [{ message: "rust captured mutable binding storage" }]);
          }
          captures.set(declaration, {
            declaration,
            reference: node,
            carrier,
            storage,
          });
        }
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(body);
  return valid
    ? {
        captures: [...captures.values()],
        ...(recursiveDeclaration === undefined ? {} : { recursiveDeclaration }),
      }
    : undefined;
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
  if (selected?.declaration !== declaration || sourceFile === undefined) {
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

function nodeIsWithin(node: Node, ancestor: Node, ast: RustFactWalk["context"]["ast"]): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === ancestor) {
      return true;
    }
    current = ast.parent(current);
  }
  return false;
}

export function declarationIsModuleScoped(
  declaration: Node,
  ast: RustFactWalk["context"]["ast"],
): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    const parent = ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    const parentKind = ast.kindName(parent);
    if (parentKind === KindFunctionDeclaration || parentKind === KindFunctionExpression ||
      parentKind === "KindArrowFunction" || parentKind === "KindMethodDeclaration" ||
      parentKind === "KindConstructor") {
      return false;
    }
    if (parentKind === "KindSourceFile") {
      if (current === declaration) {
        const declarationKind = ast.kindName(declaration);
        return declarationKind === KindFunctionDeclaration ||
          declarationKind === "KindClassDeclaration" ||
          declarationKind === "KindEnumDeclaration" ||
          declarationKind === KindExportAssignment;
      }
      const declarationKind = ast.kindName(declaration);
      return ast.kindName(current) === KindVariableStatement &&
        (declarationKind === KindVariableDeclaration || declarationKind === KindBindingElement);
    }
    current = parent;
  }
  return false;
}
