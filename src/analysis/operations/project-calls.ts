import { selectRustProjectSourceCallTarget } from "./source-call-targets.js";
import { prepareSelectedSourceCallArguments, recordSelectedSourceCallArguments, type RustSourceCallParameterRequest } from "./source-call-arguments.js";
import { rustTargetGenericTypeArguments, substituteRustTargetGenerics, isRustProgramErrorCarrier, rustJsArrayLikeElementTargetType } from "../../target-model/types/index.js";
import { KindFunctionDeclaration, Node_Type } from "@tsonic/target-api/source";

import { appendMalformedSourceAst } from "../declarations/project-types.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";

import { resolveParameterAbi } from "../callables/values/parameter-facts.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";
import { realizeRustSelectedTypeFamilies } from "./type-family-applications.js";
import { finalizeProjectSourceGenericArguments } from "./project-call-generics.js";
import { instantiateRustSourceParameterValueCarrier } from "../../policy/ownership/source-parameter-contracts.js";
import { retainRustStructuralInstantiation } from "../source-evidence/types/resolution/structural-instantiations.js";
import { bindRustSelectedCallTypeArguments } from "../source-evidence/types/resolution/generic-arguments.js";

import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetSignature } from "../../target-model/records/operations/member-selections.js";

import { retainRustSelectedCallableResultTemplate, retainRustSelectedSourceCallResultStorage, selectRustSourceCallResult } from "../source-evidence/types/resolution/call-results.js";
import { rustSourceCallArgumentCarriers, rustSourceCallResultWithInputLifetimes } from "../callables/ownership/source-call-lifetimes.js";
import { rustRetainedCallLifetimes, rustRetainedCallResult } from "../callables/ownership/retained-environments.js";
import { rustRetainedEnvironment } from "../callables/ownership/retained-values.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey, rustPlaceholderLifetime } from "../../target-model/lifetimes/index.js";

import { recordRustComputedCallEvaluation } from "./computed-members.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { rustPromiseBodyInvocationCarrier } from "../callables/async/promise-bodies.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import { rustFixedArrayCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustTargetConstInteger } from "../../target-model/types/generic-arguments.js";
import { acceptRustPolicy } from "../../policy/model/contracts.js";
import { selectedRustSourceCallOperation } from "../program/records/calls/selected-call.js";

export function applySelectedProjectSourceCall(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expressionKind: string,
  selectedDeclaration: Node,
  selectedSignature: RustSelectedTargetSignature,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const sourceCall = walk.context.semanticsFor(expression).operations.call(expression);
  if (sourceCall === undefined || sourceCall.call !== expression ||
    sourceCall.selectedSignature !== selectedSignature.sourceSignature) {
    appendRustDiagnostic(walk, "RUST_SOURCE_CALL_BINDINGS_MISSING",
      "Selected project-source call requires its identical original checked invocation and signature.", expression,
      ["target.capability=rust.source-call.argument-bindings"]);
    return undefined;
  }
  const selectedMember = selectedSignature.member;
  if (!isDenseDataArray(callArguments) || callArguments.some((argument) => argument === undefined)) {
    appendMalformedSourceAst(walk, "Checked project-source call contains an undefined or non-data argument slot.");
    return undefined;
  }
  if (!retainRustSelectedCallableResultTemplate(selectedSignature, rustResolutionContext(walk, expression), walk.operationOptions)) {
    appendRustDiagnostic(walk, "RUST_SOURCE_CALL_CALLABLE_RESULT_STORAGE_MISSING",
      "The selected callable invocation has no exact rebound structural result storage.", expression,
      ["target.capability=rust.source-call.callable-result-storage"]);
    return undefined;
  }
  const genericInstantiation = finalizeProjectSourceGenericArguments(
    walk,
    selectedSignature,
    callArguments as readonly Node[],
    expected,
  );
  if (genericInstantiation === undefined) {
    return undefined;
  }
  const { substitutions, targetGenericArguments } = genericInstantiation;
  if (!realizeRustSelectedTypeFamilies(walk, expression, selectedSignature, targetGenericArguments)) return undefined;
  const normalizeTypeFamily = rustTypeFamilyNormalizer(walk.context.typeFamilies);
  const targetTypeArguments = rustTargetGenericTypeArguments(targetGenericArguments);
  const bindings = selectedSignature.sourceArgumentBindings;
  const selectedParameters = selectedSignature.sourceSelectedSignatureParameters;
  if (bindings === undefined || selectedParameters === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_SOURCE_CALL_BINDINGS_MISSING",
      "Selected project-source call has no exact checker-selected argument binding evidence.",
      expression,
      ["target.capability=rust.source-call.argument-bindings"],
    );
    return undefined;
  }
  const declarationParameters = selectedSignature.nativeParameterDeclarations;
  const storageContext = bindRustSelectedCallTypeArguments(
    selectedSignature.sourceSelectedMethodTypeArguments ?? [], targetGenericArguments,
    rustResolutionContext(walk, expression),
  );
  if (storageContext === undefined) {
    appendRustDiagnostic(walk, "RUST_SOURCE_CALL_TYPE_ARGUMENT_IDENTITY_MISSING",
      "Selected source type arguments require exact, distinct parameter declarations.", expression,
      ["target.capability=rust.source-call.parameter-storage"]);
    return undefined;
  }
  let parameters: RustSourceCallParameterRequest[] = [];
  for (const [index, targetParameter] of selectedMember.parameters.entries()) {
    const selectedParameter = selectedParameters[index];
    const parameterDeclaration = declarationParameters[index];
    let parameterAbi = parameterDeclaration === undefined
      ? undefined
      : resolveParameterAbi(walk, parameterDeclaration);
    const owner = selectedSignature.sourceSelectedOwnerCarrier;
    if (parameterAbi !== undefined && parameterDeclaration !== undefined && owner !== undefined) {
      const parameterCarrier = walk.context.projectTypes.instantiateMemberCarrier(
        parameterDeclaration, owner, parameterAbi.parameterCarrier,
      );
      const valueCarrier = walk.context.projectTypes.instantiateMemberCarrier(
        parameterDeclaration, owner, parameterAbi.valueCarrier,
      );
      parameterAbi = parameterCarrier === undefined || valueCarrier === undefined
        ? undefined : { ...parameterAbi, parameterCarrier, valueCarrier };
    }
    const parameterInputs = bindings.filter((binding) =>
      binding.sourceParameterIndex === index);
    if (parameterAbi === undefined ||
      (selectedParameter !== undefined && selectedParameter.parameterIndex !== index) ||
      (selectedParameter === undefined &&
        (parameterInputs.length !== 0 || parameterAbi.form === "required"))) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_MISSING",
        `Project-source call selects unavailable parameter ${index}.`,
        expression,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    if (selectedParameter !== undefined &&
      (parameterAbi.form === "rest") !== selectedParameter.rest) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_FORM_CONFLICT",
        `Project-source parameter ${index} conflicts with its exact checker-selected omission or rest evidence.`,
        parameterDeclaration ?? expression,
        ["target.capability=rust.source-call.parameter-form"],
      );
      return undefined;
    }
    const parameterCarrier = substituteRustTargetGenerics(
      targetParameter.type,
      substitutions.types,
      substitutions.lifetimes,
      substitutions.consts,
      normalizeTypeFamily,
    );
    if (isRustProgramErrorCarrier(parameterCarrier)) {
      const ownerFile = ast.getSourceFile(selectedDeclaration);
      const componentFor = (file: SourceFile | undefined) => file === undefined ? undefined :
        walk.context.sourcePackages.packages.find(entry => entry.sourceFiles.includes(ast.getFileName(file)))?.componentId;
      const owner = componentFor(ownerFile);
      if (owner === undefined || owner !== componentFor(sourceFile)) {
        appendRustDiagnostic(walk, "RUST_SOURCE_ERROR_PARAMETER_DOMAIN_CONFLICT",
          "Exception forwarding requires the exact owning source-package error domain; reverse conversion from an unrelated error domain is not proven.",
          expression, ["target.capability=rust.source-call.error-parameter-domain"]);
        return undefined;
      }
    }
    const valueCarrier = instantiateRustSourceParameterValueCarrier(
      parameterAbi,
      parameterCarrier,
      substitutions,
      normalizeTypeFamily,
    );
    if (valueCarrier === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_INSTANTIATION_CONFLICT",
        `Project-source parameter ${index} does not match its exact selected ABI.`,
        expression,
        ["target.capability=rust.source-call.parameter-instantiation"],
      );
      return undefined;
    }
    const selectedValueType = parameterAbi.form === "default" && selectedParameter !== undefined
      ? walk.context.semantics(sourceFile).types.withoutMissingOrUndefined(selectedParameter.selectedType)
      : selectedParameter?.selectedType;
    if (selectedParameter !== undefined && (selectedValueType === undefined || !retainRustStructuralInstantiation(
      selectedValueType, parameterAbi.valueCarrier, valueCarrier,
      storageContext, walk.operationOptions, new Set(), selectedParameter.authoredTypeNode))) {
      appendRustDiagnostic(walk, "RUST_SOURCE_CALL_PARAMETER_STORAGE_MISSING",
        "The selected source parameter type has no exact instantiated structural storage correspondence.",
        expression, ["target.capability=rust.source-call.parameter-storage"]);
      return undefined;
    }
    const mode = targetParameter.passingMode === "borrow-mut"
      ? "mut-ref" as const
      : targetParameter.passingMode === "borrow-shared"
        ? "ref" as const
        : "value" as const;
    const tupleRest = parameterAbi.form === "rest" && valueCarrier.kind === "tuple" ? valueCarrier : undefined;
    const fixedRest = parameterAbi.form === "rest" ? rustFixedArrayCarrierValue(valueCarrier) : undefined;
    const inputs = parameterInputs.map((binding, inputIndex) => {
      const carrier = parameterAbi.form === "rest" &&
          binding.sourceParameterForm === "rest-element"
        ? tupleRest !== undefined || fixedRest !== undefined ? rustSpreadElementCarrier(valueCarrier, inputIndex)
          : valueCarrier.kind === "array" ? valueCarrier.element : rustJsArrayLikeElementTargetType(valueCarrier)
        : parameterAbi.form === "default" || parameterAbi.form === "optional" && mode === "value"
          ? parameterCarrier
          : valueCarrier;
      return carrier === undefined
        ? undefined
        : {
            sourceArgumentIndex: binding.sourceArgumentIndex,
            sourceForm: binding.sourceForm,
            sourceParameterForm: binding.sourceParameterForm,
            carrier,
            ...(binding.spreadElementIndex === undefined
              ? {}
              : { spreadElementIndex: binding.spreadElementIndex }),
          };
    });
    const wholeTupleSequence = (tupleRest !== undefined || fixedRest !== undefined) && parameterInputs.length === 1 &&
      parameterInputs[0]?.sourceParameterForm === "rest-sequence";
    const fixedRestLength = fixedRest === undefined ? undefined : rustTargetConstInteger(fixedRest.length);
    const omittedTupleElements = tupleRest === undefined || wholeTupleSequence ? [] : tupleRest.elements.slice(inputs.length);
    const authoredRestType = omittedTupleElements.length === 0 || parameterDeclaration === undefined ? undefined
      : Node_Type(ast, parameterDeclaration);
    const checkedRestType = authoredRestType === undefined ? undefined : storageContext.currentSemantics.types.authoredType(authoredRestType);
    const checkedTupleElements = checkedRestType === undefined ? undefined : storageContext.currentSemantics.types.tupleElementInfos(checkedRestType);
    if (inputs.some((input) => input === undefined) ||
      (parameterAbi.form !== "rest" && inputs.length > 1) ||
      (parameterAbi.form === "required" && inputs.length !== 1) ||
      (fixedRest !== undefined && !wholeTupleSequence && (fixedRestLength === undefined ||
        BigInt(inputs.length) !== fixedRestLength || parameterInputs.some(binding => binding.sourceParameterForm !== "rest-element"))) ||
      (tupleRest !== undefined && !wholeTupleSequence && (inputs.length > tupleRest.elements.length ||
        parameterInputs.some(binding => binding.sourceParameterForm !== "rest-element") ||
        omittedTupleElements.length !== 0 && (checkedTupleElements?.length !== tupleRest.elements.length ||
          checkedTupleElements.slice(inputs.length).some(element => element.elementKind !== "optional"))))) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_BINDING_CONFLICT",
        `Project-source parameter ${index} has no total exact effective-argument plan.`,
        parameterDeclaration ?? expression,
        ["target.capability=rust.source-call.parameter-bindings"],
      );
      return undefined;
    }
    parameters.push({
      form: parameterAbi.form,
      valueCarrier,
      parameterCarrier,
      mode,
      ...(parameterAbi.inputLifetime === undefined ? {} : { inputLifetime: parameterAbi.inputLifetime }),
      inputs: inputs as NonNullable<(typeof inputs)[number]>[],
    });
  }
  const declaredResultCarrier = selectedMember.returnType;
  const genericResultCarrier = declaredResultCarrier === undefined
    ? undefined
    : substituteRustTargetGenerics(
        declaredResultCarrier,
        substitutions.types,
        substitutions.lifetimes,
        substitutions.consts,
        normalizeTypeFamily,
      );
  if (genericResultCarrier === undefined) {
    return undefined;
  }
  const declarationKind = ast.kindName(selectedDeclaration);
  const operationId = selectedMember.id;
  const selectedTarget = selectRustProjectSourceCallTarget({ walk, expression, callee, sourceFile, expressionKind,
    selectedDeclaration, selectedSignature, genericResultCarrier, substitutions, targetTypeArguments, declarationKind,
    normalizeTypeFamily });
  if (selectedTarget === undefined) return undefined;
  const { target, operationKind, directLexical, optionalCall, callable } = selectedTarget;
  const callDeclarations = target.form === "union-method" ? target.variants.map(variant => variant.declaration)
    : declarationKind === KindFunctionDeclaration || declarationKind === "KindMethodDeclaration" || directLexical ? [selectedDeclaration] : [];
  for (const declaration of callDeclarations) {
    const registration = walk.context.sourceCallableSpecializations.recordSourceCall({
      subject: expression,
      ...(walk.currentCallableDeclaration === undefined
        ? {}
        : { caller: walk.currentCallableDeclaration }),
      callee: declaration,
      targetTypeArguments,
      ast,
      sourceLifetimes: walk.context.sourceLifetimes,
    });
    if (registration.kind === "rejected") {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALLABLE_SPECIALIZATION_EVIDENCE_CONFLICT",
        registration.reason,
        expression,
        ["target.capability=rust.source-callable.exact-call-graph"],
      );
      return undefined;
    }
  }
  if (target.form === "callable") {
    if (callable !== undefined) {
      if (callable.parameters.length !== parameters.length) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_CALLABLE_ARITY_CONFLICT",
          "The exact runtime-callable carrier conflicts with the selected source parameter count.",
          expression,
          ["target.capability=rust.source-call.callable-abi"],
        );
        return undefined;
      }
      const callableResult = substituteRustTargetGenerics(
        callable.result,
        substitutions.types,
        substitutions.lifetimes,
        substitutions.consts,
        normalizeTypeFamily,
      );
      if (!rustTargetTypeRefEquals(callableResult, genericResultCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_CALLABLE_RESULT_CONFLICT",
          "The exact runtime-callable carrier conflicts with the selected source result ABI.",
          expression,
          ["target.capability=rust.source-call.callable-abi"],
        );
        return undefined;
      }
      const callableParameters = parameters.map((parameter, index) => {
        const carrier = callable.parameters[index];
        const instantiatedCarrier = carrier === undefined
          ? undefined
          : substituteRustTargetGenerics(
              carrier,
              substitutions.types,
              substitutions.lifetimes,
              substitutions.consts,
              normalizeTypeFamily,
            );
        const contractCarrier = parameter.mode === "value"
          ? parameter.parameterCarrier
          : parameter.valueCarrier;
        return instantiatedCarrier !== undefined &&
            rustTargetTypeRefEquals(instantiatedCarrier, contractCarrier)
          ? { ...parameter, parameterCarrier: instantiatedCarrier, mode: "value" as const }
          : undefined;
      });
      if (callableParameters.some((parameter) => parameter === undefined)) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_CALLABLE_PARAMETER_CONFLICT",
          "The exact runtime-callable carrier conflicts with the selected source parameter ABI.",
          expression,
          ["target.capability=rust.source-call.callable-abi"],
        );
        return undefined;
      }
      parameters = callableParameters as RustSourceCallParameterRequest[];
    }
  }
  const invocationReferences = rustTargetGenericReferences({ kind: "tuple",
    elements: [...parameters.map(parameter => parameter.parameterCarrier), genericResultCarrier] });
  const environment = invocationReferences.lifetimes.length === 0 ? { kind: "none" as const }
    : rustRetainedEnvironment(selectedDeclaration, parameters.map(parameter => parameter.parameterCarrier), walk.context);
  if (environment.kind === "unresolved") {
    appendRustDiagnostic(walk, "RUST_RETAINED_ENVIRONMENT_NOT_EXACT", environment.reason, expression,
      ["target.capability=rust.source-call.retained-environment"]);
    return undefined;
  }
  if (environment.kind === "selected" && invocationReferences.lifetimeIdentities.includes(rustLifetimeKey(environment.environment.lifetime))) {
    const identity = rustLifetimeKey(environment.environment.lifetime);
    for (const [index, argument] of (callArguments as readonly Node[]).entries()) {
      const carriers = parameters.flatMap(parameter => parameter.inputs.filter(input => input.sourceArgumentIndex === index)
        .map(input => input.carrier));
      // An input that names the callee retained lifetime is expected at its exact shape with that lifetime still
      // open: the call selects it below from the argument storage, so the argument does not fall back to its source
      // type (an unannotated async callback would otherwise read its parameters as number).
      const expected = carriers.length !== 0 && carriers.every(carrier => rustTargetTypeRefEquals(carrier, carriers[0]))
        ? rustRetainedCallResult(carriers[0]!, new Map([[identity, rustPlaceholderLifetime]])) : undefined;
      if (resolveExpressionCarrier(walk, argument, sourceFile, expected, "operation") === undefined) return undefined;
    }
  }
  const retainedLifetimes = rustRetainedCallLifetimes(walk, expression, selectedDeclaration,
    parameters.map(parameter => parameter.parameterCarrier), genericResultCarrier);
  if (retainedLifetimes === undefined) {
    appendRustDiagnostic(walk, "RUST_RETAINED_ENVIRONMENT_NOT_EXACT",
      "The selected source call has no exact retained native environment lifetime.", expression,
      ["target.capability=rust.source-call.retained-environment"]);
    return undefined;
  }
  if (retainedLifetimes.size !== 0) parameters = parameters.map(parameter => ({ ...parameter,
    valueCarrier: rustRetainedCallResult(parameter.valueCarrier, retainedLifetimes),
    parameterCarrier: rustRetainedCallResult(parameter.parameterCarrier, retainedLifetimes),
    inputs: parameter.inputs.map(input => ({ ...input, carrier: rustRetainedCallResult(input.carrier, retainedLifetimes) })),
  }));
  const arguments_ = prepareSelectedSourceCallArguments(walk, callArguments as readonly Node[], sourceFile, parameters, bindings);
  if (arguments_ === undefined) return undefined;
  const preparedParameters = arguments_.parameters;
  const actualArgumentCarriers = rustSourceCallArgumentCarriers(expression, ast, walk.context.records);
  const instantiateResult = (carrier: TargetTypeRef): TargetTypeRef => rustRetainedCallResult(rustSourceCallResultWithInputLifetimes(
    carrier, preparedParameters.map(parameter => parameter.parameterCarrier), bindings, actualArgumentCarriers, preparedParameters), retainedLifetimes);
  const nativeResultCarrier = instantiateResult(genericResultCarrier);
  const sourceResult = selectRustSourceCallResult(walk.operationOptions.projectTypes, nativeResultCarrier, () => {
    const selected = selectedSignature.sourceResultProjection?.selectedCarrier;
    return selected === undefined ? nativeResultCarrier : instantiateResult(substituteRustTargetGenerics(selected,
      substitutions.types, substitutions.lifetimes, substitutions.consts, normalizeTypeFamily));
  }, walk.context.typeDefinitions);
  if (sourceResult === undefined) {
    appendRustDiagnostic(walk, "RUST_SOURCE_CALL_RESULT_PROJECTION_MISSING",
      "The finalized project-source result has no exact native carrier projection.", expression,
      ["target.capability=rust.source-call.result-projection"]);
    return undefined;
  }
  const resultCarrier = sourceResult.selectedType;
  if (!retainRustSelectedSourceCallResultStorage(selectedSignature, targetGenericArguments,
    nativeResultCarrier, rustResolutionContext(walk, expression), walk.operationOptions)) {
    appendRustDiagnostic(walk, "RUST_SOURCE_CALL_RESULT_STORAGE_MISSING",
      "The selected source return type has no exact instantiated structural storage correspondence.", expression,
      ["target.capability=rust.source-call.result-storage"]);
    return undefined;
  }
  if (optionalCall !== undefined &&
    (!rustTargetTypeRefEquals(optionalCall.innerResultCarrier, resultCarrier) ||
      optionalCall.operationKind !== "method")) {
    appendRustDiagnostic(
      walk,
      "RUST_OPTIONAL_CALL_RESULT_CONFLICT",
      "The finalized optional call conflicts with the exact selected project-source result carrier.",
      expression,
      ["target.capability=rust.optional-call.exact-result"],
    );
    return undefined;
  }
  const asyncBody = walk.context.promiseBodies.invocation(walk.context, expression, selectedDeclaration, target, nativeResultCarrier);
  const physicalResultCarrier = asyncBody === undefined ? resultCarrier : rustPromiseBodyInvocationCarrier(asyncBody);
  const finalResultCarrier = optionalCall?.resultCarrier ?? physicalResultCarrier;
  const computedKey = recordRustComputedCallEvaluation(ast, walk.context.records, walk.context.requiredRecords,
    sourceCall, callee,
    target.form !== "function" && target.form !== "static-method" || target.classReceiver !== undefined);
  if (computedKey !== undefined &&
    resolveExpressionCarrier(walk, computedKey, sourceFile, undefined) === undefined) return undefined;
  const completed = setCarrierFact(walk, expression, finalResultCarrier);
  if (completed === undefined) return undefined;
  if (retainedLifetimes.size > 0) {
    requireRustRecord(walk.context.requiredRecords, "retainedCallLifetimes", expression, "retained-call", "analysis/operations/project-calls.ts");
  }
  walk.context.records.retainedCalls.finalize(expression, retainedLifetimes);
  recordSelectedSourceCallArguments(walk, arguments_.arguments);
  requireRustRecord(walk.context.requiredRecords, "selectedOperation", expression, "source-call", "applySelectedProjectSourceCall");
  walk.context.records.selectedOperations.checked(expression, acceptRustPolicy({ operation: selectedRustSourceCallOperation(sourceCall, {
    operationId,
    operationKind,
    targetOperation: target.form,
    resultType: finalResultCarrier,
  }) }));
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "source-call", "analysis/operations/project-calls.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "source-call",
    operationId,
    target,
    parameters: preparedParameters,
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
    ...(sourceResult.projection === undefined ? {} : { resultProjection: sourceResult.projection }),
    ...(asyncBody === undefined ? {} : { asyncBody }),
    resultCarrier: physicalResultCarrier,
  });
  return completed;
}

export function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
  const records = walk.context.records;
  records.assertOpen();
  requireRustRecord(walk.context.requiredRecords, "runtimeCarrier", subject, carrier.kind, "setCarrierFact");
  const conflict = records.runtimeCarriers.source(subject, carrier);
  if (conflict !== undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_RUNTIME_CARRIER_CONFLICT",
      "Selected source evidence and Rust analysis produced incompatible runtime carriers for the same source subject.",
      subject,
      [
        "target.capability=rust.runtime-carrier.single-owner",
        `existing=${JSON.stringify(conflict.existing.carrier)}`,
        `incoming=${JSON.stringify(carrier)}`,
      ],
    );
    return undefined;
  }
  return records.runtimeCarrier.get(subject)?.carrier;
}
