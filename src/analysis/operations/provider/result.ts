import {
  isRustAbsenceCarrier,
  isRustProgramErrorCarrier,
  isRustNumericCarrier,
  rustOptionElementCarrier,
  rustOptionNestingDepth,
  rustOptionValueCarrier,
  isRustJsArrayCarrier,
  isRustVecCarrier,
} from "../../../target-model/types/index.js";
import {
  rustTargetOperationResultCarrier,
  rustTargetOperationFactKey,
  rustPreparedOperationResultFactKey,
  rustFlowReadProjectionFactKey,
  rustOptionalChainFactKey,
} from "../../facts/keys.js";
import { acceptRustPolicy, rejectRustPolicy } from "../../../policy/operations/contracts.js";
import {
  asNode,
  resolveSelectedSourceProfilePropertyMembers,
} from "../../../policy/evidence/selected-source.js";
import { selectRustFlowReadProjection } from "../../../policy/types/value-carrier-reconciliation.js";
import { selectRustGuardedValueCarrier } from "../native-flow-refinement.js";
import { rustRuntimeUnionProjection } from "../../../target-model/types/carriers/runtime-unions.js";
import { recordRustFlowReadProjection } from "../../facts/value-carrier-queries.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { retainRustSourceUnionInstantiation } from "../../../policy/types/resolution/source-unions.js";
import { selectRustProviderObjectLiteralConstruction } from "../../../policy/types/resolution/providers.js";
import { rustCallableProtocol, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import { rustSelectedOperationKey } from "../../../target-model/facts/selections.js";
import { rustTargetOperationText } from "../../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { normalizeSelectedLiteralCarrier, sourceLiteralIsRepresentableAsPrimitive } from "../../expressions/selected-literals.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/source-profiles/js/index.js";
import { selectRustOptionalChain } from "../../../policy/operations/optional-chains.js";
import { selectRustValueCarrierReconciliation } from "../../../policy/types/value-carrier-reconciliation.js";
import { contextualConditionalArgumentMatches } from "./calls/contextual-conditionals.js";
import type {
  RustCheckedElementSelectionInput,
  RustCheckedOperationSelectionResult,
  RustCheckedPropertySelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../policy/operations/contracts.js";
import type {
  RustProviderFactOperationKind,
  RustProviderOperationTemplate,
  RustRuntimeSetOperationKind,
  RustTargetOperationFact,
} from "../../facts/keys.js";
import type { ExtensionFactSubject, Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustProviderOperationRow } from "../../../providers/packages/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function acceptRustOperation(
  subject: ExtensionFactSubject,
  fact: RustTargetOperationFact,
  context: RustOperationPolicyContext,
  provenance: NonNullable<RustTargetOperationSelection["provenance"]>,
  resultType: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const evidence = [{ message: `rust selected operation ${fact.operationId}` }];
  context.facts.set(subject, rustTargetOperationFactKey, fact, evidence);
  const operation: RustTargetOperationSelection = {
    operationId: fact.operationId,
    operationKind: genericOperationKind(fact),
    targetOperation: rustTargetOperationText(fact),
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  };
  context.facts.set(subject, rustSelectedOperationKey, operation, evidence);
  return acceptRustPolicy({
    operation,
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  }, evidence);
}

export function selectedMemberReceiverCarrier(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const receiver = asNode(request.receiver, context);
  const resolvedSourceCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  if (receiver === undefined) {
    return undefined;
  }
  const receiverKind = context.ast.kindName(receiver);
  const containingThisDefinition = receiverKind === "KindThisExpression" ||
      receiverKind === "KindThisKeyword"
    ? options.projectTypes.definitionContainingDeclaration(receiver)
    : undefined;
  const sourceCarrier = containingThisDefinition === undefined
    ? resolvedSourceCarrier
    : options.projectTypes.openCarrier(containingThisDefinition);
  if (request.sourceReceiverType === undefined) {
    return undefined;
  }
  if (sourceCarrier !== undefined) selectRustGuardedValueCarrier(receiver, sourceCarrier, context, options);
  const flowRead = context.facts.get(receiver, rustFlowReadProjectionFactKey) ??
    context.facts.resolve(receiver, rustFlowReadProjectionFactKey);
  const guardedCarrier = request.optionalChain === true ? rustOptionValueCarrier(sourceCarrier) : sourceCarrier;
  if (flowRead !== undefined && !rustTargetTypeRefEquals(sourceCarrier, flowRead.sourceCarrier) &&
    !rustTargetTypeRefEquals(guardedCarrier, flowRead.sourceCarrier)) {
    return undefined;
  }
  const refinedCarrier = flowRead?.selectedCarrier ?? sourceCarrier;
  const sourceRefinement = context.source.semantics.selectValueTypeRefinement(receiver);
  const sourceUnionCarrier = rustOptionElementCarrier(refinedCarrier) ?? refinedCarrier;
  const sourceUnion = sourceUnionCarrier === undefined
    ? undefined
    : options.sourceTypes.sourceUnionForCarrier(sourceUnionCarrier);
  if (sourceUnion !== undefined && sourceUnionCarrier !== undefined &&
    options.sourceTypes.sourceUnionVariantIndexesForTypes(sourceUnionCarrier, [request.sourceReceiverType]) === undefined) {
    const declaredType = sourceRefinement.kind === "resolved"
      ? context.currentSemantics.types.withoutMissingOrUndefined(sourceRefinement.declaredType)
      : undefined;
    const declaration = sourceUnion.declaration ?? (declaredType === undefined ? undefined :
      context.currentSemantics.types.aliasApplication(declaredType)?.declaration);
    const declaredCarrier = declaration === undefined ? undefined : options.sourceTypes.carrierForDeclaration(declaration, context.ast);
    const templateCarrier = rustOptionElementCarrier(declaredCarrier) ?? declaredCarrier;
    const template = templateCarrier === undefined ? undefined : options.sourceTypes.sourceUnionForCarrier(templateCarrier);
    if (declaredType !== undefined && declaration !== undefined && template !== undefined) {
      retainRustSourceUnionInstantiation(
        declaredType, template, sourceUnionCarrier, context, options, declaration,
      );
    }
  }
  if (flowRead === undefined && sourceCarrier !== undefined && sourceRefinement.kind === "resolved" &&
    context.currentSemantics.types.isIdentical(sourceRefinement.declaredType, request.sourceReceiverType)) {
    return request.optionalChain === true ? rustOptionValueCarrier(sourceCarrier) : sourceCarrier;
  }
  if (request.optionalChain === true && rustOptionElementCarrier(sourceCarrier) !== undefined) {
    const indexes = sourceUnionCarrier === undefined ? undefined :
      options.sourceTypes.sourceUnionVariantIndexesForTypes(sourceUnionCarrier, [request.sourceReceiverType]);
    return indexes?.length === 1 ? sourceUnion?.variants[indexes[0]!]!.carrier : guardedCarrier;
  }
  if (flowRead !== undefined) return flowRead.selectedCarrier;
  if (sourceUnion !== undefined && sourceUnionCarrier !== undefined && refinedCarrier !== undefined &&
    sourceRefinement.kind === "resolved" && sourceRefinement.refinement.kind === "members") {
    const indexes = options.sourceTypes.sourceUnionVariantIndexesForTypes(
      sourceUnionCarrier, sourceRefinement.refinement.types,
    );
    const selected = indexes?.length === 1 ? sourceUnion.variants[indexes[0]!]!.carrier : undefined;
    if (selected !== undefined) {
      const projection = selectRustFlowReadProjection(refinedCarrier, selected, options.projectTypes, context.typeDefinitions);
      if (projection.kind === "projection") {
        recordRustFlowReadProjection(context.facts, receiver, projection.fact);
        return selected;
      }
    }
  }
  if (sourceUnionCarrier !== undefined &&
    options.sourceTypes.sourceUnionVariantIndexesForTypes(
      sourceUnionCarrier,
      [request.sourceReceiverType],
    ) !== undefined) {
    return sourceUnionCarrier;
  }
  const selectedCarrier = resolveRustTargetTypeRef(
    request.sourceReceiverType,
    { ...context, sourceStorageSubject: receiver, sourceStorageProjection: undefined },
    options,
  );
  const selectedOwner = options.projectTypes.definitionContainingDeclaration(
    request.sourceSelectedDeclaration,
  );
  if (
    containingThisDefinition !== undefined &&
    sourceCarrier !== undefined &&
    selectedOwner === containingThisDefinition &&
    !context.ast.hasModifierKind(request.sourceSelectedDeclaration, "static")
  ) {
    return sourceCarrier;
  }
  if (selectedCarrier === undefined) {
    if (sourceCarrier !== undefined && request.sourceSelectedSymbol !== undefined) {
      const selectedDeclarations = context.currentSemantics.declarations
        .symbolDeclarations(request.sourceSelectedSymbol);
      if (selectedDeclarations.some((declaration) =>
        options.sourceTypes.structuralFieldProjectionForDeclaration(
          declaration,
          sourceCarrier,
        ) !== undefined)) {
        return sourceCarrier;
      }
    }
    if (sourceCarrier !== undefined && selectedOwner !== undefined &&
      options.projectTypes.relationship(sourceCarrier, selectedOwner).kind === "related") {
      return sourceCarrier;
    }
    const selectedSourceProfileMember = resolveSelectedSourceProfilePropertyMembers(
      context,
      request.expression,
      request.sourceSelectedSymbol,
      request.sourceSelectedDeclaration,
      options.sourceProfiles,
    );
    if (selectedSourceProfileMember === undefined || sourceCarrier === undefined) {
      return undefined;
    }
    return request.optionalChain === true
      ? rustOptionElementCarrier(sourceCarrier)
      : sourceCarrier;
  }
  if (sourceCarrier === undefined) {
    return (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") &&
        rustStructuralObjectCarrierValue(selectedCarrier) !== undefined
      ? selectedCarrier
      : undefined;
  }
  const optionElement = rustOptionElementCarrier(sourceCarrier);
  if (
    optionElement !== undefined &&
    rustTargetTypeRefEquals(optionElement, selectedCarrier)
  ) {
    return optionElement;
  }
  if (rustTargetTypeRefEquals(sourceCarrier, selectedCarrier)) {
    return sourceCarrier;
  }
  const flowProjection = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, options.projectTypes, context.typeDefinitions);
  if (flowProjection.kind === "projection") {
    recordRustFlowReadProjection(context.facts, receiver, flowProjection.fact);
    return selectedCarrier;
  }
  if (rustRuntimeUnionProjection(sourceCarrier, selectedCarrier) !== undefined) {
    return selectedCarrier;
  }
  if (isRustProgramErrorCarrier(sourceCarrier)) {
    const selectedDefinition = options.projectTypes.definitionForCarrier(selectedCarrier);
    return selectedDefinition !== undefined &&
        options.projectTypes.programErrorVariant(selectedDefinition) !== undefined
      ? selectedCarrier
      : undefined;
  }
  const selectedOperation = context.facts.resolve(receiver, rustTargetOperationFactKey);
  const preparedOperation = context.facts.resolve(receiver, rustPreparedOperationResultFactKey);
  const selectedOperationResult = selectedOperation === undefined
    ? preparedOperation?.resultCarrier
    : rustTargetOperationResultCarrier(selectedOperation);
  if (request.optionalChain !== true && selectedOperationResult !== undefined &&
    rustTargetTypeRefEquals(sourceCarrier, selectedOperationResult)) {
    return sourceCarrier;
  }
  const declaredCarrier = optionElement ?? sourceCarrier;
  const declaredDefinition = options.projectTypes.definitionForCarrier(declaredCarrier);
  const selectedDefinition = options.projectTypes.definitionForCarrier(selectedCarrier);
  const selectedRelationship = declaredDefinition === undefined || selectedDefinition === undefined
    ? { kind: "unrelated" as const }
    : options.projectTypes.relationship(selectedCarrier, declaredDefinition);
  if (selectedRelationship.kind === "related" &&
    rustTargetTypeRefEquals(selectedRelationship.targetType, declaredCarrier)) {
    return selectedCarrier;
  }
  if (optionElement !== undefined) {
    return undefined;
  }
  if (sourceRefinement.kind === "resolved" && sourceRefinement.refinement.kind === "exact") {
    return sourceCarrier;
  }
  if (sourceRefinement.kind === "resolved" && sourceRefinement.refinement.kind === "members" &&
    options.sourceTypes.sourceUnionForCarrier(sourceCarrier) !== undefined) {
    return sourceCarrier;
  }
  return undefined;
}

export function acceptRustMemberOperation(
  request: RustCheckedPropertySelectionInput,
  operationKind: "property" | "indexer",
  fact: RustTargetOperationFact,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  provenance: NonNullable<RustTargetOperationSelection["provenance"]>,
  innerResultCarrier: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const sourceReceiverCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  const selectedReceiverCarrier = fact.kind === "provider-operation" &&
      fact.abi.sourceReceiver.kind === "receiver"
    ? fact.abi.sourceReceiver.carrier
    : selectedMemberReceiverCarrier(request, context, options);
  const operationReceiverCarrier = request.optionalChain === true
    ? rustOptionNestingDepth(sourceReceiverCarrier, selectedReceiverCarrier) !== undefined
      ? selectedReceiverCarrier
      : rustOptionElementCarrier(sourceReceiverCarrier) ?? sourceReceiverCarrier
    : sourceReceiverCarrier;
  if (operationReceiverCarrier !== undefined && selectedReceiverCarrier !== undefined) {
    const projection = selectRustFlowReadProjection(
      operationReceiverCarrier,
      selectedReceiverCarrier,
      options.projectTypes, context.typeDefinitions,
    );
    if (projection.kind === "incompatible") {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SELECTED_RECEIVER_PROJECTION_UNSUPPORTED",
        "The checked member receiver cannot project from its exact runtime carrier to its TSTS-selected carrier.",
      );
    }
    if (projection.kind === "projection") {
      recordRustFlowReadProjection(context.facts, request.receiver, projection.fact);
    }
  }
  if (request.optionalChain !== true) {
    return acceptRustOperation(request.expression, fact, context, provenance, innerResultCarrier);
  }
  const sourceGuardCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  const selectedGuardCarrier = operationReceiverCarrier;
  const selection = selectRustOptionalChain({
    expression: request.expression,
    guard: request.receiver,
    operationKind,
    sourceGuardCarrier,
    selectedGuardCarrier,
    innerResultCarrier,
  });
  if (selection.kind === "rejected") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_OPTIONAL_CHAIN_CONTRACT_INVALID",
      selection.message,
    );
  }
  if (selection.kind === "direct") {
    return acceptRustOperation(
      request.expression,
      fact,
      context,
      provenance,
      selection.resultCarrier,
    );
  }
  const accepted = acceptRustOperation(
    request.expression,
    fact,
    context,
    provenance,
    selection.fact.resultCarrier,
  );
  context.facts.set(
    request.expression,
    rustOptionalChainFactKey,
    selection.fact,
    [{ message: `rust optional chain ${selection.fact.lowering}` }],
  );
  return accepted;
}

export function acceptDeclarationOperation(
  operationKind: RustTargetOperationSelection["operationKind"],
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  return acceptRustPolicy({
    operation: genericOperation(`tsonic.rust.declaration.${operationKind}`, operationKind, "declaration-only"),
  }, [{ message: "rust declaration-only checked operation" }]);
}

export function rejectSelectedOperation<T>(
  nodeOrSpan: ExtensionFactSubject,
  context: RustOperationPolicyContext,
  extensionCode: string,
  message: string,
  evidence: readonly { readonly message: string }[] = [],
): RustPolicySelection<T> {
  return rejectRustPolicy({
    extensionId: context.extensionId,
    extensionCode,
    numericCode: 0,
    category: "error",
    message,
    nodeOrSpan,
    evidence: [{ message: "target.capability=rust.selected-operation" }, ...evidence],
  });
}

export function providerOperationFact(
  row: RustProviderOperationRow<RustProviderFactOperationKind>,
): RustProviderOperationTemplate {
  return providerOperationTemplate(row, row.operationKind);
}

export function providerOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  row: RustProviderOperationRow<OperationKind>,
  operationKind: OperationKind,
): RustProviderOperationTemplate<OperationKind> {
  return {
    kind: "provider-operation",
    operationId: providerOperationId(row),
    operationKind,
    target: row.target,
    resultCarrier: row.resultCarrier,
    ...(row.parameterCarriers === undefined ? {} : { parameterCarriers: row.parameterCarriers }),
    ...(row.receiverCarrier === undefined ? {} : { receiverCarrier: row.receiverCarrier }),
    ...(row.genericParameters === undefined ? {} : { genericParameters: row.genericParameters }),
    ...(row.typeRequirements === undefined ? {} : { typeRequirements: row.typeRequirements }),
    ...(row.targetGenericArguments === undefined ? {} : { targetGenericArguments: row.targetGenericArguments }),
    ...(row.resultConversion === undefined ? {} : { resultConversion: row.resultConversion }),
    isAsync: row.isAsync === true,
    isFallible: row.isFallible === true,
    ...(row.evaluation === undefined ? {} : { evaluation: row.evaluation }),
    errorBoundary: row.isFallible === true ? row.errorBoundary : "none",
    ...(row.errorCarrier === undefined ? {} : { errorCarrier: row.errorCarrier }),
    isUnsafe: row.isUnsafe === true,
  };
}

function providerOperationId(row: RustProviderOperationRow): string {
  const identity = row.signatureId ?? row.memberId ?? row.exportId;
  const segment = (value: string): string => `${value.length}:${value}`;
  return `tsonic.rust.provider.${[
    row.providerPackageId,
    row.providerId,
    row.providerVersion,
    row.providerModuleId,
    row.moduleSpecifier,
    identity,
  ].map(segment).join("")}`;
}

export function elementProvenance(request: RustCheckedElementSelectionInput): NonNullable<RustTargetOperationSelection["provenance"]> {
  return {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  };
}

export function sourceOperationId(
  context: RustOperationPolicyContext,
  declaration: Node,
  kind: string,
): string {
  const ast = context.ast;
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return `tsonic.rust.source.${kind}:${fileName}:${ast.pos(declaration)}:${ast.end(declaration)}`;
}

export function isDeclarationFileSubject(subject: ExtensionFactSubject, context: RustOperationPolicyContext): boolean {
  const node = asNode(subject, context);
  return node !== undefined && context.ast.isDeclarationFile(context.ast.getSourceFile(node));
}

export function selectedDeclarationIsCallable(
  subject: ExtensionFactSubject | undefined,
  context: RustOperationPolicyContext,
): boolean {
  const declaration = asNode(subject, context);
  if (declaration === undefined) {
    return false;
  }
  const kind = context.ast.kindName(declaration);
  return kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" ||
    kind === "KindCallSignature" ||
    kind === "KindConstructSignature" ||
    kind === "KindFunctionDeclaration" ||
    kind === "KindFunctionType";
}

function genericOperation(
  operationId: string,
  operationKind: RustTargetOperationSelection["operationKind"],
  targetOperation: string,
): RustTargetOperationSelection {
  return { operationId, operationKind, targetOperation };
}

function genericOperationKind(fact: RustTargetOperationFact): RustTargetOperationSelection["operationKind"] {
  switch (fact.kind) {
    case "provider-operation":
      return fact.abi.operationKind;
    case "tuple-index":
    case "fixed-index":
    case "source-index-signature":
    case "source-indexed-field":
      return "indexer";
    case "source-field":
    case "builtin-error-property":
    case "source-method-property":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
    case "union-property":
    case "source-enum-member":
      return "property";
    case "iteration":
      return "iteration";
    default:
      return "operator";
  }
}

export function providerIdentityText(identity: ProviderDeclarationIdentity): string {
  return [identity.providerId, identity.providerModuleId, identity.moduleSpecifier, identity.exportName, identity.memberName, identity.signatureId]
    .filter((part) => part !== undefined)
    .join("::");
}


export function normalizeSelectedOperationInputCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  const valueExpected = rustOptionElementCarrier(expected) ?? expected;
  if (node !== undefined && context.ast.kindName(node) === "KindArrayLiteralExpression" &&
    (isRustJsArrayCarrier(valueExpected) || isRustVecCarrier(valueExpected))) {
    return expected;
  }
  const direct = normalizeSelectedLiteralCarrier(
    subject,
    actual,
    expected,
    context,
    options,
  );
  const optionElement = rustOptionElementCarrier(expected);
  if (optionElement === undefined || direct === undefined ||
    rustTargetTypeRefEquals(direct, expected)) {
    if (direct !== undefined && expected !== undefined &&
      selectRustValueCarrierReconciliation(direct, expected, options.projectTypes, context.typeDefinitions).kind === "conversion") {
      return expected;
    }
    return direct;
  }
  if (isRustAbsenceCarrier(direct)) {
    return expected;
  }
  const inner = normalizeSelectedOperationInputCarrier(
    subject,
    direct,
    optionElement,
    context,
    options,
  );
  return rustTargetTypeRefEquals(inner, optionElement) ? expected : direct;
}

export function normalizeSelectedArgumentCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node !== undefined && expected !== undefined &&
    contextualConditionalArgumentMatches(node, expected, context, options)) return expected;
  if (node !== undefined) {
    const providerObjectLiteral = selectRustProviderObjectLiteralConstruction(
      node,
      expected,
      context,
      options,
    );
    if (providerObjectLiteral.kind === "selected") {
      return providerObjectLiteral.carrier;
    }
  }
  const literal = normalizeSelectedOperationInputCarrier(subject, actual, expected, context, options);
  if (literal !== actual || (expected?.kind !== "function-pointer" && expected?.kind !== "closure" &&
    rustCallableProtocol(expected) === undefined)) {
    return literal;
  }
  const kind = node === undefined ? "" : context.ast.kindName(node);
  return kind === "KindArrowFunction" || kind === "KindFunctionExpression"
    ? expected
    : actual;
}

export function selectedArgumentMatchScore(
  subjects: readonly ExtensionFactSubject[],
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): NonNullable<Parameters<typeof selectJsSurfaceOperation>[0]["argumentMatchScore"]> {
  return (expected, actual, index) => {
    const subject = subjects[index];
    const node = asNode(subject, context);
    if (node === undefined) {
      return undefined;
    }
    if (context.ast.kindName(node) === "KindStringLiteral" &&
      options.sourceTypes.enumVariantForLiteral(expected, context.ast.text(node)) !== undefined) {
      return 1;
    }
    const kind = context.ast.kindName(node);
    const callable = rustCallableProtocol(expected);
    if ((expected.kind === "function-pointer" || expected.kind === "closure" || callable !== undefined) &&
      (kind === "KindArrowFunction" || kind === "KindFunctionExpression")) {
      const parameterCount = expected.kind === "function-pointer" || expected.kind === "closure"
        ? expected.args.length
        : callable!.parameters.length;
      return context.ast.parameters(node).length === parameterCount ? 1 : undefined;
    }
    if (actual === undefined) {
      return 10;
    }
    const optionElement = rustOptionElementCarrier(expected);
    if (optionElement !== undefined &&
      (isRustAbsenceCarrier(actual) ||
        rustTargetTypeRefEquals(actual, optionElement) ||
        selectRustValueCarrierReconciliation(actual, optionElement, options.projectTypes, context.typeDefinitions).kind === "conversion" ||
        (optionElement.kind === "source-primitive" && isRustNumericCarrier(optionElement) &&
          sourceLiteralIsRepresentableAsPrimitive(node, optionElement.name, context)))) {
      return 1;
    }
    const reconciliation = selectRustValueCarrierReconciliation(
      actual,
      expected,
      options.projectTypes, context.typeDefinitions,
    );
    if (reconciliation.kind === "call-scoped-lifetime" ||
      reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
      return 1;
    }
    return expected.kind === "source-primitive" && isRustNumericCarrier(expected) &&
      sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)
      ? 1
      : undefined;
  };
}
