import { requireRustRecord } from "../../../program/records/objects/required-records.js";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";

import { KindExportAssignment, KindFunctionDeclaration, KindBindingElement, KindParameter, KindVariableDeclaration, Node_Expression, Node_Initializer, asSourceNode, sourceDeclarationIsModuleScoped, sourceBindingCapturedBeforeInitialization } from "@tsonic/target-api/source";

import { rustOperationContext } from "../../../program/walk.js";
import { applySelectedProjectSourceCall, setCarrierFact } from "../../../operations/project-calls.js";

import { prepareRustDeferredCheckedCall } from "../../../operations/members/index.js";
import { recordPreparedOperationInputs } from "../../../operations/inputs.js";

import { recordExportAssignmentFacts } from "../../../control-flow/statements.js";
import { resolveExpressionCarrier } from "./expression-carriers.js";

import { resolveRustExactNullishValueCarrier } from "./index.js";
import { rustPolicyTargetDiagnostic } from "../../../program/policy-diagnostics.js";

import { selectRustDeclaredBinding } from "../../../declarations/binding-storage.js";
import { tryFlowMarkerCall } from "../../../operations/flow-markers.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../../../program/walk.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { rustSourceFunctionValueCarrier } from "../../../callables/values/function-values.js";
import { recordCallableValueSignatureForDeclaration } from "../../../callables/calls/signatures.js";

import { rustCallableInvocationResult } from "../../../../policy/types/callables/return-contexts.js";
import { resolveRustModuleBindingValue } from "../../../program/module-declarations.js";

import { recordProjectSourceBinding, selectedDeclarationIsProjectSource } from "../../../storage/source-bindings.js";
import { resolveSharedSourceMarkerCarrier } from "../../../operations/source-markers.js";
import { applySelectedRuntimeCallableCall } from "../../../callables/native/runtime-callables.js";
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
    // A binding read inside its own initializer (a recursive callable) or captured before its initialization takes
    // its callable value signature before the initializer's body is resolved.
    if (declarationKind === KindVariableDeclaration &&
      (sourceBindingCapturedBeforeInitialization(declaration, ast, walk.context.source.navigation) ||
        sourceNodeWithin(ast, identifier, Node_Initializer(ast, declaration)))) {
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
      const parameters = sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration));
      if (parameters === undefined) return;
      const parameterAbis = parameters.map((parameter) => parameter === undefined
        ? undefined
        : walk.context.records.sourceParameterAbi.get(parameter));
      const returnFact = walk.context.records.sourceCallableReturn.get(declaration);
      const returnCarrier = returnFact === undefined ? undefined : rustCallableInvocationResult(walk.context.records, declaration);
      const name = ast.name(declaration);
      const targetName = walk.context.names.functionNameForDeclaration(declaration);
      if (name !== undefined && parameterAbis.every((abi) => abi !== undefined) &&
        returnCarrier !== undefined && targetName !== undefined) {
        const closedParameterAbis = parameterAbis as import("../../../../target-model/records/callables/callables-and-resources.js").RustSourceParameterAbiFact[];
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
    if (declarationKind === KindVariableDeclaration) {
      const selected = selectRustDeclaredBinding(walk, declaration, sourceFile);
      return selected.kind === "unresolved" ? undefined : setCarrierFact(walk, identifier, selected.carrier);
    }
    if (declarationKind === KindParameter) {
      const parameter = walk.context.records.sourceParameterAbi.get(declaration);
      if (parameter === undefined) return undefined;
      return setCarrierFact(walk, identifier, parameter.valueCarrier);
    }
    if (declarationKind === KindBindingElement) {
      const projection = walk.context.records.bindingProjection.get(declaration);
      return projection !== undefined && "bindingCarrier" in projection
        ? setCarrierFact(walk, identifier, projection.bindingCarrier) : undefined;
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
    if (!recordPreparedOperationInputs(walk, deferred.request, sourceFile, prepared.value)) return undefined;
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

function sourceNodeWithin(ast: RustFactWalk["context"]["ast"], node: Node, ancestor: Node | undefined): boolean {
  for (let current: Node | undefined = node; ancestor !== undefined && current !== undefined; current = ast.parent(current))
    if (current === ancestor) return true;
  return false;
}
