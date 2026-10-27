import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { isRustNumericCarrier } from "../../target-model/types/index.js";
import { acceptRustPolicy } from "../../policy/model/contracts.js";
import { checkedCallIsConstruction, instantiateExactSelectedConstructionCarrier, mapSelectedProjectGenericArguments, selectedCallReceiverValueCarrier, selectedProjectConstructor } from "./members/calls/instantiation.js";
import { selectRustOptionalCallResult } from "./members/calls/optional-results.js";
import { asNode } from "../../policy/identities/selected-source.js";
import { rustOptionElementCarrier, rustOptionTargetType } from "../../target-model/types/index.js";
import { Node_Type, sourceCallableValueParameters } from "@tsonic/target-api/source";
import { rejectSelectedOperation } from "./members/result.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";

import { rustProjectCallableTargetName } from "../names/source-member-name.js";

import { rustCallableInvocationResult } from "../../policy/types/callables/return-contexts.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";

import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustProjectGenericContractCorrespondence } from "../../policy/types/project/project-generic-contract.js";
import { selectedCallCalleeDeclaration } from "./members/operators.js";
import { selectedValueCarrier } from "./selected-values.js";
import { selectedRustCallSignature } from "../program/records/calls/selected-call.js";

import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../policy/model/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./members/model.js";
import type { RustTargetMember, TargetTypeRef } from "../../target-model/types/model.js";

import { selectRustPointerReturnCarrier } from "../callables/ownership/pointer-return.js";
import { resolveRustUnionMethodContracts, rustUnionMethodOwner, selectRustUnionMethods } from "./members/calls/union-methods.js";
import { rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustGenericCallableValueOwner } from "../../policy/types/callables/callable-origins.js";

import { selectRustSourceCallResult } from "../source-evidence/types/resolution/call-results.js";
import { resolveRustTypeComponentEvidence } from "../source-evidence/types/resolution/source-evidence.js";
import { bindRustSelectedCallTypeArguments } from "../source-evidence/types/resolution/generic-arguments.js";
import { bindRustSelectedReceiverContext } from "./members/member-carriers.js";

export function acceptProjectSourceCall(
  request: RustCheckedCallSelectionInput,
  selectedDeclaration: Node,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const { ast } = context;
  const selectedKind = ast.kindName(selectedDeclaration);
  const construction = checkedCallIsConstruction(request, context) ||
    selectedKind === "KindConstructor";
  if (construction && selectedKind !== "KindClassDeclaration" && selectedKind !== "KindClassExpression" && selectedKind !== "KindConstructor") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_CONSTRUCTOR_DECLARATION_INVALID", "Project-source construction evidence is not an exact constructor declaration or an implicit-constructor class declaration.");
  }
  const selectedCalleeDeclaration = asNode(selectedCallCalleeDeclaration(request), context);
  const selectedOwner = construction && selectedCalleeDeclaration !== undefined &&
      (ast.kindName(selectedCalleeDeclaration) === "KindClassDeclaration" || ast.kindName(selectedCalleeDeclaration) === "KindClassExpression")
    ? selectedCalleeDeclaration
    : selectedKind === "KindClassDeclaration" || selectedKind === "KindClassExpression"
      ? selectedDeclaration
      : selectedKind === "KindConstructor" ? ast.parent(selectedDeclaration) : undefined;
  const selectedOwnerDefinition = options.projectTypes.definitionForDeclaration(selectedOwner);
  const selectedConstructor = construction && selectedOwnerDefinition?.kind === "class"
    ? selectedProjectConstructor(
        selectedOwnerDefinition,
        request,
        options,
      )
    : undefined;
  if (construction && selectedConstructor === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CONSTRUCTOR_SIGNATURE_MISSING",
      "Project construction requires one exact effective constructor signature from shared source-program navigation.",
    );
  }
  if (selectedConstructor !== undefined &&
    (request.source.sourceSelectedSignatureParameters.length !== selectedConstructor.parameters.length ||
      request.source.sourceSelectedSignatureParameters.some((parameter, index) => {
        const expected = selectedConstructor.parameters[index];
        return expected === undefined ||
          parameter.parameterDeclaration !== expected.parameterDeclaration ||
          parameter.acceptsOmission !== expected.acceptsOmission ||
          parameter.rest !== expected.rest;
      }))) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CONSTRUCTOR_PARAMETER_EVIDENCE_CONFLICT",
      "The selected constructor parameter evidence conflicts with the exact effective constructor signature.",
    );
  }
  const selectedCallableDeclaration = selectedConstructor?.declaration ?? selectedDeclaration;
  const selectedCallableKind = ast.kindName(selectedCallableDeclaration);
  const callableImplementationRequired = selectedCallableKind === "KindFunctionDeclaration" ||
    selectedCallableKind === "KindMethodDeclaration" ||
    selectedCallableKind === "KindMethodSignature" ||
    selectedCallableKind === "KindConstructor";
  const callableImplementation = !callableImplementationRequired
    ? undefined
    : context.source.navigation.callableImplementation(selectedCallableDeclaration);
  const callableOwner = options.projectTypes.definitionContainingDeclaration(
    selectedCallableDeclaration,
  );
  const selectedContractHasNoBody = ast.body(selectedCallableDeclaration) === undefined &&
    callableOwner !== undefined &&
    (callableOwner.kind === "interface" || options.projectTypes.isPolymorphic(callableOwner));
  if (callableImplementationRequired &&
    callableImplementation?.kind !== "resolved" &&
    !selectedContractHasNoBody) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SOURCE_CALL_IMPLEMENTATION_MISSING",
      callableImplementation?.kind === "unresolved"
        ? callableImplementation.reason
        : "The selected project-source callable has no exact concrete implementation.",
    );
  }
  const callableDeclaration = callableImplementation?.kind === "resolved"
    ? callableImplementation.implementation.declaration
    : selectedCallableDeclaration;
  const selectedTypeArguments = request.source.sourceSelectedMethodTypeArguments ?? [];
  const genericOwners = construction
    ? [...new Set([selectedOwnerDefinition?.declaration, callableOwner?.declaration])]
        .filter((owner): owner is Node => owner !== undefined)
    : [selectedCallableDeclaration];
  const matchingOwners = genericOwners.filter(owner => {
    const parameters = ast.typeParameters(owner);
    return parameters.length === selectedTypeArguments.length && parameters.every((parameter, index) =>
      parameter !== undefined && context.currentSemantics.facts.typeSubjects(selectedTypeArguments[index]!.typeParameter)
        .some(subject => asNode(subject, context) === parameter));
  });
  const genericOwner = selectedTypeArguments.length === 0
    ? matchingOwners[0]
    : matchingOwners.length === 1 ? matchingOwners[0] : undefined;
  const targetGenericArguments = genericOwner === undefined
    ? undefined
    : mapSelectedProjectGenericArguments(request, genericOwner, context, options);
  const implementationGenericOwner = genericOwner === selectedCallableDeclaration && callableDeclaration !== selectedCallableDeclaration;
  const correspondence = genericOwner === undefined ? undefined : rustProjectGenericContractCorrespondence(
    genericOwner, implementationGenericOwner ? callableDeclaration : genericOwner, context);
  if (targetGenericArguments === undefined || correspondence === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_GENERIC_ARGUMENT_NOT_PROVEN", "A TSTS-selected project-source call does not have one exact lifetime/type generic instantiation.");
  }
  const { selected: selectedGenericContract, implementation: genericContract } = correspondence;
  const templateGenericArguments = targetGenericArguments.map((argument, index) => {
    const parameter = genericContract[index]!;
    return parameter.kind === "type" && argument.kind === "type"
      ? { kind: "type" as const, type: { kind: "type-parameter" as const, identity: parameter.identity, name: parameter.targetName } }
      : argument;
  });
  const superConstruction = construction &&
    ast.kindName(request.source.sourceCallee.expression) === "KindSuperKeyword";
  const containingDefinition = options.projectTypes.definitionContainingDeclaration(
    asNode(request.source.call, context),
  );
  const selectedOwnerRelationship = !superConstruction || selectedOwnerDefinition === undefined ||
      containingDefinition?.kind !== "class"
    ? undefined
    : options.projectTypes.relationship(
        options.projectTypes.openCarrier(containingDefinition),
        selectedOwnerDefinition,
      );
  const valueConstruction = construction && !superConstruction &&
    selectedCalleeDeclaration !== selectedOwnerDefinition?.declaration;
  const constructorInstance = valueConstruction
    ? rustClassConstructorInstance(selectedValueCarrier(
        request.source.sourceCallee.expression,
        request.source.sourceCallee.type,
        context,
        options,
      ))
    : undefined;
  const selectedResultOwnerCarrier = construction && !valueConstruction &&
      selectedOwnerDefinition !== undefined && request.source.sourceResultType !== undefined
    ? resolveRustTargetTypeRef(request.source.sourceResultType, context, options)
    : undefined;
  const selectedAuthoredOwnerCarrier = construction && !valueConstruction &&
      selectedOwnerDefinition !== undefined && selectedOwnerDefinition === callableOwner
    ? instantiateExactSelectedConstructionCarrier(
        selectedOwnerDefinition,
        templateGenericArguments,
        options,
      )
    : undefined;
  const selectedOwnerCarrier = superConstruction
    ? selectedOwnerRelationship?.kind === "related"
      ? selectedOwnerRelationship.targetType
      : undefined
    : valueConstruction ? constructorInstance : selectedAuthoredOwnerCarrier ?? selectedResultOwnerCarrier;
  if (construction && selectedOwnerCarrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CONSTRUCTOR_OWNER_CARRIER_MISSING",
      "Project construction requires an exact selected owner carrier with complete class type arguments.",
    );
  }
  if (construction &&
    options.projectTypes.definitionForCarrier(selectedOwnerCarrier) !== selectedOwnerDefinition) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CONSTRUCTOR_OWNER_CARRIER_CONFLICT",
      "The checker-selected construction result does not identify the selected project class.",
    );
  }
  const receiverCarrier = construction
    ? selectedOwnerCarrier
    : selectedCallReceiverValueCarrier(request, context, options);
  const unionMethods = construction ? undefined : selectRustUnionMethods(request, receiverCarrier, context, options);
  const ownerCarrier = unionMethods === undefined
    ? rustClassConstructorInstance(receiverCarrier) ?? receiverCarrier
    : rustUnionMethodOwner(unionMethods, callableDeclaration);
  if (rustSourceUnionCarrierValue(receiverCarrier) !== undefined &&
    (unionMethods === undefined || ownerCarrier === undefined)) {
    return rejectSelectedOperation(request.source.call, context, "RUST_UNION_METHOD_IDENTITY_MISSING",
      "A closed class union call requires one exact selected method implementation per arm.");
  }
  const selectedParameters = sourceCallableValueParameters(ast, callableDeclaration, context.semanticsFor(callableDeclaration),
    { kind: "selected-invocation", signature: request.source.selectedSignature });
  const nativeParameters = callableImplementation?.kind === "resolved"
    ? sourceCallableValueParameters(ast, callableDeclaration, context.semanticsFor(callableDeclaration), { kind: "declaration" })
    : selectedParameters;
  if (selectedParameters === undefined || nativeParameters === undefined) return rejectSelectedOperation(request.source.call, context,
    "RUST_SOURCE_CALL_BINDINGS_MISSING", "A selected source call requires exact checked value-parameter declarations.");
  const parameterSelections = nativeParameters.map(parameter =>
    options.sourceCallableAbi.resolveParameterAbi(parameter, context, options));
  const rejectedParameter = parameterSelections.find(selection => selection?.kind === "rejected");
  if (rejectedParameter?.kind === "rejected") return rejectSelectedOperation(request.source.call, context,
    "RUST_FORMAL_MEMBER_WRITE_DEMAND_NOT_PROVEN", rejectedParameter.reason);
  const parameters = nativeParameters.map((parameter, index) => {
    if (parameter === undefined) {
      return undefined;
    }
    const selection = parameterSelections[index];
    const abi = selection?.kind === "resolved" ? selection.abi : undefined;
    if (abi === undefined) {
      return undefined;
    }
    const parameterCarrier = ownerCarrier === undefined
      ? abi.parameterCarrier
      : options.projectTypes.instantiateMemberCarrier(
          parameter,
          ownerCarrier,
          abi.parameterCarrier,
        );
    const valueCarrier = ownerCarrier === undefined
      ? abi.valueCarrier
      : options.projectTypes.instantiateMemberCarrier(
          parameter,
          ownerCarrier,
          abi.valueCarrier,
        );
    if (parameterCarrier === undefined || valueCarrier === undefined) {
      return undefined;
    }
    const parameterName = ast.name(parameter);
    return {
      name: parameterName !== undefined && ast.is.IsIdentifier(parameterName)
        ? ast.text(parameterName) : `arg${index}`,
      type: parameterCarrier,
      passingMode: abi.mode === "mut-ref"
        ? "borrow-mut" as const
        : abi.mode === "ref" ? "borrow-shared" as const : "by-value" as const,
    };
  });
  if (parameters.some((parameter) => parameter === undefined)) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SOURCE_CALL_PARAMETER_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has a parameter without a closed Rust target carrier.");
  }
  let returnType: TargetTypeRef | undefined;
  if (construction) {
    returnType = ownerCarrier;
  } else {
    const sourceReturn = Node_Type(ast, callableDeclaration) ?? request.source.sourceResultType;
    const declaredReturnType = rustCallableInvocationResult(context.records, callableDeclaration) ??
      selectRustPointerReturnCarrier(callableDeclaration, context, options) ?? rustGenericCallableValueOwner(ast, callableDeclaration, (sourceReturn === undefined
      ? undefined
      : resolveRustTargetTypeRef(sourceReturn, context, options)));
    returnType = declaredReturnType === undefined || ownerCarrier === undefined
      ? declaredReturnType
      : options.projectTypes.instantiateMemberCarrier(
          callableDeclaration,
          ownerCarrier,
          declaredReturnType,
        );
  }
  if (returnType === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SOURCE_CALL_RETURN_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has no closed Rust return carrier.");
  }
  const unionContract = unionMethods === undefined ? undefined : resolveRustUnionMethodContracts(
    unionMethods, callableDeclaration, request.source.sourceSelectedSignatureParameters,
    parameters as RustTargetMember["parameters"], context, options,
  );
  if (unionMethods !== undefined && unionContract === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_UNION_METHOD_ABI_UNSUPPORTED",
      "The selected union methods require exact native parameter contracts and a lossless closed common result.");
  }
  returnType = unionContract?.result ?? returnType;
  const receiverContext = construction ? context : bindRustSelectedReceiverContext(
    request.source.sourceReceiver?.type, receiverCarrier, context, options);
  if (receiverContext === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_RECEIVER_GENERIC_ARGUMENT_NOT_PROVEN",
      "The selected project-source receiver requires exact declaration-bound native generic arguments.");
  }
  const sourceResult = selectRustSourceCallResult(options.projectTypes, returnType, () => {
    const result = context.currentSemantics.operations.callResult(request.source);
    if (result !== undefined && result.authoredTypeNode === undefined &&
      selectedCallableDeclaration === callableDeclaration &&
      isRustNumericCarrier(rustOptionElementCarrier(returnType) ?? returnType)) return returnType;
    const bound = bindRustSelectedCallTypeArguments(selectedTypeArguments, templateGenericArguments, receiverContext);
    const carrier = result === undefined || bound === undefined ? undefined
      : resolveRustTypeComponentEvidence({ selectedType: result.selectedReturnType,
          declaration: selectedCallableDeclaration, ...(result.authoredTypeNode === undefined ? {} : { authoredTypeNode: result.authoredTypeNode }) },
        bound, options, new Set());
    const selectedCarrier = carrier === undefined || ownerCarrier === undefined ? carrier
      : options.projectTypes.instantiateMemberCarrier(selectedCallableDeclaration, ownerCarrier, carrier);
    return result?.authoredTypeNode === undefined && rustOptionElementCarrier(returnType) !== undefined &&
        selectedCarrier !== undefined && rustOptionElementCarrier(selectedCarrier) === undefined
      ? rustOptionTargetType(selectedCarrier) : selectedCarrier;
  }, context.typeDefinitions);
  if (sourceResult === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SOURCE_CALL_RESULT_PROJECTION_MISSING",
      "The checker-selected project result requires an exact native carrier projection.");
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    sourceResult.selectedType,
    context,
    options,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  const sourceName = construction
    ? "constructor"
    : ast.kindName(callableDeclaration) === "KindFunctionType" ||
        ast.kindName(callableDeclaration) === "KindCallSignature"
      ? "call"
      : rustProjectCallableTargetName(callableDeclaration, context) ?? "<anonymous>";
  const memberDeclaration = construction ? selectedOwner ?? callableDeclaration : callableDeclaration;
  const fileName = ast.getFileName(ast.getSourceFile(memberDeclaration));
  const targetName = selectedConstructor?.targetName ?? sourceName;
  const member: RustTargetMember = {
    id: `tsonic.rust.source.call:${fileName}:${ast.pos(memberDeclaration)}:${ast.end(memberDeclaration)}:${targetName}`,
    sourceName,
    targetName,
    kind: construction ? "constructor" : "method",
    parameters: parameters as NonNullable<RustTargetMember["parameters"]>,
    returnType,
    ...(genericContract.length === 0
      ? {}
      : {
          genericParameters: genericContract.map((parameter, index) => parameter.kind === "type"
            ? {
                kind: "type" as const,
                sourceName: selectedGenericContract[index]!.sourceName,
                targetIdentity: parameter.identity,
              }
            : {
                kind: "lifetime" as const,
                sourceName: selectedGenericContract[index]!.sourceName,
                targetIdentity: rustLifetimeKey(parameter.lifetime),
              }),
        }),
  };
  const selectedSignature = selectedRustCallSignature(request, member, {
    sourceImplementationParameters: nativeParameters,
    ...(sourceResult.projection === undefined ? {} : { sourceResultProjection: sourceResult.projection }),
    ...(ownerCarrier === undefined ? {} : { sourceSelectedOwnerCarrier: ownerCarrier }),
    ...(unionContract === undefined ? {} : { sourceUnionMethods: { receiverCarrier: receiverCarrier!, variants: unionContract.methods } }),
    ...(construction || ownerCarrier === undefined
      ? {}
      : { sourceSelectedReceiverCarrier: receiverCarrier }),
    sourceDeclaration: selectedConstructor?.implicit === true ? selectedDeclaration : callableDeclaration,
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
  });
  if (optionalResult.fact !== undefined) {
    requireRustRecord(context.requiredRecords, "optionalChain", request.source.call, optionalResult.fact.operationKind, "analysis/operations/members/object-shapes.ts");
    context.records.optionalChains.guard(request.source.call, optionalResult.fact.guard,
      optionalResult.fact.operationKind, optionalResult.fact);
  }
  return acceptRustPolicy({
    selectedSignature,
  }, [{ message: `rust selected project-source call ${member.id}` }]);
}
