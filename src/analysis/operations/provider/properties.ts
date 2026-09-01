import {
  isProjectSourceDeclaration,
  resolveSelectedJsSourceMember,
  resolveSelectedProviderDeclaration,
  resolveSelectedSourceProfilePropertyMembers,
} from "../../../policy/evidence/selected-source.js";
import { acceptDeclarationOperation, acceptRustMemberOperation, acceptRustOperation, isDeclarationFileSubject, normalizeSelectedLiteralCarrier, rejectSelectedOperation, selectedDeclarationIsCallable, selectedMemberReceiverCarrier, sourceOperationId } from "./result.js";
import { finalizeProviderOperationFromSubjects, mapProviderCheckedOperation } from "./conversions.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { isProjectAccessorDeclaration, selectRustFixedArrayLengthProperty, selectStructuralSourceProperty } from "./structural-properties.js";
import { Node_Type } from "@tsonic/target-api/source";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustCallableProtocol, rustSourceTypeCarrier, rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { rustProjectObjectField, rustProjectStaticFieldStorage } from "../../project-types/object-layout.js";
import { rustSourceCallableReturnFactKey } from "../../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/js-surface.js";
import { selectRustGeneratorSourceProperty } from "../../../policy/types/generator-source-profile.js";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import type {
  RustCheckedDeleteSelectionInput,
  RustCheckedOperationSelectionResult,
  RustCheckedPropertySelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustCheckedDelete(
  request: RustCheckedDeleteSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const identity = resolveSelectedJsSourceMember(
    context,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  if (!options.jsEnabled || identity === undefined || identity.memberName !== "index") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_DELETE_SELECTION_UNSUPPORTED",
      "delete requires one exact mutable JavaScript index signature selected by TSTS.",
    );
  }
  const receiverCarrier = resolveRustTargetTypeRef(request.receiver, context, options);
  const selectedIndexCarrier = resolveRustTargetTypeRef(request.index, context, options);
  const int32Carrier = rustSourcePrimitiveTargetType("int32");
  const indexCarrier = normalizeSelectedLiteralCarrier(
    request.index,
    selectedIndexCarrier,
    int32Carrier,
    context,
    options,
  );
  const selection = selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind: "delete",
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    argumentCarriers: [indexCarrier],
  });
  if (selection?.fact.kind !== "provider-operation") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_DELETE_CARRIER_UNSUPPORTED",
      `The selected JavaScript deletion '${identity.ownerName}.${identity.memberName}' has no closed Rust receiver and index carriers.`,
    );
  }
  const fact = finalizeProviderOperationFromSubjects(
    selection.fact,
    request.receiver,
    [request.index],
    context,
    options,
  );
  if (fact === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_DELETE_ABI_INCOMPLETE",
      `The selected JavaScript deletion '${identity.ownerName}.${identity.memberName}' cannot finalize one total Rust operation ABI.`,
    );
  }
  return acceptRustOperation(request.expression, fact, context, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    ...(request.sourceSelectedSymbol === undefined
      ? {}
      : { sourceSelectedSymbol: request.sourceSelectedSymbol }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
  });
}

function selectExternalProjectFieldAccess(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const externalField = options.projectTypes.externalFieldForReceiver(
    request.sourceSelectedDeclaration,
    selectedReceiverCarrier,
  );
  if (externalField === undefined || selectedReceiverCarrier === undefined) {
    return undefined;
  }
  if (request.accessMode === "delete") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_FIELD_DELETE_UNSUPPORTED",
      "Project fields cannot be deleted because their selected source declaration has no optional-property removal contract.",
    );
  }
  const operationId = sourceOperationId(context, externalField.field.declaration, "external-field");
  const readSlot = options.projectTypes.memberSlotName(
    externalField.field.declaration,
    "read",
  );
  const writeSlot = options.projectTypes.memberSlotName(
    externalField.field.declaration,
    "write",
  );
  if (readSlot === undefined || writeSlot === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_EXTERNAL_PROJECT_FIELD_SLOT_IDENTITY_MISSING",
      "Selected external project field has no deterministic Rust dispatch-slot identity.",
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "source-field",
    operationId,
    declaration: externalField.field.declaration,
    accessMode: request.accessMode,
    receiverCarrier: selectedReceiverCarrier,
    storage: "project-object",
    storageIndex: externalField.field.storageIndex,
    valueSemantics: { kind: "stored" },
    resultCarrier: externalField.field.carrier,
    dispatch: {
      read: readSlot,
      write: writeSlot,
      ownerCarrier: externalField.ownerCarrier,
    },
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: externalField.field.declaration,
    sourceResultType: request.sourceResultType,
  });
}

export function selectRustCheckedPropertyAccess(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selectedReceiverCarrier = selectedMemberReceiverCarrier(request, context, options);
  const runtimeReceiverCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  if (request.optionalChain === true && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_EVIDENCE_MISSING", "Optional-chain property access has no exact TSTS-selected non-null receiver type.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("property");
  }
  const structuralProperty = selectStructuralSourceProperty(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (structuralProperty !== undefined) {
    return structuralProperty;
  }
  const projectMethodProperty = selectProjectSourceMethodProperty(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (projectMethodProperty !== undefined) {
    return projectMethodProperty;
  }
  if (selectedDeclarationIsCallable(request.sourceSelectedDeclaration, context)) {
    return acceptDeclarationOperation("property");
  }
  const sourceProfileMembers = resolveSelectedSourceProfilePropertyMembers(
    context,
    request.expression,
    request.sourceSelectedSymbol,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSymbol, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked property access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected" && sourceProfileMembers === undefined) {
    if (tsonicFixedArrayProviderMember(providerEvidence.identity) === "length") {
      return selectRustFixedArrayLengthProperty(
        request,
        selectedReceiverCarrier,
        context,
        options,
      );
    }
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "property", context, options, request.receiver, [], request, selectedReceiverCarrier);
  }

  if (sourceProfileMembers !== undefined) {
    const generator = selectRustGeneratorSourceProperty({
      sourceMembers: sourceProfileMembers.members,
      ...(runtimeReceiverCarrier === undefined
        ? {}
        : { receiverCarrier: runtimeReceiverCarrier }),
    });
    if (generator.kind === "rejected") {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_GENERATOR_SOURCE_PROPERTY_NOT_CLOSED",
        generator.message,
      );
    }
    if (generator.kind === "resolved") {
      const fact = finalizeProviderOperationFromSubjects(
        generator.template,
        request.receiver,
        [],
        context,
        options,
        runtimeReceiverCarrier,
      );
      if (fact === undefined) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_GENERATOR_SOURCE_PROPERTY_ABI_INCOMPLETE",
          "The exact selected iterator-result property cannot finalize one total Rust operation ABI.",
        );
      }
      return acceptRustMemberOperation(request, "property", fact, context, options, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: request.sourceSelectedDeclaration,
        sourceResultType: request.sourceResultType,
      });
    }
  }

  const externalProjectField = selectExternalProjectFieldAccess(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (externalProjectField !== undefined) {
    return externalProjectField;
  }

  const jsIdentity = resolveSelectedJsSourceMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected property belongs to the explicit JavaScript source profile, which is not active.");
    }
    const receiverCarrier = selectedReceiverCarrier;
    const propertyNameNode = context.ast.name(request.expression);
    const authoredPropertyKey = propertyNameNode === undefined
      ? undefined
      : context.ast.text(propertyNameNode);
    const selection = selectJsSurfaceOperation({
      ownerName: jsIdentity.ownerName,
      memberName: jsIdentity.memberName,
      operationKind: "property",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      ...(jsIdentity.memberName === "index" && authoredPropertyKey !== undefined
        ? { authoredPropertyKey }
        : {}),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript property '${jsIdentity.ownerName}.${jsIdentity.memberName}' has no closed Rust operation row for this receiver carrier.`,
      );
    }
    const fact = finalizeProviderOperationFromSubjects(selection.fact, request.receiver, [], context, options, selectedReceiverCarrier);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `The selected JavaScript property '${jsIdentity.ownerName}.${jsIdentity.memberName}' cannot finalize one total Rust operation ABI.`);
    }
    return acceptRustMemberOperation(request, "property", fact, context, options, {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.sourceResultType,
    });
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const storage = rustProjectStaticFieldStorage(
      declaration,
      context.ast,
      options.projectTypes.memberSlotName(declaration, "static"),
    );
    if (storage !== undefined) {
      const owner = options.projectTypes.definitionContainingDeclaration(declaration);
      if (owner?.kind !== "class" || request.sourceReceiverValueDeclaration !== owner.declaration) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_STATIC_FIELD_RECEIVER_NOT_EXACT",
          "Project static-field access requires exact TSTS-selected receiver value evidence for the declaring class.",
        );
      }
      const sourceFieldType = Node_Type(context.ast, declaration) ??
        (request.optionalChain === true ? undefined : request.sourceResultType);
      const resultCarrier = resolveRustTargetTypeRef(sourceFieldType, context, options);
      if (resultCarrier === undefined) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_STATIC_FIELD_RESULT_NOT_CLOSED",
          "Selected project static field has no exact Rust result carrier.",
        );
      }
      const operationId = sourceOperationId(context, declaration, "static-field");
      return acceptRustMemberOperation(request, "property", {
        kind: "source-static-field",
        operationId,
        storageFileName: storage.fileName,
        storageName: storage.targetName,
        resultCarrier,
      }, context, options, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: declaration,
        sourceResultType: request.sourceResultType,
      });
    }
  }

  const projectAccessor = selectProjectSourceAccessor(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (projectAccessor !== undefined) {
    return projectAccessor;
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const memberName = context.ast.text(context.ast.name(declaration));
    if (context.ast.kindName(declaration) === "KindEnumMember") {
      const enumDeclaration = context.ast.parent(declaration);
      const enumName = enumDeclaration === undefined
        ? ""
        : context.ast.text(context.ast.name(enumDeclaration));
      const enumFileName = enumDeclaration === undefined
        ? ""
        : context.ast.getFileName(context.ast.getSourceFile(enumDeclaration));
      const resultCarrier = enumName.length === 0 || enumFileName.length === 0
        ? undefined
        : rustSourceTypeCarrier(enumFileName, enumName, "enum");
      if (memberName.length > 0 && resultCarrier !== undefined) {
        const operationId = sourceOperationId(context, declaration, "enum-member");
        return acceptRustMemberOperation(request, "property", {
          kind: "source-enum-member",
          operationId,
          name: memberName,
          resultCarrier,
        }, context, options, {
          sourceExpression: request.expression,
          sourceReceiver: request.receiver,
          sourceSelectedSymbol: request.sourceSelectedSymbol,
          sourceSelectedDeclaration: declaration,
          sourceResultType: request.sourceResultType,
        });
      }
    }
    const field = rustProjectObjectField(declaration, context.ast);
    const sourceFieldType = Node_Type(context.ast, declaration) ??
      (request.optionalChain === true ? undefined : request.sourceResultType);
    const declaredCarrier = resolveRustTargetTypeRef(sourceFieldType, context, options);
    const resultCarrier = declaredCarrier === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.instantiateMemberCarrier(
          declaration,
          selectedReceiverCarrier,
          declaredCarrier,
        );
    if (field !== undefined && resultCarrier !== undefined && selectedReceiverCarrier !== undefined) {
      if (request.accessMode === "delete") {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_FIELD_DELETE_UNSUPPORTED",
          "Project fields cannot be deleted because their selected source declaration has no optional-property removal contract.",
        );
      }
      const operationId = sourceOperationId(context, declaration, "field");
      const owner = options.projectTypes.definitionContainingDeclaration(declaration);
      const storageIndex = field.storageIndex +
        (owner === undefined
          ? 0
          : options.projectTypes.externalBaseForDefinition(owner)?.fields.length ?? 0);
      const ownerRelationship = owner === undefined || selectedReceiverCarrier === undefined
        ? undefined
        : options.projectTypes.relationship(selectedReceiverCarrier, owner);
      const ownerCarrier = ownerRelationship?.kind === "related"
        ? ownerRelationship.targetType
        : undefined;
      const readSlot = owner !== undefined && options.projectTypes.isPolymorphic(owner)
        ? options.projectTypes.memberSlotName(declaration, "read")
        : undefined;
      const writeSlot = readSlot === undefined
        ? undefined
        : options.projectTypes.memberSlotName(declaration, "write");
      if (owner !== undefined && options.projectTypes.isPolymorphic(owner) &&
        (readSlot === undefined || writeSlot === undefined || ownerCarrier === undefined)) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_FIELD_SLOT_IDENTITY_MISSING",
          "Selected project field has no deterministic Rust dispatch-slot identity.",
        );
      }
      return acceptRustMemberOperation(request, "property", {
        kind: "source-field",
        operationId,
        declaration,
        accessMode: request.accessMode,
        receiverCarrier: selectedReceiverCarrier,
        storage: "project-object",
        storageIndex,
        valueSemantics: { kind: "stored" },
        resultCarrier,
        ...(readSlot === undefined || writeSlot === undefined
          ? {}
          : { dispatch: { read: readSlot, write: writeSlot, ownerCarrier: ownerCarrier! } }),
      }, context, options, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: declaration,
        sourceResultType: request.sourceResultType,
      });
    }
  }

  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("property");
  }
  return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_EVIDENCE_MISSING", "Checked property access has no selected provider, source-profile, or project-source declaration evidence.");
}

function selectProjectSourceMethodProperty(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const declaration = request.sourceSelectedDeclaration;
  const kind = declaration === undefined ? undefined : context.ast.kindName(declaration);
  if (!isProjectSourceDeclaration(context, declaration) ||
    (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature")) {
    return undefined;
  }
  if (context.ast.hasModifierKind(declaration, "static")) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STATIC_METHOD_PROPERTY_UNSUPPORTED",
      "Static project methods require a separate exact constructor-object property-storage contract.",
    );
  }
  if (request.accessMode === "delete") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_DELETE_UNSUPPORTED",
      "Project method properties cannot be deleted without an exact optional callable-property contract.",
    );
  }
  const owner = options.projectTypes.definitionContainingDeclaration(declaration);
  const relationship = owner === undefined || selectedReceiverCarrier === undefined
    ? undefined
    : options.projectTypes.relationship(selectedReceiverCarrier, owner);
  if (owner === undefined || selectedReceiverCarrier === undefined ||
    relationship?.kind !== "related") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_RECEIVER_NOT_CLOSED",
      "Selected project method property has no exact receiver-to-declaration relationship.",
    );
  }
  const needsRead = request.accessMode === "read" || request.accessMode === "read-write";
  const needsWrite = request.accessMode === "write" || request.accessMode === "read-write";
  const readCarrier = needsRead
    ? resolveRustTargetTypeRef(request.sourceReadType, context, options)
    : undefined;
  const writeCarrier = needsWrite
    ? resolveRustTargetTypeRef(request.sourceWriteType, context, options)
    : undefined;
  const resultCarrier = resolveRustTargetTypeRef(request.sourceResultType, context, options) ??
    readCarrier ?? writeCarrier;
  const callableCarrier = readCarrier ?? writeCarrier;
  if (callableCarrier === undefined || resultCarrier === undefined ||
    rustCallableProtocol(callableCarrier) === undefined ||
    !rustTargetTypeRefEquals(callableCarrier, resultCarrier) ||
    (readCarrier !== undefined && !rustTargetTypeRefEquals(readCarrier, callableCarrier)) ||
    (writeCarrier !== undefined && !rustTargetTypeRefEquals(writeCarrier, callableCarrier))) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_CALLABLE_NOT_CLOSED",
      "Selected project method property has no single exact runtime callable carrier for its checked access mode.",
    );
  }
  const methodTypeParameters = context.ast.typeParameters(declaration);
  const parameters = context.ast.parameters(declaration);
  const parameterAbis = parameters.map((parameter) => parameter === undefined
    ? undefined
    : options.sourceCallableAbi.resolveParameterAbi(parameter, context, options));
  const callable = rustCallableProtocol(callableCarrier)!;
  if (!isDenseDataArray(methodTypeParameters) || methodTypeParameters.length !== 0 ||
    !isDenseDataArray(parameters) || parameterAbis.some((parameter) =>
      parameter === undefined || parameter.form !== "required" || parameter.mode !== "value") ||
    parameterAbis.length !== callable.parameters.length ||
    parameterAbis.some((parameter, index) =>
      !rustTargetTypeRefEquals(parameter!.parameterCarrier, callable.parameters[index]))) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_PROPERTY_ABI_UNSUPPORTED",
      "Mutable project method properties require one non-generic required-parameter value ABI.",
    );
  }
  const implementation = context.source.navigation.callableImplementation(declaration);
  const concreteDeclaration = implementation.kind === "resolved"
    ? implementation.implementation.declaration
    : declaration;
  const storageOwner = options.projectTypes.definitionContainingDeclaration(concreteDeclaration);
  const dispatchSlot = options.projectTypes.memberSlotName(declaration, "method-write");
  const storageName = storageOwner === undefined
    ? undefined
    : options.projectTypes.fieldStorageName(storageOwner, concreteDeclaration);
  if (dispatchSlot === undefined || (storageOwner?.kind === "class" && storageName === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_PROPERTY_STORAGE_MISSING",
      "Selected project method property has no deterministic replacement slot.",
    );
  }
  const registration = options.projectMethodProperties.record(
    declaration,
    request.accessMode,
  );
  if (registration.kind === "rejected") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_PROPERTY_CONFLICT",
      registration.reason,
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "source-method-property",
    operationId: sourceOperationId(context, declaration, "method-property"),
    declaration,
    accessMode: request.accessMode,
    receiverCarrier: selectedReceiverCarrier,
    callableCarrier,
    ...(needsWrite
      ? {
          write: {
            dispatchSlot,
            ownerCarrier: relationship.targetType,
            ...(storageName === undefined ? {} : { storageName }),
          },
        }
      : {}),
    resultCarrier,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: declaration,
    sourceResultType: request.sourceResultType,
  });
}

function selectProjectSourceAccessor(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const readDeclaration = isProjectAccessorDeclaration(
    request.sourceSelectedReadDeclaration,
    "KindGetAccessor",
    context,
  )
    ? request.sourceSelectedReadDeclaration
    : undefined;
  const writeDeclaration = isProjectAccessorDeclaration(
    request.sourceSelectedWriteDeclaration,
    "KindSetAccessor",
    context,
  )
    ? request.sourceSelectedWriteDeclaration
    : undefined;
  const selectedKind = request.sourceSelectedDeclaration === undefined
    ? undefined
    : context.ast.kindName(request.sourceSelectedDeclaration);
  const selectedAccessor = isProjectSourceDeclaration(
    context,
    request.sourceSelectedDeclaration,
  ) && (selectedKind === "KindGetAccessor" || selectedKind === "KindSetAccessor");
  if (!selectedAccessor && readDeclaration === undefined && writeDeclaration === undefined) {
    return undefined;
  }
  const needsRead = request.accessMode === "read" || request.accessMode === "read-write";
  const needsWrite = request.accessMode === "write" || request.accessMode === "read-write";
  if (request.accessMode === "delete" ||
    (needsRead && readDeclaration === undefined) ||
    (needsWrite && writeDeclaration === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_EVIDENCE_MISSING",
      "Project accessor operation requires the exact TSTS-selected getter and setter declarations for its checked access mode.",
    );
  }
  const declarations = [readDeclaration, writeDeclaration].filter(
    (declaration): declaration is Node => declaration !== undefined,
  );
  const owner = declarations[0] === undefined
    ? undefined
    : context.ast.parent(declarations[0]);
  if (owner === undefined || declarations.some((declaration) =>
    context.ast.parent(declaration) !== owner)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_OWNER_CONFLICT",
      "Selected accessor declarations do not belong to one exact project-source owner.",
    );
  }
  const staticAccess = context.ast.hasModifierKind(declarations[0]!, "static");
  if (declarations.some((declaration) =>
    context.ast.hasModifierKind(declaration, "static") !== staticAccess)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_STATIC_CONFLICT",
      "Selected getter and setter declarations disagree on static ownership.",
    );
  }
  const readCarrier = readDeclaration === undefined
    ? undefined
    : context.facts.get(readDeclaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
      resolveRustTargetTypeRef(Node_Type(context.ast, readDeclaration), context, options) ??
      resolveRustTargetTypeRef(request.sourceReadType, context, options);
  const writeParameters = writeDeclaration === undefined
    ? undefined
    : context.ast.parameters(writeDeclaration);
  const writeParameter = writeParameters !== undefined &&
      isDenseDataArray(writeParameters) && writeParameters.length === 1
    ? writeParameters[0]
    : undefined;
  const writeCarrier = writeDeclaration === undefined || writeParameter === undefined
    ? undefined
    : options.sourceCallableAbi.resolveParameterAbi(
        writeParameter,
        context,
        options,
      )?.valueCarrier ??
      resolveRustTargetTypeRef(Node_Type(context.ast, writeParameter), context, options) ??
      resolveRustTargetTypeRef(request.sourceWriteType, context, options);
  if ((needsRead && readCarrier === undefined) ||
    (needsWrite && writeCarrier === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_CARRIER_MISSING",
      "Selected project accessor has no closed Rust carrier for its exact checked read or write type.",
    );
  }
  const readMethod = readDeclaration === undefined
    ? undefined
    : options.projectTypes.memberSlotName(readDeclaration, "read");
  const writeMethod = writeDeclaration === undefined
    ? undefined
    : options.projectTypes.memberSlotName(writeDeclaration, "write");
  if ((needsRead && readMethod === undefined) ||
    (needsWrite && writeMethod === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_SLOT_MISSING",
      "Selected project accessor has no deterministic Rust declaration slot.",
    );
  }
  const typeDefinition = options.projectTypes.definitionContainingDeclaration(
    declarations[0]!,
  );
  const staticCarrier = !staticAccess || typeDefinition === undefined
    ? undefined
    : options.projectTypes.openCarrier(typeDefinition);
  if (staticAccess && staticCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_STATIC_CARRIER_MISSING",
      "Static project accessor has no exact generated Rust owner carrier.",
    );
  }
  const receiverRelationship = staticAccess || typeDefinition === undefined ||
      selectedReceiverCarrier === undefined
    ? undefined
    : options.projectTypes.relationship(selectedReceiverCarrier, typeDefinition);
  if (!staticAccess && (typeDefinition === undefined || selectedReceiverCarrier === undefined ||
    receiverRelationship?.kind !== "related")) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_RECEIVER_NOT_CLOSED",
      "Selected project accessor has no exact receiver-to-declaration relationship.",
    );
  }
  const dispatch = !staticAccess && typeDefinition !== undefined &&
      options.projectTypes.isPolymorphic(typeDefinition) &&
      receiverRelationship?.kind === "related"
    ? { ownerCarrier: receiverRelationship.targetType }
    : undefined;
  const resultCarrier = readCarrier ?? writeCarrier;
  if (resultCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_RESULT_MISSING",
      "Selected project accessor has no exact Rust operation result carrier.",
    );
  }
  const operationId = `tsonic.rust.source.accessor:${request.accessMode}:${[
    readDeclaration === undefined
      ? "-"
      : sourceOperationId(context, readDeclaration, "accessor-read"),
    writeDeclaration === undefined
      ? "-"
      : sourceOperationId(context, writeDeclaration, "accessor-write"),
  ].join(":")}`;
  return acceptRustMemberOperation(request, "property", {
    kind: "source-accessor",
    operationId,
    accessMode: request.accessMode,
    receiver: staticAccess
      ? { kind: "static", typeCarrier: staticCarrier! }
      : { kind: "instance" },
    ...(readMethod === undefined || readCarrier === undefined
      ? {}
      : {
          read: {
            declaration: readDeclaration!,
            method: readMethod,
            resultCarrier: readCarrier,
          },
        }),
    ...(writeMethod === undefined || writeCarrier === undefined
      ? {}
      : {
          write: {
            declaration: writeDeclaration!,
            method: writeMethod,
            valueCarrier: writeCarrier,
          },
        }),
    ...(dispatch === undefined ? {} : { dispatch }),
    resultCarrier,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceSelectedReadDeclaration: readDeclaration,
    sourceSelectedWriteDeclaration: writeDeclaration,
    sourceResultType: request.sourceResultType,
  });
}
