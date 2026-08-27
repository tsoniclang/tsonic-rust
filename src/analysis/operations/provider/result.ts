import {
  isRustDefinitelyNullishCarrier,
  isRustProgramErrorCarrier,
  isRustNumericCarrier,
  rustOptionElementCarrier,
} from "../../../target-model/types/index.js";
import {
  rustTargetOperationResultCarrier,
  rustTargetOperationFactKey,
  rustPreparedOperationResultFactKey,
  rustOptionalChainFactKey,
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../../facts/keys.js";
import { acceptRustPolicy, rejectRustPolicy } from "../../../policy/operations/contracts.js";
import {
  asNode,
  resolveSelectedSourceProfilePropertyMembers,
} from "../../../policy/evidence/selected-source.js";
import { selectRustFlowReadProjection } from "../../../policy/types/value-carrier-reconciliation.js";
import { recordRustFlowReadProjection } from "../../facts/value-carrier-queries.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { selectRustProviderObjectLiteralConstruction } from "../../../policy/types/resolution/providers.js";
import { rustCallableProtocol, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import { rustRuntimeCarrierKey, rustSelectedOperationKey } from "../../../target-model/facts/selections.js";
import { rustTargetOperationText } from "../../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectedSourceLiteralIsRepresentable, selectedSourceNumericLiteralOperationId } from "../../../policy/types/selected-numeric-literal.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/js-surface.js";
import { selectRustOptionalChain } from "../../../policy/operations/optional-chains.js";
import { selectRustValueCarrierReconciliation } from "../../../policy/types/value-carrier-reconciliation.js";
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
  const selectedCarrier = resolveRustTargetTypeRef(
    request.sourceReceiverType,
    context,
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
  if (request.optionalChain === true && optionElement !== undefined) {
    return optionElement;
  }
  if (
    optionElement !== undefined &&
    rustTargetTypeRefEquals(optionElement, selectedCarrier)
  ) {
    return optionElement;
  }
  if (rustTargetTypeRefEquals(sourceCarrier, selectedCarrier)) {
    return sourceCarrier;
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
  const refinement = context.source.semantics.selectValueTypeRefinement(receiver);
  if (refinement.kind === "resolved" && refinement.refinement.kind === "exact") {
    return sourceCarrier;
  }
  if (refinement.kind === "resolved" && refinement.refinement.kind === "members" &&
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
  const operationReceiverCarrier = request.optionalChain === true
    ? rustOptionElementCarrier(sourceReceiverCarrier) ?? sourceReceiverCarrier
    : sourceReceiverCarrier;
  const selectedReceiverCarrier = fact.kind === "provider-operation" &&
      fact.abi.sourceReceiver.kind === "receiver"
    ? fact.abi.sourceReceiver.carrier
    : selectedMemberReceiverCarrier(request, context, options);
  if (operationReceiverCarrier !== undefined && selectedReceiverCarrier !== undefined) {
    const projection = selectRustFlowReadProjection(
      operationReceiverCarrier,
      selectedReceiverCarrier,
      options.projectTypes,
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
  const selectedGuardCarrier = selectedMemberReceiverCarrier(
    request,
    context,
    options,
  );
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
      return "indexer";
    case "source-field":
    case "source-method-property":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
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

export function sourceLiteralIsRepresentableAsPrimitive(
  node: Node,
  primitive: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>["name"],
  context: RustOperationPolicyContext,
): boolean {
  return selectedSourceLiteralIsRepresentable(node, primitive, context.ast);
}

export function normalizeSelectedLiteralCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node === undefined || expected === undefined) {
    return actual;
  }
  if (context.ast.kindName(node) === "KindStringLiteral") {
    const variant = options.sourceTypes.enumVariantForLiteral(expected, context.ast.text(node));
    if (variant !== undefined) {
      const fact: RustTargetOperationFact = {
        kind: "source-enum-member",
        operationId: `tsonic.rust.union.variant:${variant.name}`,
        name: variant.name,
        resultCarrier: expected,
      };
      context.facts.set(node, rustTargetOperationFactKey, fact, [
        { message: "rust selected source enum literal" },
      ]);
      context.facts.set(node, rustRuntimeCarrierKey, { carrier: expected }, [
        { message: "rust selected source enum literal carrier" },
      ]);
      return expected;
    }
  }
  if (expected.kind !== "source-primitive" || !isRustNumericCarrier(expected)) {
    return actual;
  }
  if (!sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)) {
    return actual;
  }
  context.facts.set(node, rustRuntimeCarrierKey, { carrier: expected }, [
    { message: "rust selected numeric literal carrier from checked peer/target evidence" },
  ]);
  const numericOperationId = selectedSourceNumericLiteralOperationId(node, context.ast);
  if (numericOperationId === rustPostCheckUnaryMinusOperationId) {
    const fact: RustTargetOperationFact = {
      kind: "operator-token",
      operationId: rustPostCheckUnaryMinusOperationId,
      operator: "-",
      resultCarrier: expected,
    };
    context.facts.set(node, rustTargetOperationFactKey, fact, [
      { message: "rust finalized selected unary-minus literal carrier" },
    ]);
    context.facts.set(node, rustSelectedOperationKey, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  } else if (numericOperationId === rustPostCheckUnaryPlusOperationId) {
    const fact: RustTargetOperationFact = {
      kind: "source-conversion",
      operationId: rustPostCheckUnaryPlusOperationId,
      resultCarrier: expected,
    };
    context.facts.set(node, rustTargetOperationFactKey, fact, [
      { message: "rust finalized selected unary-plus literal carrier" },
    ]);
    context.facts.set(node, rustSelectedOperationKey, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  }
  return expected;
}

export function normalizeSelectedOperationInputCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
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
    return direct;
  }
  if (isRustDefinitelyNullishCarrier(direct)) {
    return expected;
  }
  const inner = normalizeSelectedLiteralCarrier(
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
  const literal = normalizeSelectedLiteralCarrier(subject, actual, expected, context, options);
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
    const reconciliation = selectRustValueCarrierReconciliation(
      actual,
      expected,
      options.projectTypes,
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
