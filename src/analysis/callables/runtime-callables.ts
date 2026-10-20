import { requireRustRecord } from "../program/records/required-records.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { finalizeProjectSourceGenericArguments } from "../operations/project-call-generics.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";
import { asSourceNode } from "@tsonic/target-api/source";

import { rustOptionElementCarrier, rustCallableProtocol, rustNativeCallableProtocol, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { appendRustDiagnostic, rustOperationContext, rustResolutionContext } from "../program/walk.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { prepareSelectedSourceCallArguments, recordSelectedSourceCallArguments } from "../operations/source-call-arguments.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";

import { recordRustComputedCallEvaluation } from "../operations/computed-members.js";

import { resolveExpressionCarrier } from "../expressions/carriers.js";

import { selectRustOptionalCallResult } from "../operations/provider/calls/optional-results.js";

import { resolveRustContextualParameterAbi } from "./source-callable-abi.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSelectedTargetSignature, TargetTypeRef } from "../../target-model/types/model.js";

import type { RustTargetOperationFact } from "../../target-model/records/operations.js";

import { rustSourceCallArgumentCarriers, rustSourceCallResultWithInputLifetimes } from "../callables/source-call-lifetimes.js";
import { retainRustSelectedSourceCallResultStorage } from "../../policy/types/resolution/call-results.js";
import { callableRestElement } from "../../target-model/records/callable-adapters.js";

export function applySelectedRuntimeCallableCall(
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
    ? { form: "callable", carrier }
    : {
        form: "structural-method",
        receiverCarrier: structuralMethod.receiverCarrier,
        storageIndex: structuralMethod.storageIndex,
        callableCarrier: carrier,
      };
  if (target.form === "callable" && optionalCall === undefined) {
    const projection = calleeCarrier === undefined ? undefined : walk.context.records.flowReadProjections.resolve(
      walk.context.requiredRecords, callee, calleeCarrier, carrier, walk.context.projectTypes, walk.context.typeDefinitions);
    if (projection === undefined || projection.kind === "incompatible") {
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
