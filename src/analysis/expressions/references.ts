import { requireRustRecord } from "../program/records/required-records.js";
import { rustCallableInvocationSignaturesMatch } from "../../target-model/conversions/callable-input.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { finalizeProjectSourceGenericArguments } from "../operations/project-call-generics.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/model/type-family-normalization.js";
import {
  KindExportAssignment,
  KindFunctionDeclaration,
  KindBindingElement,
  KindParameter,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
  asSourceNode,
  sourceDeclarationIsModuleScoped,
  sourceBindingCapturedBeforeInitialization,
} from "@tsonic/target-api/source";

import {
  rustOptionElementCarrier,
  rustCallableProtocol,
  rustNativeCallableProtocol,
  rustSourcePrimitiveTargetType,
  rustUnitTargetType,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import { appendRustDiagnostic, recordPolicySelection, rustOperationContext, rustResolutionContext } from "../program/walk.js";
import { applySelectedProjectSourceCall, prepareSelectedSourceCallArguments, recordSelectedSourceCallArguments,
  setCarrierFact } from "../operations/project-calls.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { prepareRustDeferredCheckedCall } from "../operations/provider/index.js";
import { recordRustComputedCallEvaluation } from "../operations/computed-members.js";
import { readRustSourceNativePointerOperation, readRustSourceSafetyBuilder, readRustSourceUnsafeContext } from "../../policy/operations/safety/source-explicit-safety.js";
import { recordExportAssignmentFacts } from "../control-flow/statements.js";
import { resolveExpressionCarrier } from "./carriers.js";

import { selectRustOptionalCallResult } from "../operations/provider/calls/instantiation.js";
import {
  readRustReferenceOperation,
  resolvedRustReferenceOperationCarrier,
} from "./reference-operations.js";
import { resolveRustExactNullishValueCarrier, resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";

import { resolveRustContextualParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustSourceBindingFactEquals, rustSourceCallableValueEquals } from "../../target-model/records/equality.js";
import type { RustSourceCallableValueFact } from "../../target-model/records/operation-selections.js";
import { resolveRustDeclaredBindingStorage, tryFlowMarkerCall } from "../declarations/types-and-bindings.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSelectedTargetSignature, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceBindingFact } from "../../target-model/records/value-projections.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { rustSourceFunctionValueCarrier } from "../callables/function-values.js";
import { recordCallableValueSignatureForDeclaration } from "../callables/signatures.js";
import { readRustSourceRawAddress } from "../../policy/operations/pointers/raw-addresses.js";
import { readRustRawLocation } from "../../policy/operations/pointers/native-memory.js";
import { resolveRustRawLocationCarrier } from "../operations/native-memory.js";
import { resolveRustMemoryBindingCarrier } from "../operations/memory-bindings.js";
import { selectTsonicMemoryFieldBinding, selectTsonicMemoryRecordBinding } from "@tsonic/source-core/facts";
import { resolveRustRawAddressCarrier, resolveRustRawPointerIdentityCarrier } from "../operations/raw-addresses.js";
import { readRustSourceRawPointerIdentity } from "../../policy/operations/pointers/source-raw-pointers.js";
import { selectRustMemoryLayoutObservation } from "../../policy/operations/pointers/layout-observations.js";

import { readRustNativeControl, resolveRustNativeControl } from "./native-controls.js";
import { rustSourceCallArgumentCarriers, rustSourceCallResultWithInputLifetimes } from "../callables/source-call-lifetimes.js";
import { retainRustSelectedSourceCallResultStorage } from "../../policy/types/resolution/call-results.js";
import { callableRestElement } from "../callables/adapters.js";
import { rustCallableInvocationResult } from "../callables/results.js";
import { resolveRustModuleBindingValue } from "../program/module-declarations.js";

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
    if (walk.rejectedExpressions.has(declaration)) {
      walk.rejectedExpressions.add(identifier);
      for (const dependent of walk.resolving) walk.rejectedExpressions.add(dependent);
      return undefined;
    }
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
        const closedParameterAbis = parameterAbis as import("../../target-model/records/callables-and-resources.js").RustSourceParameterAbiFact[];
        const callableCarrier = rustSourceFunctionValueCarrier(walk, declaration, closedParameterAbis, returnCarrier);
        if (callableCarrier === undefined) return undefined;
        requireRustRecord(walk.context.requiredRecords, "sourceCallableValue", identifier, "runtime-function", "resolveIdentifierCarrier");
        walk.context.records.sourceCallableValues.function(identifier, declaration,
          ast.getFileName(ast.getSourceFile(declaration)), targetName, callableCarrier,
          closedParameterAbis.map((abi) => abi.parameterCarrier), returnCarrier);
        return setCarrierFact(walk, identifier, callableCarrier);
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

export function recordProjectSourceBinding(
  walk: RustFactWalk,
  identifier: Node,
): RustSourceBindingFact | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const reference = walk.context.source.navigation.sourceReferenceFor(identifier);
  const declaration = reference?.declaration;
  if (reference === undefined || declaration === undefined || !reference.project ||
    isImportBindingDeclarationKind(ast.kindName(declaration))) {
    return undefined;
  }
  const declarationKind = ast.kindName(declaration);
  const declarationName = ast.name(declaration);
  const sourceName = declarationKind === KindExportAssignment
    ? "default"
    : declarationName === undefined
      ? ""
      : ast.text(declarationName);
  if (sourceName.length === 0 ||
    walk.context.names.nameForDeclaration(declaration) === undefined) {
    return undefined;
  }
  requireRustRecord(walk.context.requiredRecords, "sourceBinding", identifier, "project-reference", "recordProjectSourceBinding");
  const selected: RustSourceBindingFact = sourceDeclarationIsModuleScoped(declaration, ast)
    ? { scope: "module", sourceDeclaration: declaration, sourceName, fileName: ast.getFileName(ast.getSourceFile(declaration)) }
    : { scope: "lexical", sourceDeclaration: declaration, sourceName };
  let binding = walk.context.records.sourceBinding.get(identifier);
  if (binding !== undefined && !rustSourceBindingFactEquals(binding, selected)) {
    failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.sourceBinding' for one exact source subject.", identifier);
  }
  if (binding === undefined) binding = selected.scope === "module"
    ? walk.context.records.sourceBindings.module(identifier, declaration, sourceName, selected.fileName)
    : walk.context.records.sourceBindings.lexical(identifier, declaration, sourceName);
  const module = walk.context.records.moduleBinding.get(declaration);
  if (binding.scope === "module" && module?.storage === "native-callable" && module.value !== undefined &&
    !walk.context.source.navigation.declarationUseSummary(declaration).bindingWritten) {
    requireRustRecord(walk.context.requiredRecords, "directCallableReference", identifier, "module-callable", "recordProjectSourceBinding");
    const callable: RustSourceCallableValueFact = { form: "function", sourceDeclaration: module.callableDeclaration,
      fileName: binding.fileName, name: module.name, carrier: module.value.carrier,
      parameterCarriers: module.value.parameterCarriers, resultCarrier: module.value.resultCarrier };
    const existing = walk.context.records.directCallableReference.get(identifier);
    if (existing !== undefined && !rustSourceCallableValueEquals(existing, callable)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.directCallableReference' for one exact source subject.", identifier);
    }
    if (existing === undefined) walk.context.records.directCallableReferences.function(identifier, module.callableDeclaration,
      binding.fileName, module.name, module.value.carrier, module.value.parameterCarriers, module.value.resultCarrier);
  }
  return binding;
}

function isImportBindingDeclarationKind(kind: string): boolean {
  return kind === "KindImportSpecifier" ||
    kind === "KindImportClause" ||
    kind === "KindNamespaceImport" ||
    kind === "KindImportEqualsDeclaration";
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
      recordPolicySelection(walk, expression, prepared);
      return undefined;
    }
    walk.preparedCallbackCalls.set(expression, {
      request: deferred.request,
      prepared: prepared.value,
    });
    requireRustRecord(walk.context.requiredRecords, "preparedOperationResult", expression, "deferred-call", "analysis/expressions/references.ts");
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

export function isSharedSourceMarkerOperation(
  walk: RustFactWalk,
  expression: Node,
): boolean {
  const sourceFacts = walk.context.source.sourceFacts;
  return readRustReferenceOperation(walk, expression) !== undefined ||
    readRustNativeControl(walk, expression) !== undefined ||
    selectTsonicMemoryFieldBinding(walk.context.ast, sourceFacts, expression) !== undefined ||
    selectTsonicMemoryRecordBinding(walk.context.ast, sourceFacts, expression) !== undefined ||
    readRustRawLocation(walk.context.ast, sourceFacts, expression) !== undefined ||
    selectRustMemoryLayoutObservation(sourceFacts, expression) !== undefined ||
    readRustSourceRawPointerIdentity(expression, sourceFacts) !== undefined ||
    readRustSourceRawAddress(sourceFacts, expression) !== undefined ||
    readRustSourceNativePointerOperation(sourceFacts, expression) !== undefined ||
    readRustSourceUnsafeContext(sourceFacts, expression) !== undefined ||
    readRustSourceSafetyBuilder(sourceFacts, expression) !== undefined;
}

type RustSharedSourceMarkerCarrierResolution =
  | { readonly handled: false }
  | { readonly handled: true; readonly carrier?: TargetTypeRef };

function resolveSharedSourceMarkerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): RustSharedSourceMarkerCarrierResolution {
  const sourceFacts = walk.context.source.sourceFacts;
  const nativeControl = readRustNativeControl(walk, expression);
  if (nativeControl !== undefined) {
    return { handled: true, ...resolveRustNativeControl(walk, expression, sourceFile, nativeControl) };
  }
  const memoryBinding = resolveRustMemoryBindingCarrier(walk, expression, sourceFile);
  if (memoryBinding !== undefined) return memoryBinding;
  const rawLocation = resolveRustRawLocationCarrier(walk, expression, sourceFile);
  if (rawLocation !== undefined) return rawLocation;
  const layout = selectRustMemoryLayoutObservation(sourceFacts, expression);
  if (layout !== undefined) {
    if (layout.kind === "rejected") {
      appendRustDiagnostic(walk, "RUST_MEMORY_LAYOUT_OBSERVATION_NOT_PROVEN", layout.reason, expression, []);
      return { handled: true };
    }
    requireRustRecord(walk.context.requiredRecords, "memoryLayoutObservation", expression, "native-layout", "analysis/expressions/references.ts");
    walk.context.records.memoryLayoutObservations.observe(expression, layout.value);
    return { handled: true, carrier: setCarrierFact(walk, expression, rustSourcePrimitiveTargetType("native-uint")) };
  }
  const rawIdentity = readRustSourceRawPointerIdentity(expression, sourceFacts);
  if (rawIdentity !== undefined) {
    return { handled: true, ...resolveRustRawPointerIdentityCarrier(walk, expression, sourceFile, rawIdentity) };
  }
  const rawAddress = readRustSourceRawAddress(sourceFacts, expression);
  if (rawAddress !== undefined) {
    return { handled: true, ...resolveRustRawAddressCarrier(walk, expression, sourceFile, rawAddress) };
  }
  const referenceOperation = readRustReferenceOperation(walk, expression);
  if (referenceOperation !== undefined) {
    return {
      handled: true,
      ...resolvedRustReferenceOperationCarrier(
        walk,
        expression,
        sourceFile,
        referenceOperation,
        expected,
      ),
    };
  }
  const nativePointer = readRustSourceNativePointerOperation(
    sourceFacts,
    expression,
  );
  if (nativePointer !== undefined) {
    return {
      handled: true,
      ...resolvedNativePointerCarrier(
        walk,
        expression,
        sourceFile,
        nativePointer,
      ),
    };
  }
  const unsafeContext = readRustSourceUnsafeContext(sourceFacts, expression);
  if (unsafeContext !== undefined) {
    if (unsafeContext.kind === "remaining-block") {
      return {
        handled: true,
        carrier: setCarrierFact(walk, expression, rustUnitTargetType()),
      };
    }
    const carrier = resolveExpressionCarrier(
      walk,
      unsafeContext.expression,
      sourceFile,
      expected,
    );
    return {
      handled: true,
      ...(carrier === undefined
        ? {}
        : { carrier: setCarrierFact(walk, expression, carrier) }),
    };
  }
  if (readRustSourceSafetyBuilder(sourceFacts, expression) !== undefined) {
    return {
      handled: true,
      carrier: setCarrierFact(walk, expression, rustUnitTargetType()),
    };
  }
  return { handled: false };
}

function resolvedNativePointerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  source: import("@tsonic/source-core/facts").TsonicNativePointerOperationFact,
): { readonly carrier?: TargetTypeRef } {
  const pointerCarrier = resolveExpressionCarrier(
    walk,
    source.pointerExpression,
    sourceFile,
    undefined,
  );
  if (pointerCarrier?.kind !== "pointer") {
    appendRustDiagnostic(
      walk,
      "RUST_NATIVE_POINTER_OPERATION_NOT_MAPPED",
      `Rust native-pointer '${source.operation}' requires one exact native-pointer operand carrier.`,
      expression,
      ["target.capability=rust.native-pointer.exact-operand"],
    );
    return {};
  }
  if (source.explicitPointeeTypeNode !== undefined) {
    const explicitPointee = resolveRustTargetTypeRef(
      source.explicitPointeeTypeNode,
      rustResolutionContext(walk, source.explicitPointeeTypeNode),
      walk.operationOptions,
    );
    if (!rustTargetTypeRefEquals(explicitPointee, pointerCarrier.pointee)) {
      appendRustDiagnostic(
        walk,
        "RUST_NATIVE_POINTER_POINTEE_CONFLICT",
        "The authored pointee type and selected native-pointer operand do not have one exact Rust representation.",
        expression,
        ["target.capability=rust.native-pointer.exact-pointee"],
      );
      return {};
    }
  }
  let resultCarrier: TargetTypeRef;
  let fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>;
  switch (source.operation) {
    case "load":
      resultCarrier = pointerCarrier.pointee;
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.load",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        resultCarrier,
      };
      break;
    case "store": {
      const valueCarrier = resolveExactNativePointerOperandCarrier(
        walk,
        source.valueExpression,
        sourceFile,
        pointerCarrier.pointee,
      );
      if (!rustTargetTypeRefEquals(valueCarrier, pointerCarrier.pointee)) {
        appendRustDiagnostic(
          walk,
          "RUST_NATIVE_POINTER_STORE_VALUE_CONFLICT",
          "The selected native-pointer store value does not have the exact pointee carrier.",
          expression,
          ["target.capability=rust.native-pointer.exact-store"],
        );
        return {};
      }
      resultCarrier = rustUnitTargetType();
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.store",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        valueExpression: source.valueExpression,
        valueCarrier,
        resultCarrier,
      };
      break;
    }
    case "offset": {
      const nativeIntCarrier = rustSourcePrimitiveTargetType("native-int");
      const offsetCarrier = resolveExactNativePointerOperandCarrier(
        walk,
        source.offsetExpression,
        sourceFile,
        nativeIntCarrier,
      );
      if (!rustTargetTypeRefEquals(offsetCarrier, nativeIntCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_NATIVE_POINTER_OFFSET_TYPE_CONFLICT",
          "The selected native-pointer element offset is not exactly native-int in Rust.",
          expression,
          ["target.capability=rust.native-pointer.exact-offset"],
        );
        return {};
      }
      resultCarrier = pointerCarrier;
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.offset",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        offsetExpression: source.offsetExpression,
        offsetCarrier,
        resultCarrier,
      };
      break;
    }
  }
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/expressions/references.ts");
  walk.context.records.targetOperations.source(expression, fact);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

function resolveExactNativePointerOperandCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  contextualCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  return resolveExpressionCarrier(walk, expression, sourceFile, undefined) ??
    resolveExpressionCarrier(walk, expression, sourceFile, contextualCarrier);
}

export function selectedDeclarationIsProjectSource(walk: RustFactWalk, declaration: Node): boolean {
  const { ast } = walk.context;
  const kind = ast.kindName(declaration);
  if (kind.length === 0) {
    return false;
  }
  const sourceFile = ast.getSourceFile(declaration);
  return ast.getFileName(sourceFile).length > 0 && !ast.isDeclarationFile(sourceFile);
}

function applySelectedRuntimeCallableCall(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  selectedSignature: RustSelectedTargetSignature,
): TargetTypeRef | undefined {
  if (!isDenseDataArray(callArguments) || callArguments.some(argument => argument === undefined)) return undefined;
  const carrier = selectedSignature.sourceCallableCarrier;
  const genericNames = (selectedSignature.member.genericParameters ?? [])
    .flatMap(parameter => parameter.kind === "type" ? [{ kind: "type-parameter" as const,
      identity: parameter.targetIdentity, name: parameter.sourceName }] : []);
  const protocol = rustGenericCallableProtocol(carrier, genericNames) ??
    rustNativeCallableProtocol(carrier) ?? rustCallableProtocol(carrier);
  const finalized = finalizeProjectSourceGenericArguments(walk, selectedSignature, callArguments as readonly Node[], undefined);
  const genericBindings = finalized?.substitutions;
  const normalize = rustTypeFamilyNormalizer(walk.context.typeFamilies);
  const instantiate = (type: TargetTypeRef): TargetTypeRef => genericBindings === undefined ? type
    : substituteRustTargetGenerics(type, genericBindings.types, genericBindings.lifetimes, genericBindings.consts, normalize);
  const callable = protocol === undefined || genericBindings === undefined ? undefined : {
    parameters: protocol.parameters.map(instantiate), result: instantiate(protocol.result),
  };
  const bindings = selectedSignature.sourceArgumentBindings;
  const memberParameters = selectedSignature.member.parameters;
  const sourceParameterIndexes = selectedSignature.sourceCallableParameterIndexes;
  const selectedParameters = selectedSignature.sourceSelectedSignatureParameters;
  if (
    carrier === undefined ||
    callable === undefined ||
    bindings === undefined ||
    sourceParameterIndexes === undefined ||
    selectedParameters === undefined ||
    !isDenseDataArray(callArguments) ||
    callArguments.some((argument) => argument === undefined) ||
    (selectedSignature.sourceSelectedMethodTypeArguments?.length ?? 0) !==
      (selectedSignature.targetGenericArguments?.length ?? 0) ||
    selectedSignature.targetGenericArguments?.some(argument =>
      argument.kind !== (rustGenericCallableValue(carrier) === undefined ? "lifetime" : "type")) ||
    callable.parameters.length !== memberParameters.length ||
    sourceParameterIndexes.length !== memberParameters.length ||
    sourceParameterIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 ||
      !selectedParameters.some((parameter) => parameter.parameterIndex === index)) ||
    selectedSignature.member.returnType === undefined ||
    !rustTargetTypeRefEquals(callable.result, instantiate(selectedSignature.member.returnType))
  ) {
    appendRustDiagnostic(
      walk,
      "RUST_RUNTIME_CALLABLE_CONTRACT_CONFLICT",
      "The exact runtime-callable selection does not have one closed argument and result contract.",
      expression,
      ["target.capability=rust.source-call.runtime-callable"],
    );
    return undefined;
  }
  const consumedBindings = new Set<object>();
  const parameters = memberParameters.map((parameter, index) => {
    const parameterCarrier = callable.parameters[index];
    if (parameterCarrier === undefined ||
      !rustTargetTypeRefEquals(parameterCarrier, instantiate(parameter.type))) {
      return undefined;
    }
    const form = parameter.paramsArray === true
      ? "rest" as const
      : parameter.optional === true ? "optional" as const : "required" as const;
    const sourceParameter = selectedParameters.find(selected =>
      selected.parameterIndex === sourceParameterIndexes[index]);
    const declaration = asSourceNode(sourceParameter?.parameterDeclaration, walk.context.ast);
    const sourceAbi = declaration === undefined ? undefined
      : resolveRustContextualParameterAbi(declaration, parameterCarrier,
          rustResolutionContext(walk, declaration), walk.operationOptions);
    const borrowedAbi = sourceAbi !== undefined && form === "required" &&
      sourceAbi.mode !== "value" &&
      rustTargetTypeRefEquals(sourceAbi.parameterCarrier, parameterCarrier)
      ? sourceAbi : undefined;
    const valueCarrier = borrowedAbi?.valueCarrier ?? (form === "optional"
      ? rustOptionElementCarrier(parameterCarrier) ?? parameterCarrier
      : parameterCarrier);
    const selectedBindings = bindings.filter((binding) =>
      form === "rest"
        ? binding.sourceParameterIndex === sourceParameterIndexes[index]
        : binding.effectiveArgumentIndex === index);
    if ((form === "required" && selectedBindings.length !== 1) ||
      (form === "optional" && selectedBindings.length > 1)) {
      return undefined;
    }
    const inputs = selectedBindings.map((binding) => {
      consumedBindings.add(binding);
      const inputCarrier = form === "rest" &&
          binding.sourceParameterForm === "rest-element"
        ? callableRestElement(valueCarrier)
        : form === "optional" ? parameterCarrier : valueCarrier;
      return inputCarrier === undefined
        ? undefined
        : {
            sourceArgumentIndex: binding.sourceArgumentIndex,
            sourceForm: binding.sourceForm,
            sourceParameterForm: binding.sourceParameterForm,
            carrier: inputCarrier,
            ...(binding.spreadElementIndex === undefined
              ? {}
              : { spreadElementIndex: binding.spreadElementIndex }),
          };
    });
    return inputs.some((input) => input === undefined)
      ? undefined
      : {
          form,
          valueCarrier,
          parameterCarrier,
          mode: borrowedAbi?.mode ?? "value" as const,
          inputs: inputs as readonly NonNullable<typeof inputs[number]>[],
        };
  });
  if (parameters.some((parameter) => parameter === undefined) ||
    consumedBindings.size !== bindings.length) {
    appendRustDiagnostic(
      walk,
      "RUST_RUNTIME_CALLABLE_ARGUMENT_BINDING_CONFLICT",
      "The exact runtime-callable parameters do not form a total mapping over the checker-selected effective arguments.",
      expression,
      ["target.capability=rust.source-call.runtime-callable-bindings"],
    );
    return undefined;
  }
  const finalizedParameters = parameters as readonly NonNullable<
    typeof parameters[number]
  >[];
  const runtimeValue = selectedSignature.sourceStructuralMethod === undefined && selectedSignature.sourceConstructorCarrier === undefined;
  const calleeCarrier = runtimeValue ? resolveExpressionCarrier(walk, callee, sourceFile, carrier) : undefined;
  if (runtimeValue && calleeCarrier === undefined) return undefined;
  const genericInvocation = rustGenericCallableValue(carrier);
  const signatureOnly = carrier.kind === "target-named" && rustCallableProtocol(carrier)?.lifetime?.kind === "placeholder" ||
    genericInvocation !== undefined && genericInvocation.physical === undefined && genericInvocation.retainedEnvironment.length === 0;
  const invocationCarrier = signatureOnly && calleeCarrier !== undefined && rustCallableInvocationSignaturesMatch(calleeCarrier, carrier)
    ? calleeCarrier : carrier;
  const arguments_ = prepareSelectedSourceCallArguments(
    walk,
    callArguments as readonly Node[],
    sourceFile,
    finalizedParameters,
    bindings,
  );
  if (arguments_ === undefined) return undefined;
  const resultCarrier = rustSourceCallResultWithInputLifetimes(callable.result,
    finalizedParameters.map(parameter => parameter.parameterCarrier), bindings,
    rustSourceCallArgumentCarriers(expression, walk.context.ast, walk.context.records));
  if (!retainRustSelectedSourceCallResultStorage(selectedSignature, finalized!.targetGenericArguments,
    resultCarrier, rustResolutionContext(walk, expression), walk.operationOptions)) {
    appendRustDiagnostic(walk, "RUST_RUNTIME_CALLABLE_RESULT_STORAGE_MISSING",
      "The selected runtime-callable result has no exact instantiated structural storage correspondence.",
      expression, ["target.capability=rust.source-call.result-storage"]);
    return undefined;
  }
  let selectedOptional: Extract<ReturnType<typeof selectRustOptionalCallResult>, { readonly kind: "resolved" }>["fact"];
  if (runtimeValue) {
    const source = walk.context.semantics(sourceFile).operations.call(expression);
    if (source === undefined || calleeCarrier === undefined) return undefined;
    const declaration = walk.context.semantics(sourceFile).declarations.signatureDeclaration(source.selectedSignature);
    const optionalInvocation = walk.context.ast.as.AsCallExpression(expression)?.QuestionDotToken !== undefined;
    const optionalResult = selectRustOptionalCallResult(
      { source, ...(declaration === undefined ? {} : { sourceSelectedDeclaration: declaration }) },
      resultCarrier, rustOperationContext(walk, expression), walk.operationOptions,
      optionalInvocation ? { guard: callee, sourceGuardCarrier: calleeCarrier, selectedGuardCarrier: carrier } : undefined,
    );
    if (optionalResult.kind === "rejected") {
      appendRustDiagnostic(walk, "RUST_OPTIONAL_CALL_CONTRACT_INVALID", optionalResult.message,
        expression, ["target.capability=rust.optional-call.exact-callee"]);
      return undefined;
    }
    selectedOptional = optionalResult.fact;
  }
  const optionalCall = selectedOptional ?? walk.context.records.optionalChain.get(expression);
  if (optionalCall !== undefined &&
    (!rustTargetTypeRefEquals(optionalCall.innerResultCarrier, resultCarrier) ||
      optionalCall.operationKind !== "method")) {
    appendRustDiagnostic(
      walk,
      "RUST_OPTIONAL_CALL_RESULT_CONFLICT",
      "The finalized optional call conflicts with the exact selected runtime-callable result carrier.",
      expression,
      ["target.capability=rust.optional-call.exact-result"],
    );
    return undefined;
  }
  const finalResultCarrier = optionalCall?.resultCarrier ?? resultCarrier;
  const computedKey = recordRustComputedCallEvaluation(walk.context.ast, walk.context.records, walk.context.requiredRecords,
    walk.context.semanticsFor(expression).operations.call(expression), callee, true);
  if (computedKey !== undefined &&
    resolveExpressionCarrier(walk, computedKey, sourceFile, undefined) === undefined) return undefined;
  const structuralMethod = selectedSignature.sourceStructuralMethod;
  if (structuralMethod !== undefined && (
    selectedSignature.sourceSelectedReceiverCarrier === undefined ||
    !rustTargetTypeRefEquals(
      structuralMethod.receiverCarrier,
      selectedSignature.sourceSelectedReceiverCarrier,
    ) || structuralMethod.storageIndex < 0 ||
    !Number.isSafeInteger(structuralMethod.storageIndex)
  )) {
    appendRustDiagnostic(
      walk,
      "RUST_STRUCTURAL_METHOD_SELECTION_CONFLICT",
      "The exact structural-method selection has an invalid receiver or storage identity.",
      expression,
      ["target.capability=rust.source-call.structural-method"],
    );
    return undefined;
  }
  const target: Extract<
    RustTargetOperationFact,
    { readonly kind: "source-call" }
  >["target"] = selectedSignature.sourceConstructorCarrier !== undefined
    ? { form: "constructor-value", receiverCarrier: selectedSignature.sourceConstructorCarrier, callableCarrier: carrier }
    : structuralMethod === undefined
    ? { form: "callable", carrier: invocationCarrier }
    : {
        form: "structural-method",
        receiverCarrier: structuralMethod.receiverCarrier,
        storageIndex: structuralMethod.storageIndex,
        callableCarrier: carrier,
      };
  if (target.form === "callable" && optionalCall === undefined) {
    const admitted = walk.context.records.flowReadProjection.get(callee);
    const projection = admitted === undefined
      ? calleeCarrier === undefined ? undefined : walk.context.records.flowReadProjections.resolve(
        walk.context.requiredRecords, callee, calleeCarrier, invocationCarrier, walk.context.projectTypes, walk.context.typeDefinitions)
      : { kind: "projection" as const, fact: admitted };
    if (projection === undefined || projection.kind === "incompatible" ||
      projection.kind === "projection" && !rustTargetTypeRefEquals(projection.fact.selectedCarrier, invocationCarrier)) {
      appendRustDiagnostic(walk, "RUST_RUNTIME_CALLABLE_VALUE_CONFLICT",
        "The runtime callee cannot project to its exact checked callable carrier.", callee,
        ["target.capability=rust.source-call.runtime-callable-value"]);
      return undefined;
    }
  } else if (target.form === "constructor-value" &&
    resolveExpressionCarrier(walk, callee, sourceFile, target.receiverCarrier) === undefined) return undefined;
  const completed = setCarrierFact(walk, expression, finalResultCarrier);
  if (completed === undefined) return undefined;
  recordSelectedSourceCallArguments(walk, arguments_);
  if (selectedOptional !== undefined) {
    requireRustRecord(walk.context.requiredRecords, "optionalChain", expression, selectedOptional.operationKind, "analysis/expressions/references.ts");
    walk.context.records.optionalChains.guard(expression, selectedOptional.guard,
      selectedOptional.operationKind, selectedOptional);
  }
  requireRustRecord(walk.context.requiredRecords, "selectedOperation", expression, "source-call", "applySelectedRuntimeCallableCall");
  walk.context.records.selectedOperations.project(
    expression,
    selectedSignature.member.id,
    "method",
    target.form,
    finalResultCarrier,
  );
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "source-call", "analysis/expressions/references.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "source-call",
    operationId: selectedSignature.member.id,
    target,
    parameters: finalizedParameters,
    resultCarrier,
    ...(finalized === undefined || finalized.targetGenericArguments.length === 0 ? {} : {
      targetGenericArguments: finalized.targetGenericArguments,
    }),
  });
  return completed;
}
