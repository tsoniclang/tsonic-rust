import { requireRustRecord } from "../program/records/required-records.js";

import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { isProjectSourceDeclaration, resolveSelectedProviderDeclaration } from "../../policy/identities/selected-source.js";
import { Node_Type, sourceParameterIsProperty } from "@tsonic/target-api/source";
import { rustFixedArrayCarrierValue, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { acceptRustMemberOperation, isDeclarationFileSubject, normalizeSelectedOperationInputCarrier, rejectSelectedOperation, selectedArgumentMatchScore, selectedMemberReceiverCarrier, sourceOperationId } from "./members/result.js";
import { acceptDeclarationOperation, elementProvenance } from "../program/records/selected-operation-values.js";
import { normalizeSelectedLiteralCarrier } from "../source-evidence/types/resolution/selected-literals.js";
import { finalizeProviderOperationFromSubjects, mapProviderCheckedOperation } from "./members/conversions.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { selectRustNativeIndex } from "../../policy/operations/collections/native-indices.js";
import { selectRustNativeArrayElementPlan } from "../../policy/operations/collections/native-arrays.js";
import { rustProjectObjectIndexSignature } from "../project-types/object-layout.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectedValueCarrier } from "./selected-values.js";
import { canRequireSourceClone } from "./members/clone-requirements.js";

import { selectJsSurfaceMemberRead } from "../../policy/operations/source-profiles/js/member-reads.js";
import { selectRustSourceProfileIndexMembers } from "./members/selected-members.js";
import { selectRustFixedArrayElementAccess } from "./collections/fixed-arrays.js";
import { isIntrinsicSourceQualifier } from "./members/source-qualifiers.js";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import type { RustCheckedElementSelectionInput, RustCheckedOperationSelectionResult, RustPolicySelection } from "../../policy/model/contracts.js";

import type { RustOperationsProviderOptions } from "./members/model.js";

import { selectRustNumberArrayUnionMember } from "./members/number-array-unions.js";

import { resolveRustCheckedPropertyAccess } from "./member-access.js";
import { resolveRustIndexedField } from "../source-evidence/types/resolution/indexed-fields.js";
import { selectRustRecordElement } from "./members/records.js";

export function resolveRustCheckedElementAccess(
  request: RustCheckedElementSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selectedReceiverCarrier = selectedMemberReceiverCarrier(request, context, options);
  if (request.optionalChain === true && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_EVIDENCE_MISSING", "Optional-chain element access has no exact TSTS-selected non-null receiver type.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
  if (isIntrinsicSourceQualifier(request, context, options)) {
    return acceptDeclarationOperation("indexer");
  }
  const record = selectRustRecordElement(request, selectedReceiverCarrier, context, options);
  if (record !== undefined) return record;
  const indexed = request.sourceReceiverType === undefined ? undefined
    : context.semanticsFor(request.expression).types.selectIndexedAccess(request.sourceReceiverType, request.sourceArgumentType);
  const indexMembers = selectRustSourceProfileIndexMembers(request, context, options, indexed);
  const jsMembers = indexMembers?.profile === "js" ? indexMembers.members : undefined;
  const jsIdentity = jsMembers?.[0];
  const selectedArgumentCarrier = jsMembers === undefined ? undefined : selectedValueCarrier(
    request.argument, request.sourceArgumentType, context, options);
  const selectedIndexOperation = jsMembers === undefined ? undefined : selectJsSurfaceMemberRead(jsMembers, {
    operationKind: "indexer",
    accessMode: request.accessMode,
    ...(selectedReceiverCarrier === undefined ? {} : { receiverCarrier: selectedReceiverCarrier }),
    argumentCarriers: [selectedArgumentCarrier],
    argumentMatchScore: selectedArgumentMatchScore([request.argument], context, options),
    canRequireClone: carrier => canRequireSourceClone(carrier, request.expression, context, options.sourceTypes.typeFamilies),
  }, indexMembers?.readonly === true, context.typeDefinitions);
  if (selectedIndexOperation === undefined && request.sourceReceiverType !== undefined && request.sourceSelectedSymbol !== undefined &&
    request.sourceSelectedElementIndex === undefined) {
    const declarationKind = request.sourceSelectedDeclaration === undefined ? undefined :
      context.ast.kindName(request.sourceSelectedDeclaration);
    if (request.sourceSelectedDeclaration !== undefined && declarationKind !== undefined && (["KindPropertyDeclaration", "KindPropertySignature",
      "KindPropertyAssignment", "KindShorthandPropertyAssignment", "KindGetAccessor", "KindSetAccessor",
      "KindMethodDeclaration", "KindMethodSignature"].includes(declarationKind) ||
      sourceParameterIsProperty(context.ast, request.sourceSelectedDeclaration)) &&
      context.currentSemantics.declarations.symbolDeclarations(request.sourceSelectedSymbol)
        .includes(request.sourceSelectedDeclaration)) {
      const declarations = declarationKind === "KindGetAccessor" || declarationKind === "KindSetAccessor"
        ? context.currentSemantics.types.structuralMembers(request.sourceReceiverType, request.sourceReceiverType, "correspondence")
        : undefined;
      const matches = declarations?.kind === "available" ? declarations.members.filter(pair =>
        pair.kind === "present" && pair.source.property.symbol === request.sourceSelectedSymbol) : [];
      const selectedMember = matches.length === 1 && matches[0]?.kind === "present" ? matches[0].source : undefined;
      const result = resolveRustCheckedPropertyAccess({ ...request,
        ...(selectedMember?.getters.length === 1 ? { sourceSelectedReadDeclaration: selectedMember.getters[0]! } : {}),
        ...(selectedMember?.setters.length === 1 ? { sourceSelectedWriteDeclaration: selectedMember.setters[0]! } : {}),
      }, context, options);
      if (result.kind === "accept") {
        const selected = result.value.targetFact;
        if (selected === undefined) return rejectSelectedOperation(request.expression, context,
          "RUST_COMPUTED_MEMBER_OPERATION_NOT_CLOSED",
          "Computed project member requires its exact sealed target operation.");
        const evaluateReceiver = selected.kind === "source-static-field" ? selected.classReceiver !== undefined
          : selected.kind !== "source-accessor" || selected.receiver.kind !== "static" ||
            request.sourceReceiverValueDeclaration !== options.projectTypes.definitionContainingDeclaration(request.sourceSelectedDeclaration)?.declaration;
        requireRustRecord(context.requiredRecords, "computedMember", request.expression,
          "checked computed member", "resolveRustCheckedElementAccess");
        context.records.computedMembers.evaluate(context.ast, request.expression,
          request.receiver, request.argument, request.accessMode, evaluateReceiver);
      }
      return result;
    }
  }
  if (request.sourceReceiverType !== undefined && request.accessMode !== "delete" && indexed?.kind === "deferred") {
    const selected = resolveRustIndexedField(request.sourceReceiverType, request.sourceArgumentType,
      context, options, new Set(), selectedReceiverCarrier);
    if (selected?.result.kind !== "associated-type" || selectedReceiverCarrier === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_DEPENDENT_FIELD_NOT_PROVEN",
        "Dependent indexed access requires an exact native owner, key and associated field type.");
    }
    return acceptRustMemberOperation(request, "indexer", {
      kind: "source-indexed-field", operationId: sourceOperationId(context, request.expression, "indexed-field"),
      receiverCarrier: selectedReceiverCarrier, keyCarrier: selected.key, projection: selected.result, resultCarrier: selected.result,
      accessMode: request.accessMode,
    }, context, options, elementProvenance(request));
  }
  const sourceProfileIdentity = indexMembers?.members[0];
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSymbol, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked element access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected" && sourceProfileIdentity === undefined) {
    if (tsonicFixedArrayProviderMember(providerEvidence.identity) === "index") {
      return selectRustFixedArrayElementAccess(
        request,
        selectedReceiverCarrier,
        context,
        options,
      );
    }
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "indexer", context, options, request.receiver, [request.argument], request, selectedReceiverCarrier);
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const index = rustProjectObjectIndexSignature(declaration, options.projectTypes);
    const owner = index === undefined
      ? undefined
      : options.projectTypes.definitionContainingDeclaration(index.declaration);
    const relationship = owner === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.relationship(selectedReceiverCarrier, owner);
    const declaredKeyCarrier = index === undefined
      ? undefined
      : resolveRustTargetTypeRef(Node_Type(context.ast, index.keyParameter), context, options);
    const declaredValueCarrier = index === undefined
      ? undefined
      : resolveRustTargetTypeRef(Node_Type(context.ast, index.declaration), context, options);
    const keyCarrier = declaredKeyCarrier === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.instantiateMemberCarrier(
          index!.keyParameter,
          selectedReceiverCarrier,
          declaredKeyCarrier,
        );
    const resultCarrier = declaredValueCarrier === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.instantiateMemberCarrier(
          index!.declaration,
          selectedReceiverCarrier,
          declaredValueCarrier,
        );
    const selectedKeyCarrier = normalizeSelectedLiteralCarrier(
      request.argument,
      selectedValueCarrier(
        request.argument,
        request.sourceArgumentType,
        context,
        options,
      ),
      keyCarrier,
      context,
      options,
    );
    const storageName = owner === undefined || index === undefined
      ? undefined
      : options.projectTypes.fieldStorageName(owner, index.declaration);
    if (index !== undefined) {
      if (owner?.kind !== "interface" || relationship?.kind !== "related" ||
        options.projectTypes.isPolymorphic(owner) || keyCarrier === undefined ||
        resultCarrier === undefined || selectedKeyCarrier === undefined ||
        storageName === undefined || !rustTargetTypeRefEquals(keyCarrier, selectedKeyCarrier)) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_INDEX_SIGNATURE_NOT_CLOSED",
          "Selected project index signature has no exact non-polymorphic Rust map storage, key carrier, and value carrier.",
        );
      }
      return acceptRustMemberOperation(request, "indexer", {
        kind: "source-index-signature",
        operationId: sourceOperationId(context, index.declaration, "index-signature"),
        accessMode: request.accessMode,
        receiverCarrier: selectedReceiverCarrier!,
        keyCarrier,
        storage: { kind: "project-field", name: storageName },
        writable: !context.ast.hasModifierKind(index.declaration, "readonly"),
        resultCarrier,
      }, context, options, elementProvenance(request));
    }
  }

  const receiverCarrier = selectedReceiverCarrier;
  const numericArrayMember = selectRustNumberArrayUnionMember(request, receiverCarrier, context, options);
  if (numericArrayMember !== undefined) return numericArrayMember;
  if (receiverCarrier?.kind === "tuple") {
    const index = request.sourceSelectedElementIndex;
    const resultCarrier = index === undefined ? undefined : receiverCarrier.elements[index];
    if (index === undefined || resultCarrier === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_TUPLE_INDEX_NOT_PROVEN", "Tuple element access requires a TSTS-selected fixed ordinal within the tuple bounds.");
    }
    return acceptRustMemberOperation(request, "indexer", {
      kind: "tuple-index",
      operationId: `tsonic.rust.tuple.index.${index}`,
      index,
      resultCarrier,
    }, context, options, elementProvenance(request));
  }
  const fixedReceiver = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedReceiver !== undefined) {
    return selectRustFixedArrayElementAccess(
      request,
      receiverCarrier,
      context,
      options,
    );
  }

  const nativeArrayReceiver = receiverCarrier?.kind === "array"
    ? receiverCarrier
    : receiverCarrier?.kind === "reference" && receiverCarrier.referent.kind === "slice"
      ? { ...receiverCarrier, referent: receiverCarrier.referent }
      : undefined;
  const nativeIndexIdentity = sourceProfileIdentity?.profile === "native" ? sourceProfileIdentity
    : receiverCarrier?.kind === "reference" && receiverCarrier.referent.kind === "slice" ? jsIdentity : undefined;
  if (nativeIndexIdentity !== undefined &&
    (nativeIndexIdentity.ownerName === "Array" || nativeIndexIdentity.ownerName === "ReadonlyArray") &&
    nativeIndexIdentity.memberName === "index" &&
    nativeArrayReceiver !== undefined) {
    const sourceIndex = selectedValueCarrier(request.argument, request.sourceArgumentType, context, options);
    const index = selectRustNativeIndex(sourceIndex) ?? selectRustNativeIndex(normalizeSelectedOperationInputCarrier(
      request.argument, sourceIndex, rustSourcePrimitiveTargetType("int32"), context, options,
    ));
    if (index === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_NATIVE_INDEX_CARRIER_UNSUPPORTED",
        "Native indexing requires an exact integer carrier.");
    }
    const template = selectRustNativeArrayElementPlan(nativeIndexIdentity.ownerName, nativeArrayReceiver, index, request.accessMode);
    const fact = finalizeProviderOperationFromSubjects(template, request.receiver, [request.argument], context, options, selectedReceiverCarrier, [index.carrier]);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", "Native array indexing cannot finalize one total Rust operation ABI.");
    }
    return acceptRustMemberOperation(request, "indexer", fact, context, options, elementProvenance(request));
  }

  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected index signature belongs to the explicit JavaScript source profile, which is not active.");
    }
    const selection = selectedIndexOperation;
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript index signature '${jsIdentity.ownerName}' has no closed Rust operation row for this receiver carrier.`,
        [{
          message: `receiver=${JSON.stringify(receiverCarrier)}; argument=${JSON.stringify(selectedArgumentCarrier)}`,
        }],
      );
    }
    const fact = finalizeProviderOperationFromSubjects(
      selection.fact,
      request.receiver,
      [request.argument],
      context,
      options,
      selectedReceiverCarrier,
      [selectedArgumentCarrier],
    );
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `The selected JavaScript indexer '${jsIdentity.ownerName}.${jsIdentity.memberName}' cannot finalize one total Rust operation ABI.`);
    }
    return acceptRustMemberOperation(request, "indexer", fact, context, options, elementProvenance(request));
  }

  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
  return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_EVIDENCE_MISSING", "Checked element access has no selected provider, source-profile, tuple, or fixed-array evidence.");
}
