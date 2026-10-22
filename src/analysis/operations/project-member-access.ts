import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { isProjectSourceDeclaration } from "../../policy/identities/selected-source.js";
import { acceptRustMemberOperation, rejectSelectedOperation, sourceOperationId } from "./members/result.js";

import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { isProjectAccessorDeclaration } from "./members/structural-properties.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveRustProjectAccessor } from "./members/project-accessors.js";

import { rustCallableProtocol } from "../../target-model/types/index.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../policy/model/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./members/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function selectExternalProjectFieldAccess(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
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

export function selectProjectSourceMethodProperty(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
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
  const usage = options.projectMethodProperties.usageFor(declaration);
  if (usage === undefined || needsRead && !usage.readable || needsWrite && !usage.writable)
    failTargetAnalysisInvariant("tsonic-rust", "A checked method-property use requires its completed usage selection.", request.expression);
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

export function selectProjectSourceAccessor(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
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
  const selected = resolveRustProjectAccessor({
    readDeclaration, writeDeclaration, sourceReceiverType: request.sourceReceiverType,
    sourceReadType: request.sourceReadType, sourceWriteType: request.sourceWriteType,
  }, selectedReceiverCarrier, context, options);
  if (selected === undefined) return rejectSelectedOperation(request.expression, context,
    "RUST_PROJECT_ACCESSOR_CARRIER_MISSING",
    "Selected accessor declarations require exact receiver, native carrier and slot contracts.");
  const operationId = `tsonic.rust.source.accessor:${request.accessMode}:${[
    readDeclaration === undefined
      ? "-"
      : sourceOperationId(context, readDeclaration, "accessor-read"),
    writeDeclaration === undefined
      ? "-"
      : sourceOperationId(context, writeDeclaration, "accessor-write"),
  ].join(":")}`;
  return acceptRustMemberOperation(request, "property", {
    ...selected, operationId, accessMode: request.accessMode,
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
