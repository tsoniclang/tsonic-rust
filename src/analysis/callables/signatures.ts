import { requireRustRecord } from "../program/records/required-records.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/types/carriers/generic-references.js";
import { rustCallableInvocationResult } from "../../policy/types/callables/return-contexts.js";
import { rustUnionPayloadAdmission } from "../../policy/conversions/union-injection.js";
import { rustAbsenceTargetType } from "../../target-model/types/carriers/native.js";
import { KindFunctionExpression, KindFunctionDeclaration, KindNonNullExpression, KindParenthesizedExpression, KindSatisfiesExpression, KindVariableDeclaration, KindVariableStatement, Node_Expression, Node_Initializer, Node_Type, VariableDeclarationList_Declarations, VariableStatement_DeclarationList, sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";

import { isRustUnitCarrier, isRustNeverCarrier, rustOptionElementCarrier, rustSourceOptionalTargetType, rustCallableProtocol, rustClosureProtocol } from "../../target-model/types/index.js";
import { rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordRustParameterAbiSelection } from "./parameter-facts.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";
import { resolveRustContextualParameterAbi } from "./source-callable-abi.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";

import { setCarrierFact } from "../operations/project-calls.js";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceCallableReturnFact } from "../../target-model/records/source-declarations.js";
import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";
import { rustSourceFunctionValueCarrier, rustSourceClosureValueCarrier } from "./function-values.js";
import { selectRustPointerReturnContract } from "./pointer-return.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableValueOwner } from "../../policy/types/callables/callable-origins.js";
import { rebindRustCallableCarrier } from "../../policy/types/callables/method-values.js";
import { resolveRustRetainedResult } from "../source-evidence/types/resolution/retained-results.js";

import { selectRustInferredReturn, selectRustRetainedReturn } from "./inferred-return.js";
import type { RustInferredReturnSelection } from "./inferred-return.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { selectRustClosedCallableContext } from "../expected-types/callable-contexts.js";
import { finalizeRustCallableSignature } from "./signature-query.js";

export function recordNestedCallableTypeSignatureFacts(walk: RustFactWalk, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const visit = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    if (!walk.context.isNativeNode(node)) return;
    if (walk.context.records.compileTimeSource.get(node)) return;
    const kind = ast.kindName(node);
    if (kind === "KindFunctionType" || kind === "KindCallSignature") {
      finalizeRustCallableSignature(walk, node);
    } else if (kind === KindFunctionDeclaration && !sourceDeclarationIsModuleScoped(node, ast)) {
      finalizeRustCallableSignature(walk, node);
    } else if (kind === KindVariableDeclaration && !sourceDeclarationIsModuleScoped(node, ast)) {
      recordCallableValueSignatureForDeclaration(walk, node);
    }
    ast.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function recordTopLevelCallableValueSignatureFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  const statements = requireDenseSourceNodes(
    walk,
    walk.context.ast.statements(sourceFile),
    "Source file contains an undefined or non-data top-level statement slot.",
  );
  if (statements !== undefined) {
    recordCallableValueSignaturesForStatements(walk, statements);
  }
}

export function recordPredeclaredNativeFunctionBindingFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  const statements = requireDenseSourceNodes(
    walk,
    ast.statements(sourceFile),
    "Source file contains an undefined or non-data top-level statement slot.",
  );
  if (statements === undefined) {
    return;
  }
  for (const statement of statements) {
    if (ast.kindName(statement) === KindFunctionDeclaration) {
      const valueName = walk.context.names.callableValueNameForDeclaration(statement);
      const implementationName = walk.context.names.functionNameForDeclaration(statement);
      const value = finalizedNativeCallableValue(walk, statement, valueName);
      if (valueName !== undefined && implementationName !== undefined && value !== undefined) {
        setCarrierFact(walk, statement, value.carrier);
        requireRustRecord(walk.context.requiredRecords, "moduleBinding", statement, "function", "analysis/callables/signatures.ts");
        walk.context.records.moduleBindings.function(statement, implementationName, value);
      }
      continue;
    }
    if (ast.kindName(statement) !== KindVariableStatement) {
      continue;
    }
    const declarations = requireDenseSourceNodes(
      walk,
      VariableDeclarationList_Declarations(
        ast,
        VariableStatement_DeclarationList(ast, statement),
      ),
      "Variable statement contains an undefined or non-data declaration slot.",
    );
    if (declarations === undefined || declarations.length === 0) {
      return;
    }
    for (const declaration of declarations) {
      if (ast.kindName(declaration) !== KindVariableDeclaration ||
        ast.variableDeclarationKind(declaration) !== "const") {
        continue;
      }
      const candidate = walk.moduleBindings.nativeCallable(declaration);
      if (candidate === undefined || !nativeModuleFunctionAbiIsFinalized(
        walk,
        candidate.callableDeclaration,
      )) {
        continue;
      }
      const valueName = candidate.valueObserved
        ? walk.context.names.callableValueNameForDeclaration(declaration)
        : undefined;
      const value = finalizedNativeCallableValue(
        walk,
        candidate.callableDeclaration,
        valueName,
      );
      if (candidate.valueObserved && value === undefined) {
        continue;
      }
      if (value !== undefined) {
        setCarrierFact(walk, declaration, value.carrier);
      }
      requireRustRecord(walk.context.requiredRecords, "moduleBinding", declaration, "callable", "analysis/callables/signatures.ts");
      walk.context.records.moduleBindings.callable(declaration, candidate.callableDeclaration, candidate.name, value);
    }
  }
}

function finalizedNativeCallableValue(
  walk: RustFactWalk,
  callableDeclaration: Node,
  valueName: string | undefined,
): Extract<
  import("../../target-model/records/operation-selections.js").RustModuleBindingFact,
  { readonly storage: "native-callable" }
>["value"] | undefined {
  const parameterAbis = walk.context.ast.parameters(callableDeclaration).map((parameter) =>
    parameter === undefined
      ? undefined
      : walk.context.records.sourceParameterAbi.get(parameter));
  const resultCarrier = rustCallableInvocationResult(walk.context.records, callableDeclaration);
  if (valueName === undefined || resultCarrier === undefined ||
    parameterAbis.some((abi) => abi === undefined)) {
    return undefined;
  }
  const closed = parameterAbis as import("../../target-model/records/callables-and-resources.js").RustSourceParameterAbiFact[];
  const carrier = rustSourceFunctionValueCarrier(walk, callableDeclaration, closed, resultCarrier);
  if (carrier === undefined) return undefined;
  return {
    name: valueName,
    carrier,
    parameterCarriers: closed.map((abi) => abi.parameterCarrier),
    resultCarrier,
  };
}

function nativeModuleFunctionAbiIsFinalized(
  walk: RustFactWalk,
  callableDeclaration: Node,
): boolean {
  const parameters = walk.context.ast.parameters(callableDeclaration);
  return isDenseDataArray(parameters) &&
    parameters.every((parameter) =>
      parameter !== undefined &&
      (walk.context.records.sourceParameterAbi.get(parameter)) !== undefined) &&
    (walk.context.records.sourceCallableReturn.get(callableDeclaration)) !== undefined;
}

function recordCallableValueSignaturesForStatements(
  walk: RustFactWalk,
  statements: readonly Node[],
): void {
  for (const statement of statements) {
    if (walk.context.ast.kindName(statement) === KindVariableStatement) {
      recordCallableValueSignaturesForVariableStatement(walk, statement);
    }
  }
}

function recordCallableValueSignaturesForVariableStatement(
  walk: RustFactWalk,
  statement: Node,
): void {
  const { ast } = walk.context;
  const declarations = VariableDeclarationList_Declarations(
    ast,
    VariableStatement_DeclarationList(ast, statement),
  );
  if (declarations === undefined || !isDenseDataArray(declarations)) {
    return;
  }
  for (const declaration of declarations) {
    if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration) {
      return;
    }
    recordCallableValueSignatureForDeclaration(walk, declaration);
  }
}

export function recordCallableValueSignatureForDeclaration(
  walk: RustFactWalk,
  declaration: Node,
): void {
  const { ast } = walk.context;
  let initializer = Node_Initializer(ast, declaration);
  while (initializer !== undefined) {
    const kind = ast.kindName(initializer);
    if (kind === KindParenthesizedExpression || kind === KindNonNullExpression ||
      kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") {
      initializer = Node_Expression(ast, initializer);
      continue;
    }
    if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
      recordCallableValueSignatureFacts(walk, declaration, initializer);
    }
    break;
  }
}

function recordCallableValueSignatureFacts(
  walk: RustFactWalk,
  declaration: Node,
  expression: Node,
): void {
  const { ast } = walk.context;
  const nativeCallable = walk.moduleBindings.nativeCallable(declaration);
  if (nativeCallable?.callableDeclaration === expression && Node_Type(ast, declaration) === undefined ||
    walk.context.sourceCallables.directLexicalBinding(expression) === declaration) {
    finalizeRustCallableSignature(walk, expression);
    return;
  }
  const valueCarrier = rustGenericCallableValueOwner(ast, declaration, walk.context.records.runtimeCarrier.get(declaration)?.carrier ??
    resolveRustTargetTypeRef(
      Node_Type(ast, declaration) ?? expression,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    ));
  const selectedCarrier = selectRustClosedCallableContext(walk, expression, valueCarrier);
  const ownParameters = walk.context.sourceLifetimes.contractFor(expression)?.parameters
    .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const callable = rustGenericCallableProtocol(selectedCarrier, ownParameters) ?? rustCallableProtocol(selectedCarrier);
  const closure = rustClosureProtocol(selectedCarrier);
  const parameterCarriers = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.args
    : closure?.parameters ?? callable?.parameters;
  const selectedReturnCarrier = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.result
    : closure?.result ?? callable?.result;
  const parameters = ast.parameters(expression);
  if (selectedCarrier === undefined || parameterCarriers === undefined ||
    selectedReturnCarrier === undefined || parameters.length > parameterCarriers.length) {
    return;
  }
  const parameterAbis: import("../../target-model/records/callables-and-resources.js").RustSourceParameterAbiFact[] = [];
  for (const [index, parameter] of parameters.entries()) {
    const sourceParameterCarrier = parameterCarriers[index];
    if (parameter === undefined || sourceParameterCarrier === undefined) {
      return;
    }
    const parameterCarrier = Node_Initializer(ast, parameter) === undefined
      ? sourceParameterCarrier
      : rustSourceOptionalTargetType(sourceParameterCarrier);
    const contextualAbi = resolveRustContextualParameterAbi(
      parameter,
      parameterCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
    );
    const parameterAbi = contextualAbi === undefined ? undefined
      : nativeCallable?.callableDeclaration === expression
        ? walk.sourceCallableAbi.resolveParameterAbi(
            parameter, rustResolutionContext(walk, parameter), walk.operationOptions,
            contextualAbi.valueCarrier,
          )
        : contextualAbi;
    if (parameterAbi === undefined) {
      return;
    }
    if (!recordRustParameterAbiSelection(walk, parameter, parameterAbi)) return;
    parameterAbis.push(parameterAbi);
  }
  // A callable with its own return annotation (or a typed binding) has its return; only an unannotated one is inferred
  // from its body, which may read the binding being initialized.
  const inference = Node_Type(ast, declaration) === undefined && Node_Type(ast, expression) === undefined &&
    !ast.hasModifierKind(expression, "async")
    ? selectRustInferredReturn(walk, expression, selectedReturnCarrier)
    : { kind: "complete" as const, carrier: selectedReturnCarrier };
  if (inference.kind === "pending") return;
  const returnCarrier = inference.carrier;
  const suspended = ast.hasModifierKind(expression, "async") ||
    walk.context.semanticsFor(expression).operations.generator(expression) !== undefined;
  if (finalizeRustCallableSignature(walk, expression, {
    parameterAbis, contextualResult: selectedReturnCarrier, ...(suspended ? {} : { selectedReturn: returnCarrier }),
  }) === undefined) {
    return;
  }
  if (nativeCallable?.callableDeclaration === expression) return;
  const runtimeParameterCarriers = [
    ...parameterAbis.map((abi) => abi.parameterCarrier),
    ...parameterCarriers.slice(parameters.length),
  ];
  const valueReturnCarrier = selectedCallableValueReturn(walk, expression, returnCarrier);
  const signatureCarrier = rebindRustCallableCarrier(selectedCarrier, runtimeParameterCarriers, valueReturnCarrier,
    { typeParameters: ownParameters ?? [] });
  const runtimeCarrier = signatureCarrier === undefined ? undefined : rustSourceClosureValueCarrier(walk, expression, signatureCarrier);
  if (runtimeCarrier !== undefined) {
    setCarrierFact(walk, expression, runtimeCarrier);
    setCarrierFact(walk, declaration, runtimeCarrier);
  }
}

function selectedCallableValueReturn(
  walk: RustFactWalk,
  declaration: Node,
  synchronousReturn: TargetTypeRef,
): TargetTypeRef {
  return rustCallableInvocationResult(walk.context.records, declaration) ?? synchronousReturn;
}

export function selectedSourceCallableReturn(walk: RustFactWalk, declaration: Node): Type | undefined {
  const semantics = walk.context.semanticsFor(declaration);
  const signature = semantics.types.declarationSignatureInfo(declaration);
  return signature !== undefined && semantics.declarations.signatureDeclaration(signature.signature) === declaration
    ? signature.returnType : undefined;
}

export interface RustSourceCallableReturnSelection {
  readonly fact: RustSourceCallableReturnFact;
  readonly retainedEnvironment?: RustRetainedEnvironment;
}

export function selectRustCallableLogicalReturn(
  walk: RustFactWalk, declaration: Node, selectedCarrier?: TargetTypeRef,
): RustInferredReturnSelection {
  const generator = walk.context.records.generator.get(declaration);
  const asynchronous = walk.context.records.asyncFunction.get(declaration);
  const baseline = selectedCarrier ?? generator?.resultCarrier ?? asynchronous?.outputCarrier ?? resolveRustTargetTypeRef(
    Node_Type(walk.context.ast, declaration) ?? selectedSourceCallableReturn(walk, declaration),
    rustResolutionContext(walk, declaration), walk.operationOptions);
  return selectedCarrier !== undefined || generator !== undefined || asynchronous !== undefined
    ? baseline === undefined ? { kind: "pending" as const } : { kind: "complete" as const, carrier: baseline }
    : selectRustInferredReturn(walk, declaration, baseline);
}

export function selectRustSourceCallableReturn(
  walk: RustFactWalk,
  declaration: Node,
  selectedCarrier?: TargetTypeRef,
): RustSourceCallableReturnSelection | undefined {
  const generator = walk.context.records.generator.get(declaration);
  const asynchronous = walk.context.records.asyncFunction.get(declaration);
  if (walk.context.semanticsFor(declaration).operations.generator(declaration) !== undefined
    ? generator === undefined
    : asynchronous === undefined && walk.context.ast.hasModifierKind(declaration, "async")) return undefined;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const inference = selectRustCallableLogicalReturn(walk, declaration, selectedCarrier);
  if (inference.kind === "pending") return undefined;
  const selected = inference.carrier;
  const pointer = selectRustPointerReturnContract(declaration, rustResolutionContext(walk, declaration), walk.operationOptions);
  if (selectedCarrier !== undefined && pointer !== undefined &&
    !rustTargetTypeRefEquals(selectedCarrier, pointer.returnCarrier)) {
    return undefined;
  }
  const rawCarrier = pointer?.returnCarrier ?? rustGenericCallableValueOwner(walk.context.ast, declaration, selected);
  const parameterCarriers = walk.context.ast.parameters(declaration).map(parameter =>
    parameter === undefined ? undefined : walk.context.records.sourceParameterAbi.get(parameter)?.parameterCarrier);
  if (parameterCarriers.some(parameter => parameter === undefined)) return undefined;
  const nativeReturn = rawCarrier === undefined || asynchronous !== undefined || generator !== undefined ? undefined
    : selectRustRetainedReturn(walk, declaration, rawCarrier);
  if (nativeReturn?.kind === "pending") return undefined;
  const retained = nativeReturn?.kind !== "complete" ? undefined
    : resolveRustRetainedResult(declaration, sourceReturn, nativeReturn.carrier, parameterCarriers,
        rustResolutionContext(walk, declaration), walk.operationOptions);
  const carrier = asynchronous !== undefined || generator !== undefined ? rawCarrier : retained?.carrier;
  if (carrier !== undefined) {
    const borrowedParameter = walk.context.sourceCallables.borrowedReturnParameter(declaration);
    const borrowedAbi = borrowedParameter === undefined ? undefined
      : walk.context.records.sourceParameterAbi.get(borrowedParameter);
    const completion = walk.context.semanticsFor(declaration).operations.callableCompletion(declaration);
    const absence = rustOptionElementCarrier(carrier) !== undefined || rustOptionalStorageValue(carrier) !== undefined ||
      rustUnionPayloadAdmission(rustAbsenceTargetType(), carrier, walk.context.typeDefinitions) !== undefined;
    const implementationResult = asynchronous !== undefined || generator !== undefined || sourceReturn === undefined
      ? undefined : resolveRustTargetTypeRef(sourceReturn, rustResolutionContext(walk, declaration), walk.operationOptions);
    return {
      fact: {
        returnCarrier: carrier,
        ...(borrowedParameter !== undefined && borrowedAbi?.mode === "ref" && borrowedAbi.inputLifetime !== undefined &&
          rustTargetTypeRefEquals(borrowedAbi.valueCarrier, carrier) ? { borrowedParameter } : {}),
        ...(isRustUnitCarrier(implementationResult) ? { implementationCompletion: "absence" as const }
          : isRustNeverCarrier(implementationResult) ? { implementationCompletion: "diverging" as const } : {}),
        ...(completion === undefined ? {} : { canFallThrough: completion.canFallThrough }),
        ...(absence || pointer?.undefinedReturn ? { undefinedReturn: true } : {}),
        ...(absence && completion?.canFallThrough || pointer?.fallthroughUndefined ? { fallthroughUndefined: true } : {}),
      },
      ...(retained?.environment === undefined ? {} : { retainedEnvironment: retained.environment }),
    };
  }
  return undefined;
}
