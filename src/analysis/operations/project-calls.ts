import {
  rustCallableProtocol,
  rustNativeCallableProtocol,
  rustTargetGenericTypeArguments,
  substituteRustTargetGenerics,
} from "../../target-model/types/index.js";
import {
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindNewExpression,
  KindPropertyAccessExpression,
  KindSpreadElement,
  Node_Expression,
  asSourceNode,
} from "@tsonic/target-api/source";
import {
  rustModuleBindingFactKey,
  rustOptionalChainFactKey,
  rustSelfModeFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { appendMalformedSourceAst } from "../declarations/project-types.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordBindingWrite, resolveParameterAbi, validateFlowMarkerAgainstMode } from "../declarations/types-and-bindings.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../facts/value-carrier-queries.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { rustArgumentPassingKey, rustRuntimeCarrierKey, rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustArgumentPassingMode } from "../facts/parameter-passing.js";
import { rustProjectCallableTargetName } from "../facts/source-member-name.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { finalizeProjectSourceGenericArguments } from "./project-call-generics.js";
import { sourceTypeCarrierForDeclaration } from "./inputs.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSelectedTargetSignature, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../facts/keys.js";

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
  const selectedMember = selectedSignature.member;
  if (!isDenseDataArray(callArguments) || callArguments.some((argument) => argument === undefined)) {
    appendMalformedSourceAst(walk, "Checked project-source call contains an undefined or non-data argument slot.");
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
  const declarationParameters = ast.kindName(selectedDeclaration) === "KindClassDeclaration"
    ? []
    : ast.parameters(selectedDeclaration);
  let parameters: import("../facts/keys.js").RustSourceCallParameterPlan[] = [];
  for (const [index, targetParameter] of selectedMember.parameters.entries()) {
    const selectedParameter = selectedParameters[index];
    const parameterDeclaration = declarationParameters[index] ?? asSourceNode(
      selectedParameter?.parameterDeclaration,
      ast,
    );
    const parameterAbi = parameterDeclaration === undefined
      ? undefined
      : resolveParameterAbi(walk, parameterDeclaration);
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
    );
    const valueCarrier = substituteRustTargetGenerics(
      parameterAbi.valueCarrier,
      substitutions.types,
      substitutions.lifetimes,
      substitutions.consts,
    );
    const mode = targetParameter.passingMode === "borrow-mut"
      ? "mut-ref" as const
      : targetParameter.passingMode === "borrow-shared"
        ? "ref" as const
        : "value" as const;
    const inputs = parameterInputs.map((binding) => {
      const carrier = parameterAbi.form === "rest" &&
          binding.sourceParameterForm === "rest-element"
        ? valueCarrier.kind === "array" ? valueCarrier.element : undefined
        : parameterAbi.form === "optional" || parameterAbi.form === "default"
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
    if (inputs.some((input) => input === undefined) ||
      (parameterAbi.form !== "rest" && inputs.length > 1) ||
      (parameterAbi.form === "required" && inputs.length !== 1)) {
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
      inputs: inputs as NonNullable<(typeof inputs)[number]>[],
    });
  }
  const resultCarrier = selectedMember.returnType === undefined
    ? undefined
    : substituteRustTargetGenerics(
        selectedMember.returnType,
        substitutions.types,
        substitutions.lifetimes,
        substitutions.consts,
      );
  if (resultCarrier === undefined) {
    return undefined;
  }
  const declarationKind = ast.kindName(selectedDeclaration);
  const operationId = selectedMember.id;
  let target: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>["target"] | undefined;
  let operationKind: "method" | "constructor" = "method";
  const calleeReferenceDeclaration = walk.context.source.navigation.sourceReferenceFor(callee)?.declaration;
  const calleeImplementation = calleeReferenceDeclaration === undefined
    ? undefined
    : walk.context.source.navigation.callableImplementation(
        calleeReferenceDeclaration,
      );
  const calleeModuleBinding = calleeReferenceDeclaration === undefined
    ? undefined
    : walk.context.facts.get(calleeReferenceDeclaration, rustModuleBindingFactKey) ??
      walk.context.facts.resolve(calleeReferenceDeclaration, rustModuleBindingFactKey);
  const directModuleFunction = calleeModuleBinding?.storage === "native-callable" &&
    calleeModuleBinding.callableDeclaration === selectedDeclaration;
  const directCallableDeclaration = calleeReferenceDeclaration === selectedDeclaration ||
    (calleeImplementation?.kind === "resolved" &&
      calleeImplementation.implementation.declaration === selectedDeclaration);
  const callableCalleeCarrier = expressionKind === KindNewExpression
    ? undefined
    : resolveExpressionCarrier(walk, callee, sourceFile, undefined);
  const optionalCall = walk.context.facts.get(expression, rustOptionalChainFactKey) ??
    walk.context.facts.resolve(expression, rustOptionalChainFactKey);
  const selectedCallableCarrier = optionalCall?.selectedGuardCarrier ?? callableCalleeCarrier;
  const selectedNativeCallable = rustNativeCallableProtocol(selectedCallableCarrier);
  const indirectCallable = selectedCallableCarrier !== undefined &&
    (selectedNativeCallable !== undefined ||
      rustCallableProtocol(selectedCallableCarrier) !== undefined) &&
    (!directCallableDeclaration ||
      ast.kindName(callee) === "KindArrowFunction" || ast.kindName(callee) === KindFunctionExpression);
  if (directModuleFunction) {
    const name = calleeModuleBinding.name;
    const fileName = ast.getFileName(ast.getSourceFile(calleeReferenceDeclaration!));
    if (name === undefined || fileName.length === 0) {
      return undefined;
    }
    target = {
      form: "function",
      fileName,
      name,
      selectedTargetName: selectedMember.targetName,
    };
  } else if (indirectCallable) {
    target = { form: "callable", carrier: selectedCallableCarrier };
  } else if (selectedMember.kind === "constructor") {
    target = {
      form: "constructor",
      name: selectedMember.targetName,
      typeCarrier: resultCarrier,
    };
    operationKind = "constructor";
  } else if (declarationKind === "KindMethodDeclaration" ||
    declarationKind === "KindMethodSignature") {
    const methodName = rustProjectCallableTargetName(selectedDeclaration, walk.context);
    if (methodName === undefined) {
      return undefined;
    }
    if (ast.hasModifierKind(selectedDeclaration, "static")) {
      const classDeclaration = ast.parent(selectedDeclaration);
      const typeCarrier = classDeclaration === undefined
        ? undefined
        : sourceTypeCarrierForDeclaration(walk, classDeclaration);
      if (typeCarrier === undefined) {
        return undefined;
      }
      target = { form: "static-method", name: methodName, typeCarrier };
    } else {
      const receiver = ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(walk.context.ast, callee)
        : undefined;
      if (receiver === undefined) {
        return undefined;
      }
      resolveExpressionCarrier(
        walk,
        receiver,
        sourceFile,
        undefined,
      );
      const rawReceiverCarrier = walk.context.facts.getRuntimeCarrierFact(receiver)?.carrier;
      const selectedReceiverCarrier = selectedSignature.sourceSelectedReceiverCarrier;
      if (rawReceiverCarrier === undefined || selectedReceiverCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_RECEIVER_CARRIER_MISSING",
          "Selected project-source method call has no exact raw and checker-selected receiver carriers.",
          receiver,
          ["target.capability=rust.source-call.receiver-carrier"],
        );
        return undefined;
      }
      const receiverProjection = selectRustFlowReadProjection(
        rawReceiverCarrier,
        selectedReceiverCarrier,
        walk.context.projectTypes,
      );
      if (receiverProjection.kind === "incompatible") {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_RECEIVER_PROJECTION_UNSUPPORTED",
          "The project-source method receiver cannot project from its exact runtime carrier to its checker-selected carrier.",
          receiver,
          ["target.capability=rust.source-call.receiver-projection"],
        );
        return undefined;
      }
      if (receiverProjection.kind === "projection") {
        recordRustFlowReadProjection(
          walk.context.facts,
          receiver,
          receiverProjection.fact,
        );
      }
      const selfMode = walk.context.facts.get(selectedDeclaration, rustSelfModeFactKey) ??
        walk.context.facts.resolve(selectedDeclaration, rustSelfModeFactKey);
      if (selfMode === undefined) {
        return undefined;
      }
      const mutatesSelf = selfMode.mode === "mut-ref";
      const owner = walk.context.projectTypes.definitionContainingDeclaration(selectedDeclaration);
      const ownerRelationship = owner === undefined
        ? undefined
        : walk.context.projectTypes.relationship(selectedReceiverCarrier, owner);
      const ownerCarrier = ownerRelationship?.kind === "related"
        ? ownerRelationship.targetType
        : undefined;
      const polymorphic = owner !== undefined && walk.context.projectTypes.isPolymorphic(owner);
      if (polymorphic && ownerCarrier === undefined) {
        return undefined;
      }
      if (polymorphic && ast.typeParameters(selectedDeclaration).length > 0) {
        const registration = walk.context.sourceCallableSpecializations.recordProjectMethodCall({
          subject: expression,
          ...(walk.currentCallableDeclaration === undefined
            ? {}
            : { caller: walk.currentCallableDeclaration }),
          declaration: selectedDeclaration,
          targetTypeArguments,
          ast,
          projectTypes: walk.context.projectTypes,
          sourceLifetimes: walk.context.sourceLifetimes,
        });
        if (registration.kind === "rejected") {
          appendRustDiagnostic(
            walk,
            "RUST_PROJECT_METHOD_SPECIALIZATION_UNAVAILABLE",
            registration.reason,
            expression,
            ["target.capability=rust.project-dispatch.finite-generic-specialization"],
          );
          return undefined;
        }
      }
      const receiverKind = ast.kindName(receiver);
      target = {
        form: "method",
        name: methodName,
        mutatesSelf,
        ...(!polymorphic
          ? {}
          : {
              dispatch: {
                selected: receiverKind === "KindSuperKeyword" ? "exact" : "virtual",
                ownerCarrier: ownerCarrier!,
              },
            }),
      };
      if (mutatesSelf) {
        recordBindingWrite(walk, receiver, "referent");
      }
    }
  } else if (declarationKind === KindFunctionDeclaration) {
    const name = walk.context.names.functionNameForDeclaration(selectedDeclaration);
    const fileName = ast.getFileName(ast.getSourceFile(selectedDeclaration));
    if (name === undefined || fileName.length === 0) {
      return undefined;
    }
    target = {
      form: "function",
      fileName,
      name,
      selectedTargetName: selectedMember.targetName,
    };
  } else if (declarationKind === "KindFunctionType" ||
    declarationKind === "KindCallSignature" ||
    declarationKind === "KindArrowFunction" ||
    declarationKind === KindFunctionExpression) {
    const calleeCarrier = selectedCallableCarrier;
    if (calleeCarrier === undefined ||
      (rustNativeCallableProtocol(calleeCarrier) === undefined &&
        rustCallableProtocol(calleeCarrier) === undefined)) {
      return undefined;
    }
    target = { form: "callable", carrier: calleeCarrier };
  }
  if (target === undefined) {
    return undefined;
  }
  if (declarationKind === KindFunctionDeclaration ||
    declarationKind === "KindMethodDeclaration") {
    const registration = walk.context.sourceCallableSpecializations.recordSourceCall({
      subject: expression,
      ...(walk.currentCallableDeclaration === undefined
        ? {}
        : { caller: walk.currentCallableDeclaration }),
      callee: selectedDeclaration,
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
    const callable = rustNativeCallableProtocol(target.carrier) ??
      rustCallableProtocol(target.carrier);
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
      );
      if (!rustTargetTypeRefEquals(callableResult, resultCarrier)) {
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
      parameters = callableParameters as import("../facts/keys.js").RustSourceCallParameterPlan[];
    }
  }
  if (!applySelectedSourceCallArguments(
    walk,
    callArguments as readonly Node[],
    sourceFile,
    parameters,
    bindings,
  )) {
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
  const finalResultCarrier = optionalCall?.resultCarrier ?? resultCarrier;
  recordTargetOperation(
    walk,
    expression,
    operationId,
    operationKind,
    target.form,
    finalResultCarrier,
  );
  setRustOperationFact(walk, expression, {
    kind: "source-call",
    operationId,
    target,
    parameters,
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
    resultCarrier,
  });
  return setCarrierFact(walk, expression, finalResultCarrier);
}

export function applySelectedSourceCallArguments(
  walk: RustFactWalk,
  callArguments: readonly Node[],
  sourceFile: SourceFile,
  parameters: readonly import("../facts/keys.js").RustSourceCallParameterPlan[],
  bindings: readonly NonNullable<RustSelectedTargetSignature["sourceArgumentBindings"]>[number][],
): boolean {
  const { ast } = walk.context;
  for (const [index, argument] of callArguments.entries()) {
    const argumentBindings = bindings.filter((binding) =>
      binding.sourceArgumentIndex === index);
    if (argumentBindings.length === 0) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_BINDING_MISSING",
        `Selected source argument ${index} has no exact parameter binding.`,
        argument,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return false;
    }
    const bindingCarriers = parameters.flatMap((parameter) =>
      parameter.inputs
        .filter((input) => input.sourceArgumentIndex === index)
        .map((input) => input.carrier));
    const expected = ast.kindName(argument) === KindSpreadElement
      ? undefined
      : bindingCarriers.length > 0 && bindingCarriers.every((carrier) =>
          rustTargetTypeRefEquals(carrier, bindingCarriers[0]))
        ? bindingCarriers[0]
        : undefined;
    const resolvedArgumentCarrier = resolveExpressionCarrier(
      walk,
      argument,
      sourceFile,
      expected,
    );
    if (resolvedArgumentCarrier === undefined ||
      ast.kindName(argument) === KindSpreadElement &&
        !selectedSpreadArgumentMatches(
          resolvedArgumentCarrier,
          parameters.flatMap((parameter) => parameter.inputs.filter((input) =>
            input.sourceArgumentIndex === index)),
        )) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_CARRIER_MISSING",
        `Selected source argument ${index} has no exact carrier matching its effective parameter bindings.`,
        argument,
        ["target.capability=rust.source-call.argument-carrier"],
      );
      return false;
    }
    const modes = parameters
      .filter((parameter) => parameter.inputs.some((input) =>
        input.sourceArgumentIndex === index))
      .map((parameter) => parameter.mode);
    if (modes.length === 0 || modes.some((mode) => mode !== modes[0])) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_MODE_CONFLICT",
        `Selected source argument ${index} spans incompatible target parameter modes.`,
        argument,
        ["target.capability=rust.source-call.argument-modes"],
      );
      return false;
    }
    const mode = modes[0]!;
    const passingMode = rustArgumentPassingMode(mode);
    walk.context.facts.set(argument, rustArgumentPassingKey, {
      mode: passingMode,
      ...(mode === "value" ? {} : { storageExpression: argument }),
    }, [{
      message: `rust selected source argument ${index} passes as ${passingMode}`,
    }]);
    validateFlowMarkerAgainstMode(walk, argument, mode);
    if (mode === "mut-ref") {
      recordBindingWrite(walk, argument, "referent");
    }
  }
  return true;
}

function selectedSpreadArgumentMatches(
  sourceCarrier: TargetTypeRef,
  inputs: readonly import("../facts/keys.js").RustSourceCallParameterPlan["inputs"][number][],
): boolean {
  return inputs.length > 0 && inputs.every((input) => {
    const selectedCarrier = input.sourceForm === "spread-element"
      ? input.spreadElementIndex === undefined
        ? undefined
        : rustSpreadElementCarrier(sourceCarrier, input.spreadElementIndex)
      : input.sourceForm === "spread-sequence"
        ? sourceCarrier
        : undefined;
    return selectedCarrier !== undefined &&
      rustTargetTypeRefEquals(selectedCarrier, input.carrier);
  });
}

export function recordTargetOperation(
  walk: RustFactWalk,
  expression: Node,
  operationId: string,
  operationKind: "property" | "method" | "indexer" | "operator" | "constructor",
  targetOperation: string,
  resultType: TargetTypeRef,
): void {
  walk.context.facts.set(
    expression,
    rustSelectedOperationKey,
    { operationId, operationKind, targetOperation, resultType },
    [{ message: `rust target operation ${operationId}` }],
  );
}

export function setRustOperationFact(walk: RustFactWalk, expression: Node, fact: RustTargetOperationFact): void {
  walk.context.facts.set(expression, rustTargetOperationFactKey, fact, [
    { message: `rust operation ${fact.operationId}` },
  ]);
}

export function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
  const facts = walk.context.facts;
  const existing = facts.get(subject, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(subject, rustRuntimeCarrierKey);
  if (existing !== undefined) {
    if (!rustTargetTypeRefEquals(existing.carrier, carrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_RUNTIME_CARRIER_CONFLICT",
        "Selected source evidence and Rust analysis produced incompatible runtime carriers for the same source subject.",
        subject,
        [
          "target.capability=rust.runtime-carrier.single-owner",
          `existing=${JSON.stringify(existing.carrier)}`,
          `incoming=${JSON.stringify(carrier)}`,
        ],
      );
      return undefined;
    }
    return existing.carrier;
  }
  facts.set(subject, rustRuntimeCarrierKey, { carrier }, [{ message: "rust carrier" }]);
  return carrier;
}
