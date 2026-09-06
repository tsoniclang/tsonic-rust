import { rustStringTargetType } from "../../../target-model/types/index.js";
import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import {
  checkedCallIsConstruction,
  instantiateExactSelectedConstructionCarrier,
  mapSelectedProjectGenericArguments,
  selectedCallReceiverValueCarrier,
  selectedProjectConstructor,
  selectRustOptionalCallResult,
} from "./calls/instantiation.js";
import { asNode } from "../../../policy/evidence/selected-source.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { Node_Type } from "@tsonic/target-api/source";
import { rejectSelectedOperation } from "./result.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustArgumentPassingKey, rustSelectedCallKey, rustSelectedOperationKey } from "../../../target-model/facts/selections.js";
import { rustProjectCallableTargetName } from "../../facts/source-member-name.js";
import { rustTargetOperationFactKey, rustOptionalChainFactKey } from "../../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { selectedCallCalleeDeclaration, selectedCallCalleeSymbol, selectedSourceValueCarrier, selectedValueCarrier } from "./operators.js";
import {
  selectedAuthoredObjectFields,
  selectObjectAssignmentFields,
  selectObjectShapeProjectionFields,
} from "./object-shape-fields.js";
import type { SelectedObjectShapeProjection } from "./object-shape-fields.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../policy/operations/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustTargetMember, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../facts/keys.js";
import { selectRustPointerReturnCarrier } from "../../../policy/operations/pointer-return.js";

export function mapSelectedJsSpecialCall(
  request: RustCheckedCallSelectionInput,
  ownerName: string,
  memberName: string,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const objectProjection = selectedObjectShapeProjection(
    ownerName,
    memberName,
  );
  if (objectProjection !== undefined) {
    return mapSelectedObjectShapeProjection(
      request,
      objectProjection,
      context,
      options,
    );
  }
  return undefined;
}

function selectedObjectShapeProjection(
  ownerName: string,
  memberName: string,
): SelectedObjectShapeProjection | undefined {
  if (ownerName === "ObjectConstructor") {
    if (memberName === "assign") {
      return {
        projection: "assign",
        sourceName: memberName,
        sourceValue: "first-argument",
        assignmentSourceArgumentIndex: 1,
        expectedArgumentCount: 2,
        static: true,
      };
    }
    if (memberName === "keys" || memberName === "values" || memberName === "entries") {
      return {
        projection: memberName,
        sourceName: memberName,
        sourceValue: "first-argument",
        expectedArgumentCount: 1,
        static: true,
      };
    }
    if (memberName === "hasOwn") {
      return {
        projection: "has-own",
        sourceName: memberName,
        sourceValue: "first-argument",
        keyArgumentIndex: 1,
        expectedArgumentCount: 2,
        static: true,
      };
    }
  }
  return ownerName === "Object" && memberName === "hasOwnProperty"
    ? {
        projection: "has-own",
        sourceName: memberName,
        sourceValue: "receiver",
        keyArgumentIndex: 0,
        expectedArgumentCount: 1,
        static: false,
      }
    : undefined;
}

function mapSelectedObjectShapeProjection(
  request: RustCheckedCallSelectionInput,
  selection: SelectedObjectShapeProjection,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const sourceArguments = request.source.sourceArguments;
  const sourceValue = selection.sourceValue === "receiver"
    ? request.source.sourceReceiver
    : sourceArguments[0];
  if (sourceArguments.length !== selection.expectedArgumentCount || sourceValue === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_EVIDENCE_MISSING",
      `Selected Object.${selection.sourceName} call does not carry its exact receiver/argument evidence.`,
    );
  }
  const sourceValueNode = asNode(sourceValue.expression, context);
  const sourceValueCarrier = selectedValueCarrier(
    sourceValue.expression,
    sourceValue.type,
    context,
    options,
  );
  const shape = options.sourceTypes.structuralObjectForType(
    sourceValue.type,
    sourceValueCarrier,
  );
  if (sourceValueNode === undefined || sourceValueCarrier === undefined || shape === undefined ||
    shape.storage !== "object-handle" ||
    !rustTargetTypeRefEquals(sourceValueCarrier, shape.carrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
      `Selected Object.${selection.sourceName} call requires one exact generated structural object carrier.`,
    );
  }
  const assignmentSource = selection.assignmentSourceArgumentIndex === undefined
    ? undefined
    : sourceArguments[selection.assignmentSourceArgumentIndex];
  const assignmentSourceNode = assignmentSource === undefined
    ? undefined
    : asNode(assignmentSource.expression, context);
  const assignmentSourceCarrier = assignmentSource === undefined
    ? undefined
    : selectedValueCarrier(
        assignmentSource.expression,
        assignmentSource.type,
        context,
        options,
      );
  const assignmentShape = assignmentSource === undefined ||
      assignmentSourceCarrier === undefined
    ? undefined
    : options.sourceTypes.structuralObjectForType(
        assignmentSource.type,
        assignmentSourceCarrier,
      );
  if (selection.projection === "assign" && (
    assignmentSourceNode === undefined || assignmentSourceCarrier === undefined ||
    assignmentShape === undefined || assignmentShape.storage !== "object-handle" ||
    !rustTargetTypeRefEquals(assignmentShape.carrier, assignmentSourceCarrier)
  )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_ASSIGN_SOURCE_NOT_CLOSED",
      "Selected Object.assign requires exact generated target and source structural object carriers.",
    );
  }
  const orderedFields = selectedAuthoredObjectFields(shape, context);
  if (orderedFields.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
      orderedFields.reason,
    );
  }
  const orderedAssignmentFields = assignmentShape === undefined
    ? undefined
    : selectedAuthoredObjectFields(assignmentShape, context);
  if (selection.projection === "assign" &&
    (orderedAssignmentFields === undefined || orderedAssignmentFields.kind === "rejected")) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_ASSIGN_SOURCE_NOT_CLOSED",
      orderedAssignmentFields?.kind === "rejected"
        ? orderedAssignmentFields.reason
        : "Selected Object.assign source has no exact enumerable own-property order.",
    );
  }
  const resolvedSourceResult = resolveRustTargetTypeRef(
    request.source.sourceResultType,
    context,
    options,
  );
  const innerResultCarrier = selection.projection === "assign"
    ? sourceValueCarrier
    : request.source.optionalChain
      ? rustOptionElementCarrier(resolvedSourceResult)
      : resolvedSourceResult;
  if (innerResultCarrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_RESULT_MISSING",
      `Selected Object.${selection.sourceName} call has no exact closed result carrier.`,
    );
  }
  const assignmentFields = selection.projection === "assign"
    ? selectObjectAssignmentFields(
        orderedFields.fields,
        orderedAssignmentFields?.kind === "resolved"
          ? orderedAssignmentFields.fields
          : [],
      )
    : undefined;
  if (assignmentFields?.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_ASSIGN_RESULT_INVALID",
      assignmentFields.reason,
    );
  }
  const projectedFields = selection.projection === "assign"
    ? { kind: "resolved" as const, fields: [] }
    : selectObjectShapeProjectionFields(
        selection.projection,
        orderedFields.fields,
        innerResultCarrier,
      );
  if (projectedFields.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_RESULT_INVALID",
      projectedFields.reason,
    );
  }
  const keyExpression = selection.keyArgumentIndex === undefined
    ? undefined
    : asNode(sourceArguments[selection.keyArgumentIndex]?.expression, context);
  if (selection.projection === "has-own" && keyExpression === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_KEY_MISSING",
      `Selected Object.${selection.sourceName} call has no exact checked key expression.`,
    );
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    innerResultCarrier,
    context,
    options,
  );
  if (optionalResult.kind === "rejected" ||
    selection.projection !== "assign" && (
      resolvedSourceResult === undefined ||
      !rustTargetTypeRefEquals(optionalResult.resultCarrier, resolvedSourceResult)
    )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_OPTIONAL_RESULT_INVALID",
      optionalResult.kind === "rejected"
        ? optionalResult.message
        : `Selected Object.${selection.sourceName} result conflicts with its optional-chain carrier.`,
    );
  }
  const operationId = `tsonic.rust.js.object-shape.${selection.projection}`;
  const fact: Extract<RustTargetOperationFact, { readonly kind: "object-shape-projection" }> = {
    kind: "object-shape-projection",
    operationId,
    projection: selection.projection,
    sourceValue: sourceValueNode,
    sourceValueOrigin: selection.sourceValue === "receiver"
      ? { kind: "receiver" }
      : { kind: "argument", index: 0 },
    sourceValueCarrier,
    ...(keyExpression === undefined ? {} : { keyExpression }),
    ...(assignmentSourceNode === undefined ? {} : { assignmentSource: assignmentSourceNode }),
    ...(assignmentSourceCarrier === undefined
      ? {}
      : { assignmentSourceCarrier }),
    ...(assignmentFields?.kind !== "resolved"
      ? {}
      : { assignmentFields: assignmentFields.fields }),
    fields: projectedFields.fields,
    storage: shape.storage,
    resultCarrier: innerResultCarrier,
  };
  const evidence = [{ message: `rust selected closed Object.${selection.sourceName} projection` }];
  const parameterCarriers = sourceArguments.map((argument) =>
    selectedSourceValueCarrier(argument, context, options));
  if (parameterCarriers.some((carrier) => carrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_PARAMETER_MISSING",
      `Selected Object.${selection.sourceName} call has an argument without a closed Rust carrier.`,
    );
  }
  if (selection.keyArgumentIndex !== undefined &&
    !rustTargetTypeRefEquals(
      parameterCarriers[selection.keyArgumentIndex],
      rustStringTargetType(),
    )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_KEY_INVALID",
      `Selected Object.${selection.sourceName} key does not have the exact source string carrier.`,
    );
  }
  const parameterModes = sourceArguments.map((_, index) =>
    selection.static && (index === 0 || selection.projection === "assign" && index === 1)
      ? "borrow-shared" as const
      : "by-value" as const);
  for (const [index, argument] of sourceArguments.entries()) {
    const mode = parameterModes[index]!;
    context.facts.set(argument.expression, rustArgumentPassingKey, {
      mode,
      ...(mode === "borrow-shared"
        ? { storageExpression: argument.expression }
        : {}),
    }, [{ message: `rust Object projection argument ${index} passes as ${mode}` }]);
  }
  const operation: RustTargetOperationSelection = {
    operationId,
    operationKind: "method",
    targetOperation: operationId,
    resultType: optionalResult.resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceReceiver: sourceValue.expression,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
    },
  };
  const member: RustTargetMember = {
    id: operationId,
    sourceName: selection.sourceName,
    targetName: operationId,
    kind: "method",
    ...(selection.static ? { static: true } : {}),
    parameters: parameterCarriers.map((carrier, index) => ({
      name: `arg${index}`,
      type: carrier!,
      passingMode: parameterModes[index]!,
    })),
    returnType: innerResultCarrier,
  };
  const selectedSignature = {
    member,
    ...(!selection.static ? { sourceSelectedReceiverCarrier: sourceValueCarrier } : {}),
    ...(request.source.selectedSignature === undefined
      ? {}
      : { sourceSignature: request.source.selectedSignature }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceDeclaration: request.sourceSelectedDeclaration }),
    ...(selectedCallCalleeSymbol(request) === undefined
      ? {}
      : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined
      ? {}
      : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined
      ? {}
      : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined
      ? {}
      : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
  };
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional Object.${selection.sourceName} projection` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedOperationKey, operation, evidence);
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

export function acceptProjectSourceCall(
  request: RustCheckedCallSelectionInput,
  selectedDeclaration: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const { ast } = context;
  const selectedKind = ast.kindName(selectedDeclaration);
  const construction = checkedCallIsConstruction(request, context) ||
    selectedKind === "KindConstructor";
  if (construction && selectedKind !== "KindClassDeclaration" && selectedKind !== "KindConstructor") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_CONSTRUCTOR_DECLARATION_INVALID", "Project-source construction evidence is not an exact constructor declaration or an implicit-constructor class declaration.");
  }
  const selectedCalleeDeclaration = asNode(selectedCallCalleeDeclaration(request), context);
  const selectedOwner = construction && selectedCalleeDeclaration !== undefined &&
      ast.kindName(selectedCalleeDeclaration) === "KindClassDeclaration"
    ? selectedCalleeDeclaration
    : selectedKind === "KindClassDeclaration"
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
  const genericOwner = construction
    ? callableOwner?.declaration
    : selectedCallableDeclaration;
  const targetGenericArguments = genericOwner === undefined
    ? undefined
    : mapSelectedProjectGenericArguments(request, genericOwner, context, options);
  const sourceGenericParameters = genericOwner === undefined
    ? undefined
    : context.ast.typeParameters(genericOwner);
  const genericContract = sourceGenericParameters?.length === 0
    ? Object.freeze([])
    : genericOwner === undefined
      ? undefined
      : context.sourceLifetimes.contractFor(genericOwner)?.parameters;
  if (targetGenericArguments === undefined || genericContract === undefined ||
    sourceGenericParameters === undefined ||
    sourceGenericParameters.some((parameter) => parameter === undefined) ||
    genericContract.length !== sourceGenericParameters.length) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_GENERIC_ARGUMENT_NOT_PROVEN", "A TSTS-selected project-source call does not have one exact lifetime/type generic instantiation.");
  }
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
  const selectedResultOwnerCarrier = construction && selectedOwnerDefinition !== undefined &&
      request.source.sourceResultType !== undefined
    ? resolveRustTargetTypeRef(
        request.source.sourceResultType,
        context,
        options,
      )
    : undefined;
  const selectedAuthoredOwnerCarrier = construction &&
      selectedOwnerDefinition !== undefined &&
      selectedOwnerDefinition === callableOwner
    ? instantiateExactSelectedConstructionCarrier(
        selectedOwnerDefinition,
        targetGenericArguments,
        options,
      )
    : undefined;
  const selectedOwnerCarrier = superConstruction
    ? selectedOwnerRelationship?.kind === "related"
      ? selectedOwnerRelationship.targetType
      : undefined
    : selectedAuthoredOwnerCarrier ?? selectedResultOwnerCarrier;
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
  const ownerCarrier = construction
    ? selectedOwnerCarrier
    : selectedCallReceiverValueCarrier(request, context, options);
  const sourceParameters = ast.kindName(callableDeclaration) === "KindClassDeclaration"
    ? request.source.sourceSelectedSignatureParameters.map((parameter) =>
        parameter.parameterDeclaration)
    : ast.parameters(callableDeclaration);
  const parameters = sourceParameters.map((parameter, index) => {
    if (parameter === undefined) {
      return undefined;
    }
    const abi = options.sourceCallableAbi.resolveParameterAbi(parameter, context, options);
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
    return {
      name: ast.text(ast.name(parameter)) || `arg${index}`,
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
    const declaredReturnType = (sourceReturn === undefined
      ? undefined
      : resolveRustTargetTypeRef(sourceReturn, context, options)) ?? selectRustPointerReturnCarrier(callableDeclaration, context, options);
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
  const optionalResult = selectRustOptionalCallResult(
    request,
    returnType,
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
          genericParameters: genericContract.map((parameter) => parameter.kind === "type"
            ? {
                kind: "type" as const,
                sourceName: parameter.sourceName,
              }
            : {
                kind: "lifetime" as const,
                sourceName: parameter.sourceName,
                targetIdentity: rustLifetimeKey(parameter.lifetime),
              }),
        }),
  };
  const selectedSignature = {
    member,
    ...(construction || ownerCarrier === undefined
      ? {}
      : { sourceSelectedReceiverCarrier: ownerCarrier }),
    sourceDeclaration: callableDeclaration,
    ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
    ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
    ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
  };
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional call ${optionalResult.fact.lowering}` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature);
  return acceptRustPolicy({
    selectedSignature: {
      member,
      ...(construction || ownerCarrier === undefined
        ? {}
        : { sourceSelectedReceiverCarrier: ownerCarrier }),
      sourceDeclaration: callableDeclaration,
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
      ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
      ...(targetGenericArguments.length === 0 ? {} : { targetGenericArguments }),
    },
  }, [{ message: `rust selected project-source call ${member.id}` }]);
}
