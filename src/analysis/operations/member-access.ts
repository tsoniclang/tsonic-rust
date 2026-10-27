import { selectExternalProjectFieldAccess, selectProjectSourceMethodProperty, selectProjectSourceAccessor } from "./project-member-access.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { isProjectSourceDeclaration, resolveSelectedJsSourceMember, resolveSelectedProviderDeclaration, resolveSelectedSourceProfilePropertyMembers } from "../../policy/identities/selected-source.js";
import { acceptRustMemberOperation, isDeclarationFileSubject, rejectSelectedOperation, selectedDeclarationIsCallable, selectedMemberReceiverCarrier, sourceOperationId } from "./members/result.js";
import { acceptDeclarationOperation, acceptRustOperation } from "../program/records/operations/selected-operation-values.js";
import { finalizeProviderOperationFromSubjects, mapProviderCheckedOperation } from "./members/conversions.js";

import { selectStructuralSourceProperty } from "./members/structural-properties.js";
import { selectRustFixedArrayLengthProperty } from "./collections/fixed-arrays.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";

import { resolveRustProjectField } from "./members/project-fields.js";
import { rustSourceTypeCarrier } from "../../target-model/types/index.js";
import { rustProjectStaticFieldStorage } from "../project-types/object-layout.js";

import { selectJsSurfaceOperation } from "../../policy/operations/source-profiles/js/selection.js";
import { selectRustGeneratorSourceProperty } from "../../policy/operations/source-profiles/generator-source-profile.js";
import { selectRustBuiltinErrorProperty } from "./members/builtin-errors.js";
import { isIntrinsicSourceQualifier } from "./members/source-qualifiers.js";
import { selectedRustProviderGlobal } from "../../policy/identities/provider-globals.js";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import { selectRustRecordDelete } from "./members/records.js";
import type { RustCheckedDeleteSelectionInput, RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../policy/model/contracts.js";
import type { Node, ResolvedSourcePropertyAccessInfo } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./members/model.js";

import { selectRustNumberArrayUnionMember } from "./members/number-array-unions.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { selectRustRecordProperty } from "./members/records.js";
import { selectRustUnionProperty } from "./union-properties.js";
import { selectRustGuardedSourceValueTypes } from "./native-flow-refinement.js";
import { selectJsSurfaceMemberRead } from "../../policy/operations/source-profiles/js/member-reads.js";
import { resolveRustIndexedProperty } from "../source-evidence/types/resolution/indexed-fields.js";

export function checkedPropertySelectionInput(
  context: RustOperationAnalysisContext,
  expression: Node,
  source: ResolvedSourcePropertyAccessInfo,
): RustCheckedPropertySelectionInput {
  const receiverReference = context.source.navigation.sourceReferenceFor(source.receiver.expression);
  return {
    target: "rust",
    expression,
    receiver: source.receiver.expression,
    sourceReceiverType: source.receiver.type,
    ...(source.receiver.declaration === undefined ? {} : { sourceReceiverDeclaration: source.receiver.declaration }),
    ...(receiverReference?.declaration === undefined ? {} : { sourceReceiverValueDeclaration: receiverReference.declaration }),
    ...(source.receiver.intrinsic === undefined ? {} : { sourceReceiverIntrinsic: source.receiver.intrinsic }),
    accessMode: source.accessMode,
    ...(source.selectedSymbol === undefined ? {} : { sourceSelectedSymbol: source.selectedSymbol }),
    ...(source.selectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: source.selectedDeclaration }),
    ...(source.selectedReadDeclaration === undefined ? {} : { sourceSelectedReadDeclaration: source.selectedReadDeclaration }),
    ...(source.selectedWriteDeclaration === undefined ? {} : { sourceSelectedWriteDeclaration: source.selectedWriteDeclaration }),
    ...(source.selectedIndex === undefined ? {} : { sourceSelectedIndex: source.selectedIndex }),
    ...(source.sourceReadType === undefined ? {} : { sourceReadType: source.sourceReadType }),
    ...(source.sourceWriteType === undefined ? {} : { sourceWriteType: source.sourceWriteType }),
    sourceResultType: source.sourceReadType ?? source.sourceWriteType,
    optionalChain: source.optionalChain,
  };
}

export function selectRustCheckedDelete(
  request: RustCheckedDeleteSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const record = selectRustRecordDelete(request, context, options);
  if (record !== undefined) return record;
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
  const indexCarrier = resolveRustTargetTypeRef(request.index, context, options);
  const selection = selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind: "delete",
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    argumentCarriers: [indexCarrier],
  }, context.typeDefinitions);
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
  return acceptRustOperation(fact, {
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

export function resolveRustCheckedPropertyAccess(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationAnalysisContext,
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
  if (isIntrinsicSourceQualifier(request, context, options)) {
    return acceptDeclarationOperation("property");
  }
  const global = request.sourceReceiverIntrinsic === "global-object" &&
    request.accessMode === "read" && request.optionalChain !== true
    ? selectedRustProviderGlobal(request.sourceSelectedDeclaration, context, options.providerExports)
    : undefined;
  if (global !== undefined) {
    return mapProviderCheckedOperation(request.expression, global, "property", context, options, undefined, []);
  }
  const unionProperty = selectRustUnionProperty(request, selectedReceiverCarrier, context, options);
  if (unionProperty !== undefined) return unionProperty;
  const numericArrayMember = selectRustNumberArrayUnionMember(request, selectedReceiverCarrier, context, options);
  if (numericArrayMember !== undefined) return numericArrayMember;
  const record = selectRustRecordProperty(request, selectedReceiverCarrier, context, options);
  if (record !== undefined) return record;
  if (selectedReceiverCarrier?.kind === "type-parameter" && request.sourceReceiverType !== undefined &&
    request.sourceSelectedSymbol !== undefined && request.accessMode !== "delete") {
    const field = resolveRustIndexedProperty(request.sourceReceiverType,
      request.sourceSelectedSymbol, context, options, selectedReceiverCarrier);
    if (field !== undefined) return acceptRustMemberOperation(request, "property", {
      kind: "source-indexed-field", operationId: sourceOperationId(context, request.expression, "indexed-field"),
      receiverCarrier: selectedReceiverCarrier, keyCarrier: field.key,
      projection: field.projection, resultCarrier: field.result, accessMode: request.accessMode,
    }, context, options, { sourceExpression: request.expression, sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
      sourceResultType: request.sourceResultType });
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
  const externalProjectField = selectExternalProjectFieldAccess(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (externalProjectField !== undefined) {
    return externalProjectField;
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
    request.sourceReceiverType === undefined ? undefined :
      selectRustGuardedSourceValueTypes(request.receiver, request.sourceReceiverType, context, options),
  );
  const builtinError = selectRustBuiltinErrorProperty(
    request, selectedReceiverCarrier, sourceProfileMembers, context, options,
  );
  if (builtinError !== undefined) return builtinError;
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

  const jsIdentity = sourceProfileMembers?.profile === "js" ? sourceProfileMembers.members[0] : undefined;
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected property belongs to the explicit JavaScript source profile, which is not active.");
    }
    const receiverCarrier = selectedReceiverCarrier;
    const propertyNameNode = context.ast.name(request.expression);
    const authoredPropertyKey = propertyNameNode === undefined
      ? undefined
      : context.ast.text(propertyNameNode);
    const selection = selectJsSurfaceMemberRead(sourceProfileMembers!.members, {
      operationKind: "property",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      ...(jsIdentity.memberName === "index" && authoredPropertyKey !== undefined
        ? { authoredPropertyKey }
        : {}),
    }, true, context.typeDefinitions);
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
      const direct = request.sourceReceiverValueDeclaration === owner?.declaration;
      const constructor = direct ? undefined : rustClassConstructorInstance(resolveRustTargetTypeRef(request.receiver, context, options));
      if (owner?.kind !== "class" || !direct && (constructor === undefined || options.projectTypes.definitionForCarrier(constructor) !== owner)) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_STATIC_FIELD_RECEIVER_NOT_EXACT",
          "Project static-field access requires exact TSTS-selected receiver value evidence for the declaring class.",
        );
      }
      const resultCarrier = resolveRustTargetTypeRef(declaration, context, options);
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
        declaration,
        ...(!direct ? { classReceiver: request.receiver } : {}),
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
    if (context.ast.kindName(declaration) === "KindEnumMember") {
      const memberName = context.ast.text(context.ast.name(declaration));
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
        const definition = context.typeDefinitions.sourceEnumDefinition(resultCarrier);
        if (definition === undefined) return rejectSelectedOperation(request.expression, context,
          "RUST_ENUM_DECLARATION_NOT_CLOSED", "Selected enum member requires its completed emitted native declaration.");
        const operationId = sourceOperationId(context, declaration, "enum-member");
        return acceptRustMemberOperation(request, "property", {
          kind: "source-enum-member",
          operationId,
          name: memberName,
          enumRepresentation: { kind: "integer", integerWidth: definition.integerWidth },
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
    const field = selectedReceiverCarrier === undefined ? undefined : resolveRustProjectField(
      declaration, selectedReceiverCarrier, request.sourceReceiverType, context, options);
    if (field !== undefined) {
      if (request.accessMode === "delete") {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_FIELD_DELETE_UNSUPPORTED",
          "Project fields cannot be deleted because their selected source declaration has no optional-property removal contract.",
        );
      }
      const operationId = sourceOperationId(context, declaration, "field");
      return acceptRustMemberOperation(request, "property", {
        ...field,
        operationId,
        accessMode: request.accessMode,
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
