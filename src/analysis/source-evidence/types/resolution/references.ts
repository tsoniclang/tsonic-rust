import { requireRustRecord } from "../../../program/records/required-records.js";

import { KindExportAssignment, KindFunctionDeclaration, KindBindingElement, KindParameter, KindVariableDeclaration, Node_Expression, Node_Initializer, asSourceNode, sourceDeclarationIsModuleScoped, sourceBindingCapturedBeforeInitialization } from "@tsonic/target-api/source";

import { rustOperationContext } from "../../../program/walk.js";
import { applySelectedProjectSourceCall, setCarrierFact } from "../../../operations/project-calls.js";

import { prepareRustDeferredCheckedCall } from "../../../operations/members/index.js";

import { recordExportAssignmentFacts } from "../../../control-flow/statements.js";
import { resolveExpressionCarrier } from "./expression-carriers.js";

import { resolveRustExactNullishValueCarrier } from "./index.js";
import { rustPolicyTargetDiagnostic } from "../../../program/policy-diagnostics.js";

import { resolveRustDeclaredBindingStorage } from "../../../declarations/binding-storage.js";
import { tryFlowMarkerCall } from "../../../operations/flow-markers.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../../../program/walk.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { rustSourceFunctionValueCarrier } from "../../../callables/function-values.js";
import { recordCallableValueSignatureForDeclaration } from "../../../callables/signatures.js";

import { rustCallableInvocationResult } from "../../../../policy/types/callables/return-contexts.js";
import { resolveRustModuleBindingValue } from "../../../program/module-declarations.js";

import { recordProjectSourceBinding, selectedDeclarationIsProjectSource } from "../../../storage/source-bindings.js";
import { resolveSharedSourceMarkerCarrier } from "../../../operations/source-markers.js";
import { applySelectedRuntimeCallableCall } from "../../../callables/runtime-callables.js";
export function resolveIdentifierCarrier(
  walk: RustFactWalk,
  identifier: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const reference = walk.context.source.navigation.sourceReferenceFor(identifier);
  const declaration = reference?.declaration;
  if (reference !== undefined && declaration !== undefined && reference.project) {
    const declarationKind = ast.kindName(declaration);
    recordProjectSourceBinding(walk, identifier);
    if (declarationKind === "KindClassDeclaration" || declarationKind === "KindClassExpression") {
      const value = walk.context.records.classValues.resolve(walk, identifier, expected);
      if (value !== undefined) return value;
    }
    if (declarationKind === KindExportAssignment) {
      const exportCarrier = recordExportAssignmentFacts(walk, declaration);
      if (exportCarrier !== undefined) {
        return setCarrierFact(walk, identifier, exportCarrier);
      }
    }
    if (declarationKind === KindParameter) {
      requireRustRecord(walk.context.requiredRecords, "sourceParameterAbi", identifier, "parameter-reference", "resolveIdentifierCarrier");
      walk.context.records.sourceParameterAbis.use(identifier, declaration);
    }
    if (declarationKind === KindVariableDeclaration &&
      sourceBindingCapturedBeforeInitialization(declaration, ast, walk.context.source.navigation)) {
      recordCallableValueSignatureForDeclaration(walk, declaration);
    }
    if ((declarationKind === KindBindingElement || declarationKind === KindVariableDeclaration) &&
      sourceDeclarationIsModuleScoped(declaration, ast)) {
      const carrier = resolveRustModuleBindingValue(walk, declaration);
      if (carrier !== undefined) recordProjectSourceBinding(walk, identifier);
      return carrier === undefined ? undefined : setCarrierFact(walk, identifier, carrier);
    }
    // Every reference to a function declaration records its own callable value, so this precedes the declaration
    // carrier shortcut below (the declaration carries the function value's carrier too).
    if (declarationKind === KindFunctionDeclaration) {
      const parameters = ast.parameters(declaration);
      const parameterAbis = parameters.map((parameter) => parameter === undefined
        ? undefined
        : walk.context.records.sourceParameterAbi.get(parameter));
      const returnFact = walk.context.records.sourceCallableReturn.get(declaration);
      const returnCarrier = returnFact === undefined ? undefined : rustCallableInvocationResult(walk.context.records, declaration);
      const name = ast.name(declaration);
      const targetName = walk.context.names.functionNameForDeclaration(declaration);
      if (name !== undefined && parameterAbis.every((abi) => abi !== undefined) &&
        returnCarrier !== undefined && targetName !== undefined) {
        const closedParameterAbis = parameterAbis as import("../../../../target-model/records/callables-and-resources.js").RustSourceParameterAbiFact[];
        const callableCarrier = rustSourceFunctionValueCarrier(walk, declaration, closedParameterAbis, returnCarrier);
        if (callableCarrier === undefined) return undefined;
        // The function value's carrier depends only on its declaration; storage origins resolve a reference to the
        // declaration, so the declaration carries it too (as variable initializers do above).
        if (setCarrierFact(walk, declaration, callableCarrier) === undefined) return undefined;
        requireRustRecord(walk.context.requiredRecords, "sourceCallableValue", identifier, "runtime-function", "resolveIdentifierCarrier");
        walk.context.records.sourceCallableValues.function(identifier, declaration,
          ast.getFileName(ast.getSourceFile(declaration)), targetName, callableCarrier,
          closedParameterAbis.map((abi) => abi.parameterCarrier), returnCarrier);
        return setCarrierFact(walk, identifier, callableCarrier);
      }
    }
    const declarationCarrier = walk.context.records.runtimeCarrier.get(declaration);
    if (declarationCarrier !== undefined) {
      return setCarrierFact(walk, identifier, declarationCarrier.carrier);
    }
    if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration ||
      declarationKind === KindBindingElement) {
      const annotated = resolveRustDeclaredBindingStorage(walk, declaration);
      if (annotated !== undefined) {
        setCarrierFact(walk, declaration, annotated);
        return setCarrierFact(walk, identifier, annotated);
      }
      const initializer = Node_Initializer(walk.context.ast, declaration);
      if (initializer !== undefined) {
        const initializerCarrier = resolveExpressionCarrier(
          walk,
          initializer,
          sourceFile,
          undefined,
        );
        if (initializerCarrier !== undefined) {
          setCarrierFact(walk, declaration, initializerCarrier);
          return setCarrierFact(walk, identifier, initializerCarrier);
        }
      }
    }
  }
  const semantics = walk.context.semantics(sourceFile);
  const semanticType = semantics.types.expressionType(identifier);
  const nullishCarrier = semanticType !== undefined && semantics.types.isNullish(semanticType)
    ? resolveRustExactNullishValueCarrier(semanticType, semantics)
    : undefined;
  return nullishCarrier === undefined
    ? undefined
    : setCarrierFact(walk, identifier, nullishCarrier);
}

export function resolveCallLikeCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expressionKind: string,
  expected?: TargetTypeRef,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const callee = Node_Expression(walk.context.ast, expression);
  if (callee === undefined) {
    return undefined;
  }
  const sharedMarkerCarrier = resolveSharedSourceMarkerCarrier(
    walk,
    expression,
    sourceFile,
    expected,
  );
  if (sharedMarkerCarrier.handled) {
    return sharedMarkerCarrier.carrier;
  }
  const callArguments = ast.arguments(expression);
  const flowHandled = tryFlowMarkerCall(walk, expression, callArguments, sourceFile, expected);
  if (flowHandled !== undefined) {
    return flowHandled.carrier;
  }
  const deferred = walk.deferredCallbackCalls.get(expression);
  if (deferred !== undefined) {
    walk.deferredCallbackCalls.delete(expression);
    const prepared = prepareRustDeferredCheckedCall(
      deferred.request,
      deferred.selection,
      rustOperationContext(walk, expression),
      walk.operationOptions,
      (argument, argumentExpected) =>
        resolveExpressionCarrier(walk, argument, sourceFile, argumentExpected),
    );
    if (prepared.kind === "reject") {
      walk.context.diagnostics.push(
        rustPolicyTargetDiagnostic(prepared.diagnostic),
      );
      return undefined;
    }
    walk.preparedCallbackCalls.set(expression, {
      request: deferred.request,
      prepared: prepared.value,
    });
    requireRustRecord(walk.context.requiredRecords, "preparedOperationResult", expression, "deferred-call", "analysis/source-evidence/types/resolution/references.ts");
    walk.context.records.preparedOperations.prepare(expression, prepared.value.template, prepared.value.resultCarrier);
    return setCarrierFact(walk, expression, prepared.value.resultCarrier);
  }
  const selectedSignature = walk.context.records.selectedCall.get(expression);
  if (selectedSignature?.sourceCallableCarrier !== undefined) {
    return applySelectedRuntimeCallableCall(
      walk,
      expression,
      callee,
      callArguments,
      sourceFile,
      selectedSignature,
    );
  }
  const selectedSourceDeclaration = asSourceNode(
    selectedSignature?.sourceDeclaration,
    walk.context.ast,
  );
  if (selectedSignature !== undefined && selectedSourceDeclaration !== undefined &&
    selectedDeclarationIsProjectSource(walk, selectedSourceDeclaration)) {
    return applySelectedProjectSourceCall(
      walk,
      expression,
      callee,
      callArguments,
      sourceFile,
      expressionKind,
      selectedSourceDeclaration,
      selectedSignature,
      expected,
    );
  }
  return undefined;
}
