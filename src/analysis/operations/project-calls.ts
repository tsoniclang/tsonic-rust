import {
  isRustNumericCarrier,
  rustCallableProtocol,
  inferRustTargetTypeParameterBindings,
  substituteRustTargetTypeParameters,
} from "../../policy/types/target-types.js";
import {
  KindBinaryExpression,
  KindCallExpression,
  KindElementAccessExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindIdentifier,
  KindNewExpression,
  KindNonNullExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindSatisfiesExpression,
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
import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import { recordBindingWrite, resolveParameterAbi, validateFlowMarkerAgainstMode } from "../declarations/types-and-bindings.js";
import { selectRustFlowReadProjection } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../facts/value-carrier-queries.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustArgumentPassingKey, rustRuntimeCarrierKey, rustSelectedOperationKey } from "../../policy/model/selections.js";
import { rustArgumentPassingMode } from "../facts/parameter-passing.js";
import { rustProjectCallableTargetName } from "../facts/source-member-name.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import { sourceTypeCarrierForDeclaration } from "./inputs.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSelectedTargetSignature, RustTargetMember, TargetTypeRef } from "../../policy/types/model.js";
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
  const targetTypeArguments = finalizeProjectSourceTargetTypeArguments(
    walk,
    selectedSignature,
    callArguments as readonly Node[],
    expected,
  );
  if (targetTypeArguments === undefined) {
    return undefined;
  }
  const substitutions = new Map<string, TargetTypeRef>();
  for (let index = 0; index < (selectedSignature.sourceSelectedMethodTypeArguments?.length ?? 0); index += 1) {
    const name = selectedSignature.sourceSelectedMethodTypeArguments?.[index]?.typeParameterName;
    const target = targetTypeArguments[index];
    if (name === undefined || target === undefined) {
      return undefined;
    }
    substitutions.set(name, target);
  }
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
    const parameterCarrier = substituteRustTargetTypeParameters(targetParameter.type, substitutions);
    const valueCarrier = substituteRustTargetTypeParameters(parameterAbi.valueCarrier, substitutions);
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
    : substituteRustTargetTypeParameters(selectedMember.returnType, substitutions);
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
  const indirectCallable = selectedCallableCarrier !== undefined &&
    (selectedCallableCarrier.kind === "function-pointer" ||
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
      (calleeCarrier.kind !== "function-pointer" && rustCallableProtocol(calleeCarrier) === undefined)) {
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
    const callable = rustCallableProtocol(target.carrier);
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
      const callableParameters = parameters.map((parameter, index) => {
        const carrier = callable.parameters[index];
        const contractCarrier = parameter.mode === "value"
          ? parameter.parameterCarrier
          : parameter.valueCarrier;
        return carrier !== undefined && rustTargetTypeRefEquals(carrier, contractCarrier)
          ? { ...parameter, parameterCarrier: carrier, mode: "value" as const }
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
    ...(targetTypeArguments.length === 0 ? {} : { targetTypeArguments }),
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
    resolveExpressionCarrier(walk, argument, sourceFile, expected);
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

function finalizeProjectSourceTargetTypeArguments(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  expected: TargetTypeRef | undefined,
): readonly TargetTypeRef[] | undefined {
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const selectedTargets = selected.targetTypeArguments ?? [];
  if (sourceArguments.length !== selectedTargets.length) {
    return undefined;
  }
  if (sourceArguments.length === 0) {
    return selectedTargets;
  }
  const parameterNames = new Set(sourceArguments.map((argument) => argument.typeParameterName));
  const finalized = [...selectedTargets];
  const inferred = reconcileProjectSourceArgumentTypeParameters(
    walk,
    selected,
    callArguments,
    parameterNames,
  );
  if (inferred === undefined) {
    return undefined;
  }
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const target = inferred.get(source.typeParameterName);
    if (target !== undefined && source.explicitTypeNode === undefined) {
      finalized[index] = target;
    }
  }
  if (expected === undefined || selected.member.returnType === undefined) {
    return finalized;
  }
  const contextual = inferRustTargetTypeParameterBindings(
    selected.member.returnType,
    expected,
    parameterNames,
  );
  if (contextual === undefined || contextual.size === 0) {
    return finalized;
  }
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const selectedTarget = finalized[index]!;
    const contextualTarget = contextual.get(source.typeParameterName);
    if (contextualTarget === undefined || rustTargetTypeRefEquals(selectedTarget, contextualTarget)) {
      continue;
    }
    const argumentTarget = inferred.get(source.typeParameterName);
    if (argumentTarget !== undefined && !rustTargetTypeRefEquals(argumentTarget, contextualTarget)) {
      continue;
    }
    if (source.explicitTypeNode !== undefined || !isRustNumericCarrier(selectedTarget) ||
      contextualTarget.kind !== "source-primitive" || !isRustNumericCarrier(contextualTarget) ||
      !projectSourceTypeArgumentHasLiteralProof(
        walk,
        selected.member,
        source.typeParameterName,
        callArguments,
        contextualTarget,
      )) {
      continue;
    }
    finalized[index] = contextualTarget;
  }
  return finalized;
}

function reconcileProjectSourceArgumentTypeParameters(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const reconciled = new Map<string, TargetTypeRef>();
  const bindings = selected.sourceArgumentBindings;
  if (bindings === undefined) {
    return reconciled;
  }
  for (const [argumentIndex, argument] of callArguments.entries()) {
    if (walk.context.ast.kindName(argument) === KindNumericLiteral) {
      continue;
    }
    const matches = bindings.filter((binding) =>
      binding.sourceArgumentIndex === argumentIndex);
    const first = matches[0];
    if (first === undefined || matches.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm)) {
      return undefined;
    }
    const parameter = selected.member.parameters[first.sourceParameterIndex];
    const actual = walk.context.facts.getRuntimeCarrierFact(argument)?.carrier ??
      resolveProjectSourceInferenceCarrier(walk, argument);
    if (parameter === undefined || actual === undefined) {
      continue;
    }
    const candidate = inferRustTargetTypeParameterBindings(
      parameter.type,
      actual,
      parameterNames,
    );
    if (candidate === undefined) {
      continue;
    }
    for (const [name, carrier] of candidate) {
      const existing = reconciled.get(name);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
        return undefined;
      }
      reconciled.set(name, carrier);
    }
  }
  return reconciled;
}

function resolveProjectSourceInferenceCarrier(
  walk: RustFactWalk,
  argument: Node,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(argument);
  if (kind !== KindIdentifier && kind !== KindCallExpression &&
    kind !== KindNewExpression && kind !== KindPropertyAccessExpression &&
    kind !== KindElementAccessExpression && kind !== KindBinaryExpression &&
    kind !== KindPrefixUnaryExpression && kind !== KindPostfixUnaryExpression &&
    kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
    kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
    kind !== "KindTypeAssertionExpression") {
    return undefined;
  }
  return resolveRustTargetTypeRef(
    argument,
    rustOperationContext(walk, argument),
    walk.operationOptions,
  );
}

function projectSourceTypeArgumentHasLiteralProof(
  walk: RustFactWalk,
  member: RustTargetMember,
  typeParameterName: string,
  callArguments: readonly Node[],
  target: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>,
): boolean {
  let proven = false;
  for (let index = 0; index < member.parameters.length; index += 1) {
    const parameter = member.parameters[index];
    if (parameter?.type.kind !== "type-parameter" || parameter.type.name !== typeParameterName) {
      continue;
    }
    const argument = callArguments[index];
    if (argument === undefined) {
      return false;
    }
    if (!selectedSourceLiteralIsRepresentable(argument, target.name, walk.context.ast)) {
      return false;
    }
    proven = true;
  }
  return proven;
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
