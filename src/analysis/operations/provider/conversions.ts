import { acceptRustMemberOperation, acceptRustOperation, normalizeSelectedOperationInputCarrier, providerIdentityText, providerOperationFact, rejectSelectedOperation, sourceLiteralIsRepresentableAsPrimitive } from "./result.js";
import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import { asNode } from "../../../policy/evidence/selected-source.js";
import { finalizeProviderOperationFact, instantiateProviderOperationTemplate, providerFormRequiresSourceReceiver } from "./calls/instantiation.js";
import { isRustNullishSourceCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { selectRustValueCarrierReconciliation } from "../../../policy/types/value-carrier-reconciliation.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../facts/value-carrier-queries.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustCallableProtocol, rustTargetTypeOpenGenericIdentityKeys } from "../../../target-model/types/index.js";
import { rustSelectedOperationKey } from "../../../target-model/facts/selections.js";
import { rustTargetOperationFactKey, rustProjectDowncastFactKey } from "../../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustProviderOperation } from "../../../policy/operations/provider-selection.js";
import { rustValueConversionIdentity } from "../../../target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import type {
  RustCheckedConversionSelectionInput,
  RustCheckedConversionSelectionResult,
  RustCheckedOperationSelectionResult,
  RustCheckedPropertySelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../policy/operations/contracts.js";
import type { ExtensionFactSubject, Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustProviderFactOperationKind, RustProviderOperationTemplate, RustTargetOperationFact } from "../../facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustCheckedConversion(
  request: RustCheckedConversionSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedConversionSelectionResult> {
  if (request.conversionKind === "call-argument") {
    const targetCarrier = request.targetParameter.type;
    if (rustTargetTypeOpenGenericIdentityKeys(targetCarrier).length > 0) {
      return acceptRustPolicy({}, [
        { message: "rust deferred the selected generic source-call argument carrier to post-check target substitution" },
      ]);
    }
    const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.expression) ??
      resolveRustTargetTypeRef(request.expression, context, options);
    if (sourceCarrier !== undefined && rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument already has the selected target parameter carrier" },
      ]);
    }
    const sourceNode = asNode(request.expression, context);
    const sourceKind = sourceNode === undefined ? "" : context.ast.kindName(sourceNode);
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
      rustTargetTypeRefEquals(targetCarrier.target, sourceCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument borrows into the selected target reference carrier" },
      ]);
    }
    const reconciliation = sourceCarrier === undefined
      ? undefined
      : selectRustValueCarrierReconciliation(
          sourceCarrier,
          targetCarrier,
          options.projectTypes,
          options.sourceGenerics,
        );
    if (reconciliation?.kind === "identity") {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument uses an exact lifetime-safe carrier coercion" },
      ]);
    }
    if (reconciliation?.kind === "project-upcast") {
      recordRustValueCarrierReconciliation(context.facts, request.expression, reconciliation);
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument uses an exact project-type upcast" },
      ]);
    }
    const optionElement = rustOptionElementCarrier(targetCarrier);
    if (optionElement !== undefined) {
      if (isRustNullishSourceCarrier(sourceCarrier)) {
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
  const targetCarrier = resolveRustTargetTypeRef(request.explicitTargetTypeNode, context, options);
  const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.sourceExpression) ??
    resolveRustTargetTypeRef(request.sourceExpression, context, options);
  if (targetCarrier === undefined || sourceCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_CARRIER_MISSING",
      "Checked source assertion has no closed source and target Rust carriers from TSTS evidence.",
    );
  }
  const exactIdentity = rustTargetTypeRefEquals(sourceCarrier, targetCarrier);
  const reconciliation = exactIdentity
    ? { kind: "identity" as const }
    : selectRustValueCarrierReconciliation(
        sourceCarrier,
        targetCarrier,
        options.projectTypes,
        options.sourceGenerics,
      );
  const identity = reconciliation.kind === "identity";
  const projectUpcast = reconciliation.kind === "project-upcast";
  if (projectUpcast) {
    recordRustValueCarrierReconciliation(context.facts, request.expression, reconciliation);
  }
  const projectDowncast = !identity && !projectUpcast && selectProjectDowncast(
    request.expression,
    sourceCarrier,
    targetCarrier,
    context,
    options,
  );
  const conversion = identity || projectUpcast || projectDowncast
    ? undefined
    : selectRustSourceValueConversion(sourceCarrier, targetCarrier);
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
    resultCarrier: targetCarrier,
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
    resultType: targetCarrier,
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
  context.facts.set(request.expression, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.expression, rustSelectedOperationKey, operation, evidence);
  return acceptRustPolicy({ convertedType: targetCarrier, operation }, evidence);
}

function selectProjectDowncast(
  subject: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): boolean {
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const sourceDefinition = options.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = options.projectTypes.definitionForCarrier(targetCarrier);
  const relationship = sourceDefinition === undefined || targetDefinition === undefined ||
      targetDefinition.kind !== "class" || targetDefinition.genericArguments.length !== 0
    ? { kind: "unrelated" as const }
    : options.projectTypes.relationship(targetCarrier, sourceDefinition);
  if (sourceDefinition === undefined || relationship.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, dispatchCarrier) ||
    options.projectTypes.downcastRoute(sourceDefinition, targetCarrier) === undefined) {
    return false;
  }
  context.facts.set(subject, rustProjectDowncastFactKey, {
    sourceCarrier,
    dispatchCarrier,
    targetCarrier,
  }, [{ message: "rust exact project-type downcast" }]);
  return true;
}

export function mapProviderCheckedOperation(
  expression: ExtensionFactSubject,
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderFactOperationKind,
  context: RustOperationPolicyContext,
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
    ? acceptRustOperation(expression, fact, context, provenance)
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
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  selectedReceiverCarrier?: TargetTypeRef,
  selectedArgumentCarriers?: readonly (TargetTypeRef | undefined)[],
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const rawArgumentCarriers = sourceArguments.map((argument, index) =>
    selectedArgumentCarriers?.[index] ??
      rustEffectiveValueCarrier(context.facts, argument) ??
      resolveRustTargetTypeRef(argument, context, options));
  const rawReceiverCarrier = selectedReceiverCarrier ?? (sourceReceiver === undefined
    ? undefined
    : resolveRustTargetTypeRef(sourceReceiver, context, options));
  const instantiation = instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: rawArgumentCarriers,
  });
  if (instantiation === undefined) {
    return undefined;
  }
  const instantiatedTemplate = instantiation.template;
  const sourceArgumentCarriers = sourceArguments.map((argument, index) => {
    const resolved = selectedArgumentCarriers?.[index] ??
      rustEffectiveValueCarrier(context.facts, argument) ??
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
  return finalizeProviderOperationFact(
    instantiatedTemplate,
    sourceArgumentCarriers as TargetTypeRef[],
    sourceReceiverCarrier,
    instantiation.typeRequirements,
  );
}
