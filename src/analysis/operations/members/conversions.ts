import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { acceptRustMemberOperation, normalizeSelectedOperationInputCarrier, providerIdentityText, rejectSelectedOperation } from "./result.js";
import { providerOperationFact } from "../../../policy/operations/members/provider-templates.js";
import { acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";
import { sourceLiteralIsRepresentableAsPrimitive } from "../../source-evidence/types/resolution/selected-literals.js";
import { acceptRustPolicy } from "../../../policy/model/contracts.js";
import { asNode } from "../../../policy/identities/selected-source.js";
import { providerFormRequiresSourceReceiver } from "../../../policy/operations/members/call-inputs.js";
import { instantiateProviderOperationTemplate } from "../../../policy/types/callables/provider-templates.js";
import { finalizeProviderOperationFact } from "../../program/records/native/provider-operations.js";
import { isRustAbsenceCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { selectRustValueCarrierReconciliation } from "../../../policy/conversions/value-carrier-reconciliation.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { recordRustValueCarrierReconciliation } from "../../program/records/types/value-carrier-admission.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { rustCallableProtocol, rustTargetTypeContainsTypeParameter } from "../../../target-model/types/index.js";
import { sourceExpressionResultDisposition } from "@tsonic/target-api/source";
import { rustUnitTargetType } from "../../../target-model/types/index.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustProviderOperation } from "../../../policy/operations/provider-selection.js";
import { rustValueConversionIdentity } from "../../../target-model/conversions/contracts.js";
import { selectRustKnownNumericValueConversion, selectRustSourceAssertionConversion } from "../../../policy/conversions/selection.js";
import type { RustCheckedConversionSelectionInput, RustCheckedConversionSelectionResult, RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection, RustTargetOperationSelection } from "../../../policy/model/contracts.js";
import type { ExtensionFactSubject, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustProviderFactOperationKind, RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { selectRustProviderSourceReceiver } from "./source-qualifiers.js";

export function selectRustCheckedConversion(
  request: RustCheckedConversionSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedConversionSelectionResult> {
  if (request.conversionKind === "call-argument") {
    const targetCarrier = request.targetParameter.type;
    const selectedTypeParameterIdentities = new Set(
      request.selectedSignature.member.genericParameters?.flatMap((parameter) =>
        parameter.kind === "type" ? [parameter.targetIdentity] : []) ?? [],
    );
    if (selectedTypeParameterIdentities.size > 0 &&
      rustTargetTypeContainsTypeParameter(targetCarrier, selectedTypeParameterIdentities)) {
      return acceptRustPolicy({}, [
        { message: "rust deferred the selected generic source-call argument carrier to post-check target substitution" },
      ]);
    }
    const sourceCarrier = rustEffectiveValueCarrier(context.records, request.expression) ??
      resolveRustTargetTypeRef(request.expression, context, options);
    if (sourceCarrier !== undefined && rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument already has the selected target parameter carrier" },
      ]);
    }
    const sourceNode = asNode(request.expression, context);
    const sourceKind = sourceNode === undefined ? "" : context.ast.kindName(sourceNode);
    const scalarTarget = rustOptionElementCarrier(targetCarrier) ?? targetCarrier;
    const knownNumeric = sourceCarrier === undefined || sourceNode === undefined ? undefined
      : selectRustKnownNumericValueConversion(sourceCarrier, scalarTarget, context.literalValues.literalValue.get(sourceNode));
    if (knownNumeric !== undefined && sourceNode !== undefined && sourceCarrier !== undefined) {
      recordRustValueCarrierReconciliation(context.records, context.requiredRecords, sourceNode, { kind: "conversion", fact: {
        sourceCarrier, targetCarrier,
        conversion: rustTargetTypeRefEquals(scalarTarget, targetCarrier) ? knownNumeric
          : { kind: "option-some", source: sourceCarrier, element: scalarTarget, elementConversion: knownNumeric },
      } });
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected checked numeric argument uses its native value conversion" },
      ]);
    }
    if ((targetCarrier.kind === "function-pointer" || targetCarrier.kind === "closure" ||
      rustCallableProtocol(targetCarrier) !== undefined) &&
      (sourceKind === "KindArrowFunction" || sourceKind === "KindFunctionExpression")) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected function expression uses the selected target callable carrier" },
      ]);
    }
    if (targetCarrier.kind === "source-primitive" && sourceNode !== undefined &&
      sourceLiteralIsRepresentableAsPrimitive(sourceNode, targetCarrier.name, context)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected literal is representable by the selected target primitive carrier" },
      ]);
    }
    if (targetCarrier.kind === "reference" && sourceCarrier !== undefined &&
      rustTargetTypeRefEquals(targetCarrier.referent, sourceCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument borrows into the selected target reference carrier" },
      ]);
    }
    const reconciliation = sourceCarrier === undefined
      ? undefined
      : selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, options.projectTypes, context.typeDefinitions);
    if (reconciliation?.kind === "identity") {
      return acceptRustPolicy({ convertedType: sourceCarrier }, [
        { message: "rust selected call argument retains its exact native value carrier" },
      ]);
    }
    if (reconciliation?.kind === "conversion") {
      recordRustValueCarrierReconciliation(context.records, context.requiredRecords, request.expression, reconciliation);
      return acceptRustPolicy({ convertedType: reconciliation.fact.targetCarrier }, [
        { message: "rust selected call argument uses its exact selected native conversion carrier" },
      ]);
    }
    if (reconciliation?.kind === "call-scoped-lifetime" ||
      reconciliation?.kind === "project-upcast") {
      recordRustValueCarrierReconciliation(context.records, context.requiredRecords, request.expression, reconciliation);
      const convertedType = reconciliation.kind === "call-scoped-lifetime"
        ? reconciliation.fact.selectedCarrier : reconciliation.fact.targetCarrier;
      return acceptRustPolicy({ convertedType }, [
        { message: reconciliation.kind === "call-scoped-lifetime"
          ? "rust selected call argument uses an exact call-scoped lifetime reconciliation"
          : "rust selected call argument uses an exact project-type upcast" },
      ]);
    }
    const optionElement = rustOptionElementCarrier(targetCarrier);
    if (optionElement !== undefined) {
      if (isRustAbsenceCarrier(sourceCarrier)) {
        return acceptRustPolicy({ convertedType: targetCarrier }, [
          { message: "rust selected nullish argument maps to the selected Option carrier" },
        ]);
      }
      if (rustTargetTypeRefEquals(sourceCarrier, optionElement) ||
        (sourceNode !== undefined && optionElement.kind === "source-primitive" &&
          sourceLiteralIsRepresentableAsPrimitive(sourceNode, optionElement.name, context))) {
        return acceptRustPolicy({ convertedType: targetCarrier }, [
          { message: "rust selected value argument maps to the selected Option element carrier" },
        ]);
      }
    }
    if (sourceCarrier === undefined) {
      return acceptRustPolicy({}, [
        { message: "rust deferred unavailable source carrier to independent post-check operation-input validation" },
      ]);
    }
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED",
      "The TSTS-selected call argument cannot be represented by the selected Rust target parameter carrier.",
    );
  }
  const sourceCarrier = rustEffectiveValueCarrier(context.records, request.sourceExpression) ??
    resolveRustTargetTypeRef(request.sourceExpression, context, options);
  const targetCarrier = sourceExpressionResultDisposition(context.ast, request.expression).kind === "discarded" &&
      rustTargetTypeRefEquals(sourceCarrier, rustUnitTargetType())
    ? sourceCarrier
    : resolveRustTargetTypeRef(request.explicitTargetTypeNode, context, options);
  if (targetCarrier === undefined || sourceCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_CARRIER_MISSING",
      "Checked source assertion has no closed source and target Rust carriers from TSTS evidence.",
    );
  }
  const reconciliation = selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier,
    options.projectTypes, context.typeDefinitions);
  const identity = reconciliation.kind === "identity";
  const selectedCarrier = identity ? sourceCarrier : targetCarrier;
  const projectUpcast = reconciliation.kind === "project-upcast";
  if (projectUpcast) {
    recordRustValueCarrierReconciliation(context.records, context.requiredRecords, request.expression, reconciliation);
  }
  const projectDowncast = !identity && !projectUpcast && context.records.projectDowncasts.resolve(context.requiredRecords,
    request.expression,
    sourceCarrier,
    targetCarrier,
    options.projectTypes,
  ) !== undefined;
  const conversion = identity || projectUpcast || projectDowncast
    ? undefined
    : selectRustSourceAssertionConversion(sourceCarrier, targetCarrier,
      context.literalValues.literalValue.get(request.sourceExpression), context.typeDefinitions);
  if (!identity && !projectUpcast && !projectDowncast && conversion === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_UNSUPPORTED",
      "Checked source assertion does not map to an identity or explicit Rust runtime conversion.",
    );
  }
  const operationId = identity
    ? "tsonic.rust.conversion.identity"
    : projectUpcast
      ? "tsonic.rust.conversion.project-upcast"
      : projectDowncast
        ? "tsonic.rust.conversion.project-downcast"
    : `tsonic.rust.conversion.${rustValueConversionIdentity(conversion!)}`;
  const fact: RustTargetOperationFact = {
    kind: "source-conversion",
    operationId,
    ...(conversion === undefined ? {} : { conversion }),
    resultCarrier: selectedCarrier,
  };
  const operation: RustTargetOperationSelection = {
    operationId,
    operationKind: "operator",
    targetOperation: identity
      ? "identity"
      : projectUpcast
        ? "project-upcast"
        : projectDowncast
          ? "project-downcast"
          : "runtime-conversion",
    resultType: selectedCarrier,
    provenance: {
      sourceExpression: request.sourceExpression,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.target,
    },
  };
  const evidence = [{ message: identity
    ? "rust selected assertion identity conversion"
    : projectUpcast
      ? "rust selected assertion project-type upcast"
      : projectDowncast
        ? "rust selected assertion project-type downcast"
      : `rust selected assertion conversion '${rustValueConversionIdentity(conversion!)}'` }];
  return acceptRustPolicy({ convertedType: selectedCarrier, targetFact: fact, operation }, evidence);
}

export function mapProviderCheckedOperation(
  expression: ExtensionFactSubject,
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderFactOperationKind,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
  memberRequest?: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier?: TargetTypeRef,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selection = selectRustProviderOperation(options.providerRows, identity, operationKind);
  if (selection.kind === "missing") {
    return rejectSelectedOperation(expression, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(identity)}' as ${operationKind}.`);
  }
  if (selection.kind === "ambiguous") {
    return rejectSelectedOperation(expression, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(identity)}' matches ${selection.rows.length} Rust operation rows.`);
  }
  const template = providerOperationFact(selection.row);
  const fact = finalizeProviderOperationFromSubjects(
    template,
    sourceReceiver,
    sourceArguments,
    context,
    options,
    selectedReceiverCarrier,
  );
  if (fact === undefined) {
    return rejectSelectedOperation(expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected provider declaration '${providerIdentityText(identity)}' cannot finalize one total Rust operation ABI.`);
  }
  const provenance = memberRequest === undefined
    ? {
        sourceExpression: expression,
        providerDeclaration: identity,
      }
    : {
        sourceExpression: expression,
        sourceReceiver: memberRequest.receiver,
        sourceSelectedSymbol: memberRequest.sourceSelectedSymbol,
        sourceSelectedDeclaration: memberRequest.sourceSelectedDeclaration,
        sourceSelectedReadDeclaration: memberRequest.sourceSelectedReadDeclaration,
        sourceSelectedWriteDeclaration: memberRequest.sourceSelectedWriteDeclaration,
        sourceResultType: memberRequest.sourceResultType,
        providerDeclaration: identity,
      };
  return memberRequest === undefined
    ? acceptRustOperation(fact, provenance)
    : acceptRustMemberOperation(
        memberRequest,
        operationKind === "indexer" ? "indexer" : "property",
        fact,
        context,
        options,
        provenance,
      );
}

export function finalizeProviderOperationFromSubjects(
  template: RustProviderOperationTemplate,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  selectedReceiverCarrier?: TargetTypeRef,
  selectedArgumentCarriers?: readonly (TargetTypeRef | undefined)[],
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const rawArgumentCarriers = sourceArguments.map((argument, index) =>
    selectedArgumentCarriers?.[index] ??
      rustEffectiveValueCarrier(context.records, argument) ??
      resolveRustTargetTypeRef(argument, context, options));
  const rawReceiverCarrier = selectedReceiverCarrier ?? (sourceReceiver === undefined
    ? undefined
    : resolveRustTargetTypeRef(sourceReceiver, context, options));
  const instantiation = instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: rawArgumentCarriers,
  }, context.typeDefinitions);
  if (instantiation === undefined) {
    return undefined;
  }
  const instantiatedTemplate = instantiation.template;
  const sourceArgumentCarriers = sourceArguments.map((argument, index) => {
    const resolved = selectedArgumentCarriers?.[index] ??
      rustEffectiveValueCarrier(context.records, argument) ??
      resolveRustTargetTypeRef(argument, context, options);
    return normalizeSelectedOperationInputCarrier(
      argument,
      resolved,
      instantiatedTemplate.parameterCarriers?.[index],
      context,
      options,
    );
  });
  if (sourceArgumentCarriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const sourceReceiverCarrier = rawReceiverCarrier;
  if (providerFormRequiresSourceReceiver(instantiatedTemplate.target) && sourceReceiverCarrier === undefined) {
    return undefined;
  }
  const receiver = sourceReceiver === undefined ? undefined
    : selectRustProviderSourceReceiver(sourceReceiver, sourceReceiverCarrier, context, options);
  if (sourceReceiver !== undefined && receiver === undefined) return undefined;
  return finalizeProviderOperationFact(instantiatedTemplate, sourceArgumentCarriers as TargetTypeRef[], receiver,
    context.typeDefinitions, undefined, options.dispatchContextInputFor);
}
