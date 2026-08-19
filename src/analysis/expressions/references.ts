import {
  KindExportAssignment,
  KindFunctionDeclaration,
  KindBindingElement,
  KindParameter,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
  Node_Type,
  asSourceNode,
} from "@tsonic/target-api/source";
import {
  rustOptionalChainFactKey,
  rustPreparedOperationResultFactKey,
  rustSourceBindingFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceCallableValueFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import {
  rustOptionElementCarrier,
  rustCallableProtocol,
  rustCallableTargetType,
  rustSourcePrimitiveTargetType,
  rustUnitTargetType,
} from "../../policy/types/target-types.js";
import { appendRustDiagnostic, rustOperationContext, rustResolutionContext } from "../program/walk.js";
import { applySelectedProjectSourceCall, applySelectedSourceCallArguments, recordTargetOperation, setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { declarationIsModuleScoped } from "../callables/closures.js";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import { prepareRustDeferredCheckedCall } from "../operations/provider/index.js";
import { readRustSourceNativePointerOperation, readRustSourceSafetyBuilder, readRustSourceUnsafeContext } from "../../policy/safety/source-explicit-safety.js";
import { recordExportAssignmentFacts, resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { resolveExpressionCarrier } from "./carriers.js";
import { resolveRustExactNullishValueCarrier, resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustPolicyTargetDiagnostic } from "../../policy/operations/contracts.js";
import { rustRuntimeCarrierKey, rustSelectedCallKey } from "../../policy/model/selections.js";
import { rustSourceParameterContractCarrier } from "../../policy/ownership/source-callable-abi.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { tryFlowMarkerCall } from "../declarations/types-and-bindings.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSelectedTargetSignature, TargetTypeRef } from "../../policy/types/model.js";
import type { RustSourceBindingFact, RustTargetOperationFact } from "../facts/keys.js";

export function resolveIdentifierCarrier(walk: RustFactWalk, identifier: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const reference = walk.context.source.navigation.sourceReferenceFor(identifier);
  const declaration = reference?.declaration;
  if (reference !== undefined && declaration !== undefined && reference.project) {
    const declarationKind = ast.kindName(declaration);
    recordProjectSourceBinding(walk, identifier);
    if (declarationKind === KindExportAssignment) {
      const exportCarrier = recordExportAssignmentFacts(walk, declaration);
      if (exportCarrier !== undefined) {
        return setCarrierFact(walk, identifier, exportCarrier);
      }
    }
    if (declarationKind === KindParameter) {
      const parameterAbi = walk.context.facts.get(declaration, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(declaration, rustSourceParameterAbiFactKey);
      if (parameterAbi !== undefined) {
        walk.context.facts.set(identifier, rustSourceParameterAbiFactKey, parameterAbi, [
          { message: "rust project-source parameter ABI use" },
        ]);
      }
    }
    const declarationCarrier = walk.context.facts.get(declaration, rustRuntimeCarrierKey);
    if (declarationCarrier !== undefined) {
      return setCarrierFact(walk, identifier, declarationCarrier.carrier);
    }
    if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration ||
      declarationKind === KindBindingElement) {
      const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
      if (annotated !== undefined) {
        setCarrierFact(walk, declaration, annotated);
        return setCarrierFact(walk, identifier, annotated);
      }
      const initializer = Node_Initializer(walk.context.ast, declaration);
      if (initializer !== undefined) {
        const initializerCarrier = resolveExpressionCarrier(walk, initializer, sourceFile, undefined);
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
        : walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
          walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey));
      const returnCarrier = walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
        walk.context.facts.resolve(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
      const name = ast.name(declaration);
      const targetName = walk.context.names.functionNameForDeclaration(declaration);
      if (name !== undefined && parameterAbis.every((abi) => abi !== undefined) &&
        returnCarrier !== undefined && targetName !== undefined) {
        const closedParameterAbis = parameterAbis as import("../facts/keys.js").RustSourceParameterAbiFact[];
        const callableCarrier = rustCallableTargetType(
          closedParameterAbis.map(rustSourceParameterContractCarrier),
          returnCarrier,
        );
        walk.context.facts.set(identifier, rustSourceCallableValueFactKey, {
          form: "function",
          sourceDeclaration: declaration,
          fileName: ast.getFileName(ast.getSourceFile(declaration)),
          name: targetName,
          carrier: callableCarrier,
          parameterCarriers: closedParameterAbis.map((abi) => abi.parameterCarrier),
          argumentModes: closedParameterAbis.map((abi) => abi.mode),
          resultCarrier: returnCarrier,
        }, [{ message: "rust exact project-source callable value" }]);
        return setCarrierFact(walk, identifier, callableCarrier);
      }
    }
  }
  const semantics = walk.context.semantics(sourceFile);
  const semanticType = semantics.getTypeAtLocation(identifier);
  const nullishCarrier = semanticType !== undefined && semantics.isNullish(semanticType)
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
  const binding: RustSourceBindingFact = declarationIsModuleScoped(declaration, ast)
    ? {
        scope: "module",
        sourceName,
        fileName: ast.getFileName(ast.getSourceFile(declaration)),
        sourceDeclaration: declaration,
      }
    : { scope: "lexical", sourceName, sourceDeclaration: declaration };
  walk.context.facts.set(identifier, rustSourceBindingFactKey, binding, [
    { message: `rust project-source ${binding.scope} binding` },
  ]);
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
      walk.context.diagnostics.push(
        rustPolicyTargetDiagnostic(prepared.diagnostic),
      );
      return undefined;
    }
    walk.preparedCallbackCalls.set(expression, {
      request: deferred.request,
      prepared: prepared.value,
    });
    walk.context.facts.set(expression, rustPreparedOperationResultFactKey, {
      operationId: prepared.value.template.operationId,
      operationKind: prepared.value.template.operationKind,
      resultCarrier: prepared.value.resultCarrier,
    }, [{ message: "rust exact prepared callback operation result" }]);
    return setCarrierFact(walk, expression, prepared.value.resultCarrier);
  }
  const selectedSignature = walk.context.facts.get(expression, rustSelectedCallKey) ??
    walk.context.facts.resolve(expression, rustSelectedCallKey);
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
  return readRustSourceNativePointerOperation(sourceFacts, expression) !== undefined ||
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
  setRustOperationFact(walk, expression, fact);
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
  const carrier = selectedSignature.sourceCallableCarrier;
  const callable = carrier?.kind === "function-pointer"
    ? { parameters: carrier.args, result: carrier.result }
    : rustCallableProtocol(carrier);
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
    (selectedSignature.sourceSelectedMethodTypeArguments?.length ?? 0) !== 0 ||
    (selectedSignature.targetTypeArguments?.length ?? 0) !== 0 ||
    callable.parameters.length !== memberParameters.length ||
    sourceParameterIndexes.length !== memberParameters.length ||
    sourceParameterIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 ||
      !selectedParameters.some((parameter) => parameter.parameterIndex === index)) ||
    !rustTargetTypeRefEquals(callable.result, selectedSignature.member.returnType)
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
      !rustTargetTypeRefEquals(parameterCarrier, parameter.type)) {
      return undefined;
    }
    const form = parameter.paramsArray === true
      ? "rest" as const
      : parameter.optional === true ? "optional" as const : "required" as const;
    const valueCarrier = form === "optional"
      ? rustOptionElementCarrier(parameterCarrier) ?? parameterCarrier
      : parameterCarrier;
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
        ? valueCarrier.kind === "array" ? valueCarrier.element : undefined
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
          mode: "value" as const,
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
  if (!applySelectedSourceCallArguments(
    walk,
    callArguments as readonly Node[],
    sourceFile,
    finalizedParameters,
    bindings,
  )) {
    return undefined;
  }
  const optionalCall = walk.context.facts.get(expression, rustOptionalChainFactKey) ??
    walk.context.facts.resolve(expression, rustOptionalChainFactKey);
  if (optionalCall !== undefined &&
    (!rustTargetTypeRefEquals(optionalCall.innerResultCarrier, callable.result) ||
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
  const finalResultCarrier = optionalCall?.resultCarrier ?? callable.result;
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
  >["target"] = structuralMethod === undefined
    ? { form: "callable", carrier }
    : {
        form: "structural-method",
        receiverCarrier: structuralMethod.receiverCarrier,
        storageIndex: structuralMethod.storageIndex,
        callableCarrier: carrier,
      };
  recordTargetOperation(
    walk,
    expression,
    selectedSignature.member.id,
    "method",
    target.form,
    finalResultCarrier,
  );
  setRustOperationFact(walk, expression, {
    kind: "source-call",
    operationId: selectedSignature.member.id,
    target,
    parameters: finalizedParameters,
    resultCarrier: callable.result,
  });
  if (target.form === "callable") {
    resolveExpressionCarrier(walk, callee, sourceFile, carrier);
  }
  return setCarrierFact(walk, expression, finalResultCarrier);
}
