import { requireRustRecord } from "../../program/records/required-records.js";
import { rustIterableTargetPolicy, selectRustIterationLowering } from "../../../policy/operations/iteration/index.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import {
  isProjectSourceDeclaration,
  resolveSelectedProviderDeclaration,
} from "../../../policy/identities/selected-source.js";
import {
  isRustCopyCarrier,
  isRustJsArrayLikeCarrier,
  isRustStringCarrier,
} from "../../../target-model/types/index.js";
import {
  KindArrayLiteralExpression,
  KindCallExpression,
  KindNewExpression,
  KindNonNullExpression,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  Node_Expression,
  Node_Type,
  sourceParameterIsProperty,
} from "@tsonic/target-api/source";
import {
  rustFixedArrayCarrierValue,
  rustSourcePrimitiveTargetType,
} from "../../../target-model/types/index.js";
import { acceptDeclarationOperation, acceptRustMemberOperation, acceptRustOperation, elementProvenance, isDeclarationFileSubject, normalizeSelectedOperationInputCarrier, rejectSelectedOperation, selectedArgumentMatchScore, selectedMemberReceiverCarrier, sourceOperationId } from "./result.js";
import { normalizeSelectedLiteralCarrier } from "../../expressions/selected-literals.js";
import { finalizeProviderOperationFromSubjects, mapProviderCheckedOperation } from "./conversions.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution/index.js";
import { selectRustNativeIndex } from "../../../policy/operations/native-indices.js";
import { rustProjectObjectIndexSignature } from "../../project-types/object-layout.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectedValueCarrier } from "../selected-values.js";
import { canRequireSourceClone } from "./clone-requirements.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { selectJsSurfaceMemberRead } from "../../../policy/operations/source-profiles/js/member-reads.js";
import { selectRustSourceProfileIndexMembers } from "./selected-members.js";
import { selectRustFixedArrayElementAccess } from "./structural-properties.js";
import { isIntrinsicSourceQualifier } from "./source-qualifiers.js";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import type { RustCheckedElementSelectionInput, RustCheckedIterationSelectionInput, RustCheckedOperationSelectionResult, RustPolicySelection } from "../../../policy/operations/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { selectRustNumberArrayUnionMember } from "./number-array-unions.js";
import { selectedRustForInKeys } from "./for-in-keys.js";
import { resolveRustCheckedPropertyAccess } from "./properties.js";
import { resolveRustIndexedField } from "../../../policy/types/resolution/indexed-fields.js";
import { selectRustRecordElement } from "./records.js";
import { rustRecordCarrierValue } from "../../../target-model/types/carriers/records.js";

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
        ? context.currentSemantics.types.structuralMembers(request.sourceReceiverType, request.sourceReceiverType, "read")
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
      ? receiverCarrier.referent
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
    const template: RustProviderOperationTemplate = {
      kind: "provider-operation",
      operationId: `tsonic.rust.native.${nativeIndexIdentity.ownerName}.index`,
      operationKind: "indexer",
      target: { form: "index", ...(index.conversion === undefined ? {} : { indexConversion: index.conversion }) },
      resultCarrier: nativeArrayReceiver.element,
      parameterCarriers: [index.carrier],
      evaluation: "pure",
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
      ...((request.accessMode === "read" || request.accessMode === "read-write") && !isRustCopyCarrier(nativeArrayReceiver.element)
        ? { carrierRequirements: [{ carrier: nativeArrayReceiver.element, requirement: "clone" as const }] } : {}),
    };
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

export function selectRustCheckedIteration(
  request: RustCheckedIterationSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const source = request.source;
  if (source.iterationKind === "for-in") {
    const iterable = rustEffectiveValueCarrier(context.records, request.expression) ??
      resolveRustTargetTypeRef(request.expression, context, options);
    const elementCarrier = resolveRustTargetTypeRef(source.sourceElementType, context, options);
    if (elementCarrier === undefined || !isRustStringCarrier(elementCarrier)) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_KEY_CARRIER_UNSUPPORTED",
        "Rust property-key iteration requires the exact checked source key to map to String.",
      );
    }
    const lowering = rustPropertyKeyIterationLowering(iterable, request.expression, context, options);
    if (iterable === undefined || lowering === undefined) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_CARRIER_UNSUPPORTED",
        "The selected Rust receiver carrier has no closed property-key iteration policy.",
      );
    }
    const fact: RustTargetOperationFact = {
      kind: "iteration",
      operationId: `tsonic.rust.iteration.for-in.${lowering.kind}`,
      iterationKind: "for-in",
      iterableCarrier: iterable,
      elementCarrier,
      lowering,
    };
    return acceptRustOperation(fact, {
      sourceExpression: request.expression,
      sourceResultType: source.sourceElementType,
    }, elementCarrier);
  }
  const iterable = rustEffectiveValueCarrier(context.records, request.expression) ??
    resolveRustTargetTypeRef(request.expression, context, options);
  const targetIteration = rustIterableTargetPolicy(iterable, context.typeDefinitions);
  if (targetIteration === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_CARRIER_UNSUPPORTED",
      `Selected ${source.iterationKind} iteration receiver is not a finalized supported Rust iterable carrier.`,
    );
  }
  const lowering = selectRustIterationLowering(
    source,
    targetIteration,
    isFreshRustIterationValue(request.expression, context.ast),
  );
  if (lowering === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_MECHANISM_UNSUPPORTED",
      `Selected ${source.iterationKind} mechanism is incompatible with the finalized Rust iterable carrier.`,
    );
  }
  const fact: RustTargetOperationFact = {
    kind: "iteration",
    operationId: `tsonic.rust.iteration.${source.iterationKind}.${lowering.kind}${lowering.kind === "receiver-method" ? `.${lowering.name}` : ""}`,
    iterationKind: source.iterationKind,
    elementCarrier: targetIteration.elementCarrier,
    lowering,
  };
  return acceptRustOperation(fact, {
    sourceExpression: request.expression,
    sourceResultType: source.sourceElementType,
  }, targetIteration.elementCarrier);
}

type RustPropertyKeyIterationLowering = Extract<
  RustTargetOperationFact,
  { readonly kind: "iteration"; readonly iterationKind: "for-in" }
>["lowering"];

function rustPropertyKeyIterationLowering(
  iterable: TargetTypeRef | undefined,
  expression: Node,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPropertyKeyIterationLowering | undefined {
  if (iterable?.kind === "array" ||
    (iterable?.kind === "reference" && iterable.referent.kind === "slice") ||
    rustFixedArrayCarrierValue(iterable) !== undefined) {
    return { kind: "dense-index-keys" };
  }
  if (isRustJsArrayLikeCarrier(iterable)) {
    return { kind: "js-array-index-keys" };
  }
  if (isRustStringCarrier(rustRecordCarrierValue(iterable)?.key)) return { kind: "record-keys" };
  const keys = iterable === undefined
    ? undefined
    : selectedRustForInKeys(expression, iterable, context, options);
  return keys === undefined ? undefined : { kind: "static-keys", keys };
}


function isFreshRustIterationValue(
  expression: Node,
  ast: import("@tsonic/tsts").AstReader,
): boolean {
  const kind = ast.kindName(expression);
  if (kind === KindCallExpression || kind === KindNewExpression || kind === KindArrayLiteralExpression) {
    return true;
  }
  if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
    kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
    kind !== "KindTypeAssertionExpression" && kind !== "KindAwaitExpression") {
    return false;
  }
  const inner = Node_Expression(ast, expression);
  return inner !== undefined && isFreshRustIterationValue(inner, ast);
}
