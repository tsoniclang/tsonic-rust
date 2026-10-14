import {
  rustCallableProtocol,
  rustNativeCallableProtocol,
  rustTargetGenericTypeArguments,
  substituteRustTargetGenerics,
  isRustProgramErrorCarrier,
  rustJsArrayLikeElementTargetType,
} from "../../target-model/types/index.js";
import {
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindNewExpression,
  KindSpreadElement,
  asSourceNode,
} from "@tsonic/target-api/source";

import { appendMalformedSourceAst } from "../declarations/project-types.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordBindingWrite, resolveParameterAbi, validateFlowMarkerAgainstMode } from "../declarations/types-and-bindings.js";
import { selectRustFlowReadProjection } from "../../policy/types/resolution/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../conversions/value-carrier-queries.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";

import { rustArgumentPassingMode } from "../callables/parameter-passing.js";
import { rustProjectCallableTargetName } from "../names/source-member-name.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/model/type-family-normalization.js";
import { realizeRustSelectedTypeFamilies } from "./type-family-applications.js";
import { finalizeProjectSourceGenericArguments } from "./project-call-generics.js";
import { instantiateRustSourceParameterValueCarrier } from "../../policy/ownership/source-callable-abi.js";
import { retainRustStructuralInstantiation } from "../../policy/types/resolution/structural-instantiations.js";
import { bindRustSelectedCallTypeArguments } from "../../policy/types/resolution/generic-arguments.js";
import { sourceTypeCarrierForDeclaration } from "./inputs.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSelectedTargetSignature, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { substituteRustValueConversion } from "../../target-model/conversions/substitution.js";
import { recordSelectedMethodSpecialization } from "./project-method-calls.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { retainRustSelectedCallableResultTemplate, retainRustSelectedSourceCallResultStorage, selectRustSourceCallResult } from "../../policy/types/resolution/call-results.js";
import { rustSourceCallArgumentCarriers, rustSourceCallResultWithInputLifetimes } from "../callables/source-call-lifetimes.js";
import { rustRetainedCallLifetimes, rustRetainedCallResult } from "../callables/retained-environments.js";
import { rustRetainedEnvironment } from "../../policy/ownership/retained-environments.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";

import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";
import { recordRustComputedCallEvaluation } from "./computed-members.js";

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
  const declarationParameters = ast.is.IsClassDeclaration(selectedDeclaration) || ast.is.IsClassExpression(selectedDeclaration)
    ? []
    : ast.parameters(selectedDeclaration);
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
  let parameters: import("../../target-model/operations/model.js").RustSourceCallParameterPlan[] = [];
  for (const [index, targetParameter] of selectedMember.parameters.entries()) {
    const selectedParameter = selectedParameters[index];
    const parameterDeclaration = declarationParameters[index] ?? asSourceNode(
      selectedParameter?.parameterDeclaration,
      ast,
    );
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
    const inputs = parameterInputs.map((binding) => {
      const carrier = parameterAbi.form === "rest" &&
          binding.sourceParameterForm === "rest-element"
        ? valueCarrier.kind === "array" ? valueCarrier.element : rustJsArrayLikeElementTargetType(valueCarrier)
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
    : walk.context.records.moduleBinding.get(calleeReferenceDeclaration);
  const directModuleFunction = calleeModuleBinding?.storage === "native-callable" &&
    calleeModuleBinding.callableDeclaration === selectedDeclaration;
  const directCallableDeclaration = calleeReferenceDeclaration === selectedDeclaration ||
    (calleeImplementation?.kind === "resolved" &&
      calleeImplementation.implementation.declaration === selectedDeclaration);
  const lexicalBinding = walk.context.sourceCallables.directLexicalBinding(selectedDeclaration);
  const directLexical = lexicalBinding !== undefined && lexicalBinding === calleeReferenceDeclaration;
  const callableCalleeCarrier = expressionKind === KindNewExpression || directModuleFunction || directLexical ||
    declarationKind === KindFunctionDeclaration && calleeReferenceDeclaration === selectedDeclaration
    ? undefined
    : resolveExpressionCarrier(walk, callee, sourceFile, undefined);
  const optionalCall = walk.context.records.optionalChain.get(expression);
  const selectedCallableCarrier = optionalCall?.selectedGuardCarrier ?? callableCalleeCarrier;
  const selectedNativeCallable = rustNativeCallableProtocol(selectedCallableCarrier);
  const selectedGenericCallable = rustGenericCallableProtocol(selectedCallableCarrier,
    (selectedSignature.member.genericParameters ?? []).flatMap(parameter => parameter.kind === "type"
      ? [{ kind: "type-parameter" as const, identity: parameter.targetIdentity, name: parameter.sourceName }] : []));
  const indirectCallable = selectedCallableCarrier !== undefined &&
    (selectedNativeCallable !== undefined || selectedGenericCallable !== undefined ||
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
  } else if (selectedSignature.sourceUnionMethods !== undefined) {
    const union = selectedSignature.sourceUnionMethods;
    const receiver = rustMemberAccessReceiver(ast, callee);
    if (receiver === undefined) return undefined;
    const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    if (!rustTargetTypeRefEquals(receiverCarrier, union.receiverCarrier)) return undefined;
    const variants = union.variants.map(variant => {
      const selfMode = walk.context.records.selfMode.get(variant.declaration);
      const owner = walk.context.projectTypes.definitionContainingDeclaration(variant.declaration);
      const polymorphic = owner !== undefined && walk.context.projectTypes.isPolymorphic(owner);
      const relationship = owner === undefined ? undefined : walk.context.projectTypes.relationship(variant.carrier, owner);
      if (polymorphic && relationship?.kind !== "related") return undefined;
      if (polymorphic && !recordSelectedMethodSpecialization(walk, expression, variant.declaration, targetTypeArguments)) return undefined;
      return selfMode === undefined ? undefined : {
        name: variant.name,
        carrier: variant.carrier,
        declaration: variant.declaration,
        targetName: variant.targetName,
        returnType: substituteRustTargetGenerics(variant.returnType, substitutions.types, substitutions.lifetimes, substitutions.consts, normalizeTypeFamily),
        ...(variant.resultConversion === undefined ? {} : { resultConversion: substituteRustValueConversion(
          variant.resultConversion, substitutions.types, substitutions.lifetimes, substitutions.consts,
        ) }),
        mutatesSelf: selfMode.mode === "mut-ref",
        ...(polymorphic && relationship?.kind === "related" ? { dispatchOwner: relationship.targetType } : {}),
      };
    });
    if (variants.some(variant => variant === undefined)) return undefined;
    if (variants.some(variant => variant!.mutatesSelf)) recordBindingWrite(walk, receiver, "referent");
    walk.context.generatedDeclarationUses.record(expression, union.variants.map(variant => variant.declaration));
    target = { form: "union-method", receiverCarrier: union.receiverCarrier, variants: variants as NonNullable<typeof variants[number]>[] };
  } else if (indirectCallable) {
    target = { form: "callable", carrier: selectedCallableCarrier };
  } else if (selectedMember.kind === "constructor") {
    const owner = walk.context.projectTypes.definitionForCarrier(genericResultCarrier);
    const classReceiver = expressionKind !== KindNewExpression || calleeReferenceDeclaration === owner?.declaration ? undefined : callee;
    if (classReceiver !== undefined) {
      const carrier = resolveExpressionCarrier(walk, classReceiver, sourceFile, undefined);
      const instance = rustClassConstructorInstance(carrier);
      if (owner === undefined || instance === undefined || walk.context.projectTypes.definitionForCarrier(instance) !== owner) return undefined;
    }
    target = {
      form: "constructor",
      name: selectedMember.targetName,
      typeCarrier: genericResultCarrier,
      ...(classReceiver === undefined ? {} : { classReceiver }),
    };
    operationKind = "constructor";
  } else if (declarationKind === "KindMethodDeclaration" ||
    declarationKind === "KindMethodSignature") {
    const methodName = rustProjectCallableTargetName(selectedDeclaration, walk.context);
    if (methodName === undefined) {
      return undefined;
    }
    if (ast.hasModifierKind(selectedDeclaration, "static")) {
      const moduleFunction = walk.context.projectTypes.memberSlotName(selectedDeclaration, "static");
      const classDeclaration = ast.parent(selectedDeclaration);
      const typeCarrier = classDeclaration === undefined
        ? undefined
        : sourceTypeCarrierForDeclaration(walk, classDeclaration);
      if (typeCarrier === undefined) {
        return undefined;
      }
      const receiver = rustMemberAccessReceiver(ast, callee);
      const direct = receiver !== undefined && walk.context.source.navigation.sourceReferenceFor(receiver)?.declaration === classDeclaration;
      const classReceiver = direct ? undefined : receiver;
      if (!direct) {
        const carrier = receiver === undefined ? undefined : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        const instance = rustClassConstructorInstance(carrier);
        if (instance === undefined || walk.context.projectTypes.definitionForCarrier(instance)?.declaration !== classDeclaration) return undefined;
      }
      target = moduleFunction === undefined
        ? { form: "static-method", name: methodName, typeCarrier, ...(classReceiver === undefined ? {} : { classReceiver }) }
        : { form: "function", name: moduleFunction,
            fileName: ast.getFileName(ast.getSourceFile(selectedDeclaration)), selectedTargetName: selectedMember.targetName,
            ...(classReceiver === undefined ? {} : { classReceiver }) };
    } else {
      const receiver = rustMemberAccessReceiver(ast, callee);
      if (receiver === undefined) {
        return undefined;
      }
      resolveExpressionCarrier(
        walk,
        receiver,
        sourceFile,
        undefined,
      );
      const rawReceiverCarrier = walk.context.records.runtimeCarrier.get(receiver)?.carrier;
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
        walk.context.projectTypes, walk.context.typeDefinitions,
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
          walk.context.records,
          receiver,
          receiverProjection.fact,
        );
      }
      const selfMode = walk.context.records.selfMode.get(selectedDeclaration);
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
      if (polymorphic && !recordSelectedMethodSpecialization(walk, expression, selectedDeclaration, targetTypeArguments)) return undefined;
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
  } else if (declarationKind === KindFunctionDeclaration || directLexical) {
    const name = directLexical ? walk.context.names.nameForDeclaration(lexicalBinding)
      : walk.context.names.functionNameForDeclaration(selectedDeclaration);
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
      (selectedGenericCallable === undefined && rustNativeCallableProtocol(calleeCarrier) === undefined &&
        rustCallableProtocol(calleeCarrier) === undefined)) {
      return undefined;
    }
    target = { form: "callable", carrier: calleeCarrier };
  }
  if (target === undefined) {
    return undefined;
  }
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
    const callable = selectedGenericCallable ?? rustNativeCallableProtocol(target.carrier) ??
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
      parameters = callableParameters as import("../../target-model/operations/model.js").RustSourceCallParameterPlan[];
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
      const expected = carriers.length !== 0 && carriers.every(carrier => rustTargetTypeRefEquals(carrier, carriers[0])) &&
        !rustTargetGenericReferences(carriers[0]!).lifetimeIdentities.includes(identity) ? carriers[0] : undefined;
      if (resolveExpressionCarrier(walk, argument, sourceFile, expected) === undefined) return undefined;
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
  if (retainedLifetimes.size !== 0) walk.context.records.retainedCallLifetimes.set(expression, Object.freeze([...retainedLifetimes].map(([identity, lifetime]) => Object.freeze({ identity, lifetime }))), [{ message: "rust exact retained call environment" }]);
  if (retainedLifetimes.size !== 0) parameters = parameters.map(parameter => ({ ...parameter,
    valueCarrier: rustRetainedCallResult(parameter.valueCarrier, retainedLifetimes),
    parameterCarrier: rustRetainedCallResult(parameter.parameterCarrier, retainedLifetimes),
    inputs: parameter.inputs.map(input => ({ ...input, carrier: rustRetainedCallResult(input.carrier, retainedLifetimes) })),
  }));
  if (!applySelectedSourceCallArguments(walk, callArguments as readonly Node[], sourceFile, parameters, bindings)) return undefined;
  const actualArgumentCarriers = rustSourceCallArgumentCarriers(expression, ast, walk.context.records);
  const instantiateResult = (carrier: TargetTypeRef): TargetTypeRef => rustRetainedCallResult(rustSourceCallResultWithInputLifetimes(
    carrier, parameters.map(parameter => parameter.parameterCarrier), bindings, actualArgumentCarriers, parameters), retainedLifetimes);
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
  const finalResultCarrier = optionalCall?.resultCarrier ?? resultCarrier;
  const computedKey = recordRustComputedCallEvaluation(ast, walk.context.records,
    walk.context.semanticsFor(expression).operations.call(expression), callee,
    target.form !== "function" && target.form !== "static-method" || target.classReceiver !== undefined);
  if (computedKey !== undefined &&
    resolveExpressionCarrier(walk, computedKey, sourceFile, undefined) === undefined) return undefined;
  walk.context.records.selectedOperations.project(
    expression,
    operationId,
    operationKind,
    target.form,
    finalResultCarrier,
  );
  walk.context.records.targetOperations.source(expression, {
    kind: "source-call",
    operationId,
    target,
    parameters,
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
    ...(sourceResult.projection === undefined ? {} : { resultProjection: sourceResult.projection }),
    resultCarrier,
  });
  return setCarrierFact(walk, expression, finalResultCarrier);
}

export function applySelectedSourceCallArguments(
  walk: RustFactWalk,
  callArguments: readonly Node[],
  sourceFile: SourceFile,
  parameters: readonly import("../../target-model/operations/model.js").RustSourceCallParameterPlan[],
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
    walk.context.records.argumentPassing.set(argument, {
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
  inputs: readonly import("../../target-model/operations/model.js").RustSourceCallParameterPlan["inputs"][number][],
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

export function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
  const records = walk.context.records;
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
