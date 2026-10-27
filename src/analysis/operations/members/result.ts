import { acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { requireRustRecord } from "../../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { isRustAbsenceCarrier, isRustProgramErrorCarrier, isRustNumericCarrier, rustOptionElementCarrier, rustOptionNestingDepth, rustOptionValueCarrier, isRustJsArrayCarrier, isRustVecCarrier } from "../../../target-model/types/index.js";
import { rustTargetOperationResultCarrier } from "../../../target-model/records/operations/operation-result-carriers.js";

import { rejectRustPolicy } from "../../../policy/model/contracts.js";
import { asNode, resolveSelectedSourceProfilePropertyMembers } from "../../../policy/identities/selected-source.js";
import { selectRustGuardedValueCarrier } from "../native-flow-refinement.js";
import { rustRuntimeUnionProjection } from "../../../target-model/types/carriers/runtime-unions.js";

import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { retainRustSourceUnionInstantiation } from "../../source-evidence/types/resolution/source-unions.js";
import { selectRustProviderObjectLiteralConstruction } from "../../source-evidence/types/resolution/providers.js";
import { rustCallableProtocol, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { normalizeSelectedLiteralCarrier, sourceLiteralIsRepresentableAsPrimitive } from "../../source-evidence/types/resolution/selected-literals.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/source-profiles/js/selection.js";
import { selectRustOptionalChain } from "../../../policy/operations/flow/optional-chains.js";
import { selectRustValueCarrierReconciliation } from "../../../policy/conversions/value-carrier-reconciliation.js";
import { contextualConditionalArgumentMatches } from "../../expected-types/conditional-arguments.js";
import type { RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection, RustTargetOperationSelection } from "../../../policy/model/contracts.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { ExtensionFactSubject, Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceStorageSubjectContext } from "../../source-evidence/types/resolution/source-storage-projection.js";

function memberReceiverSourceCarrier(
  request: RustCheckedPropertySelectionInput,
  receiver: Node,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): { readonly carrier: TargetTypeRef | undefined; readonly physical: boolean } {
  const selected = context.records.selectedOperation.get(receiver);
  if (selected !== undefined) {
    return { carrier: selected.resultType, physical: true };
  }
  const prepared = context.records.preparedOperationResult.get(receiver);
  if (prepared !== undefined) {
    return { carrier: prepared.resultCarrier, physical: true };
  }
  return { carrier: resolveRustTargetTypeRef(request.receiver, context, options), physical: false };
}

export function selectedMemberReceiverCarrier(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const receiver = asNode(request.receiver, context);
  if (receiver === undefined) {
    return undefined;
  }
  const source = memberReceiverSourceCarrier(request, receiver, context, options);
  const receiverKind = context.ast.kindName(receiver);
  const sourceCarrier = source.carrier;
  if (request.sourceReceiverType === undefined) {
    return undefined;
  }
  if (sourceCarrier !== undefined) selectRustGuardedValueCarrier(receiver, sourceCarrier, context, options);
  const flowRead = context.records.flowReadProjection.get(receiver);
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
    const declaredCarrier = declaration === undefined ? undefined : options.sourceTypes.carrierForDeclaration(declaration);
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
      const projection = context.records.flowReadProjections.resolve(context.requiredRecords, receiver, refinedCarrier, selected, options.projectTypes, context.typeDefinitions);
      if (projection.kind === "projection") {
        return projection.fact.selectedCarrier;
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
  const receiverStorage = context.sourceStorage.subjectFor(receiver);
  const selectedCarrier = resolveRustTargetTypeRef(
    request.sourceReceiverType,
    rustSourceStorageSubjectContext(context, receiverStorage),
    options,
  );
  const selectedOwner = options.projectTypes.definitionContainingDeclaration(
    request.sourceSelectedDeclaration,
  );
  if (sourceCarrier !== undefined && options.sourceTypes.structuralObjectForType(
    request.sourceReceiverType, sourceCarrier) !== undefined) {
    return request.optionalChain === true ? rustOptionValueCarrier(sourceCarrier) : sourceCarrier;
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
  const flowProjection = context.records.flowReadProjections.resolve(context.requiredRecords, receiver, sourceCarrier, selectedCarrier, options.projectTypes, context.typeDefinitions);
  if (flowProjection.kind === "projection") {
    return flowProjection.fact.selectedCarrier;
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
  if (request.optionalChain !== true && source.physical && source.carrier !== undefined &&
    rustTargetTypeRefEquals(sourceCarrier, source.carrier)) {
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
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  provenance: NonNullable<RustTargetOperationSelection["provenance"]>,
  innerResultCarrier: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const receiver = asNode(request.receiver, context);
  const sourceReceiverCarrier = receiver === undefined ? undefined
    : memberReceiverSourceCarrier(request, receiver, context, options).carrier;
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
    const projection = context.records.flowReadProjections.resolve(context.requiredRecords, request.receiver,
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
  }
  if (request.optionalChain !== true) {
    return acceptRustOperation(fact, provenance, innerResultCarrier);
  }
  const sourceGuardCarrier = sourceReceiverCarrier;
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
      fact,
      provenance,
      selection.resultCarrier,
    );
  }
  const accepted = acceptRustOperation(
    fact,
    provenance,
    selection.fact.resultCarrier,
  );
  requireRustRecord(context.requiredRecords, "optionalChain", request.expression, selection.fact.operationKind, "analysis/operations/members/result.ts");
  context.records.optionalChains.guard(request.expression, selection.fact.guard, selection.fact.operationKind, selection.fact);
  return accepted;
}

export function rejectSelectedOperation<T>(
  nodeOrSpan: ExtensionFactSubject,
  context: RustOperationAnalysisContext,
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

export function sourceOperationId(
  context: RustOperationAnalysisContext,
  declaration: Node,
  kind: string,
): string {
  const ast = context.ast;
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return `tsonic.rust.source.${kind}:${fileName}:${ast.pos(declaration)}:${ast.end(declaration)}`;
}

export function isDeclarationFileSubject(subject: ExtensionFactSubject, context: RustOperationAnalysisContext): boolean {
  const node = asNode(subject, context);
  return node !== undefined && context.ast.isDeclarationFile(context.ast.getSourceFile(node));
}

export function selectedDeclarationIsCallable(
  subject: ExtensionFactSubject | undefined,
  context: RustOperationAnalysisContext,
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

export function providerIdentityText(identity: ProviderDeclarationIdentity): string {
  return [identity.providerId, identity.providerModuleId, identity.moduleSpecifier, identity.exportName, identity.memberName, identity.signatureId]
    .filter((part) => part !== undefined)
    .join("::");
}

export function normalizeSelectedOperationInputCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
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
    if (direct !== undefined && expected !== undefined) {
      const selected = selectRustValueCarrierReconciliation(direct, expected, options.projectTypes, context.typeDefinitions);
      if (selected.kind === "conversion") return selected.fact.targetCarrier;
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
  context: RustOperationAnalysisContext,
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
  context: RustOperationAnalysisContext,
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
      return sourceCallableValueParameters(context.ast, node, context.semanticsFor(node))?.length === parameterCount ? 1 : undefined;
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
