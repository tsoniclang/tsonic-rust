import {
  asNode,
  isProjectSourceDeclaration,
  resolveSelectedJsSourceMember,
  resolveSelectedProviderDeclaration,
  resolveSelectedSourceProfileMember,
} from "../../../policy/evidence/selected-source.js";
import {
  isRustCopyCarrier,
  getRustGeneratorProtocol,
  isRustJsArrayCarrier,
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
  VariableDeclarationList_Declarations,
} from "@tsonic/target-api/source";
import {
  rustFixedArrayCarrierValue,
  getRustJsMapTargetTypes,
  getRustJsSetElementTargetType,
  rustSourcePrimitiveTargetType,
  rustCarrierSupportsClone,
} from "../../../target-model/types/index.js";
import { acceptDeclarationOperation, acceptRustMemberOperation, acceptRustOperation, elementProvenance, isDeclarationFileSubject, normalizeSelectedLiteralCarrier, rejectSelectedOperation, selectedArgumentMatchScore, selectedMemberReceiverCarrier, sourceOperationId } from "./result.js";
import { finalizeProviderOperationFromSubjects, mapProviderCheckedOperation } from "./conversions.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustInt32ToUsizeValueConversion } from "../../../target-model/conversions/model.js";
import { rustProjectObjectIndexSignature } from "../../project-types/object-layout.js";
import { rustRuntimeCarrierKey } from "../../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectedValueCarrier } from "./operators.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/js-surface.js";
import { selectRustFixedArrayElementAccess } from "./structural-properties.js";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import type {
  RustCheckedElementSelectionInput,
  RustCheckedIterationSelectionInput,
  RustCheckedOperationSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { ExtensionFactSubject, Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustProviderOperationTemplate, RustTargetOperationFact } from "../../facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustCheckedElementAccess(
  request: RustCheckedElementSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selectedReceiverCarrier = selectedMemberReceiverCarrier(request, context, options);
  if (request.optionalChain === true && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_EVIDENCE_MISSING", "Optional-chain element access has no exact TSTS-selected non-null receiver type.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
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
  if (providerEvidence.kind === "selected") {
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
    const index = rustProjectObjectIndexSignature(declaration, context.ast);
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
        receiverCarrier: selectedReceiverCarrier!,
        keyCarrier,
        storageName,
        writable: !context.ast.hasModifierKind(index.declaration, "readonly"),
        resultCarrier,
      }, context, options, elementProvenance(request));
    }
  }

  const receiverCarrier = selectedReceiverCarrier;
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

  const sourceProfileIdentity = resolveSelectedSourceProfileMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  const nativeArrayReceiver = receiverCarrier?.kind === "array"
    ? receiverCarrier
    : receiverCarrier?.kind === "reference" && receiverCarrier.referent.kind === "slice"
      ? receiverCarrier.referent
      : undefined;
  if (sourceProfileIdentity?.profile === "native" &&
    (sourceProfileIdentity.ownerName === "Array" || sourceProfileIdentity.ownerName === "ReadonlyArray") &&
    sourceProfileIdentity.memberName === "index" &&
    nativeArrayReceiver !== undefined && isRustCopyCarrier(nativeArrayReceiver.element)) {
    const template: RustProviderOperationTemplate = {
      kind: "provider-operation",
      operationId: `tsonic.rust.native.${sourceProfileIdentity.ownerName}.index`,
      operationKind: "indexer",
      target: { form: "index", indexConversion: rustInt32ToUsizeValueConversion },
      resultCarrier: nativeArrayReceiver.element,
      parameterCarriers: [rustSourcePrimitiveTargetType("int32")],
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    };
    const fact = finalizeProviderOperationFromSubjects(template, request.receiver, [request.argument], context, options, selectedReceiverCarrier);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", "Native array indexing cannot finalize one total Rust operation ABI.");
    }
    return acceptRustMemberOperation(request, "indexer", fact, context, options, elementProvenance(request));
  }

  const jsIdentity = resolveSelectedJsSourceMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected index signature belongs to the explicit JavaScript source profile, which is not active.");
    }
    const selectedArgumentCarrier = selectedValueCarrier(
      request.argument,
      request.sourceArgumentType,
      context,
      options,
    );
    const selection = selectJsSurfaceOperation({
      ownerName: jsIdentity.ownerName,
      memberName: jsIdentity.memberName,
      operationKind: "indexer",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      argumentCarriers: [selectedArgumentCarrier],
      argumentMatchScore: selectedArgumentMatchScore([request.argument], context, options),
    });
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
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const source = request.source;
  if (source.iterationKind === "for-in") {
    const iterable = resolveRustTargetTypeRef(request.expression, context, options);
    const elementCarrier = resolveRustTargetTypeRef(source.sourceElementType, context, options);
    if (elementCarrier === undefined || !isRustStringCarrier(elementCarrier)) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_KEY_CARRIER_UNSUPPORTED",
        "Rust property-key iteration requires the exact checked source key to map to String.",
      );
    }
    const lowering = rustPropertyKeyIterationLowering(iterable, context.ast, options);
    if (lowering === undefined) {
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
      elementCarrier,
      lowering,
    };
    recordIterationInitializerCarrier(request.initializer, elementCarrier, context);
    return acceptRustOperation(request.statement, fact, context, {
      sourceExpression: request.expression,
      sourceResultType: source.sourceElementType,
    }, elementCarrier);
  }
  const iterable = resolveRustTargetTypeRef(request.expression, context, options);
  const targetIteration = rustIterableTargetPolicy(iterable);
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
  recordIterationInitializerCarrier(request.initializer, targetIteration.elementCarrier, context);
  return acceptRustOperation(request.statement, fact, context, {
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
  ast: import("@tsonic/tsts").AstReader,
  options: RustOperationsProviderOptions,
): RustPropertyKeyIterationLowering | undefined {
  if (iterable?.kind === "array" ||
    (iterable?.kind === "reference" && iterable.referent.kind === "slice") ||
    rustFixedArrayCarrierValue(iterable) !== undefined) {
    return { kind: "dense-index-keys" };
  }
  if (isRustJsArrayCarrier(iterable)) {
    return { kind: "js-array-index-keys" };
  }
  const keys = iterable === undefined
    ? undefined
    : options.sourceTypes.propertyKeysForCarrier(iterable, ast);
  return keys === undefined ? undefined : { kind: "static-keys", keys };
}

type RustIterableTargetPolicy =
  | {
      readonly kind: "borrowed";
      readonly elementCarrier: TargetTypeRef;
      readonly input: "direct" | "reference";
    }
  | {
      readonly kind: "js-array" | "sync-generator" | "async-generator";
      readonly elementCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "receiver-method";
      readonly elementCarrier: TargetTypeRef;
      readonly method: string;
    };

function rustIterableTargetPolicy(iterable: TargetTypeRef | undefined): RustIterableTargetPolicy | undefined {
  if (iterable?.kind === "array") {
    return { kind: "borrowed", elementCarrier: iterable.element, input: "reference" };
  }
  if (iterable?.kind === "reference" && iterable.referent.kind === "slice") {
    return { kind: "borrowed", elementCarrier: iterable.referent.element, input: "direct" };
  }
  const fixed = rustFixedArrayCarrierValue(iterable);
  if (fixed !== undefined) {
    return { kind: "borrowed", elementCarrier: fixed.element, input: "reference" };
  }
  const jsElement = isRustJsArrayCarrier(iterable) ? iterable?.typeArguments?.[0] : undefined;
  if (jsElement !== undefined) {
    return { kind: "js-array", elementCarrier: jsElement };
  }
  const mapTypes = getRustJsMapTargetTypes(iterable);
  if (mapTypes !== undefined && rustCarrierSupportsClone(mapTypes.key) &&
    rustCarrierSupportsClone(mapTypes.value)) {
    return {
      kind: "receiver-method",
      elementCarrier: { kind: "tuple", elements: [mapTypes.key, mapTypes.value] },
      method: "entries",
    };
  }
  const setElement = getRustJsSetElementTargetType(iterable);
  if (setElement !== undefined && rustCarrierSupportsClone(setElement)) {
    return { kind: "receiver-method", elementCarrier: setElement, method: "values" };
  }
  const generator = getRustGeneratorProtocol(iterable);
  return generator === undefined
    ? undefined
    : {
        kind: generator.kind === "sync" ? "sync-generator" : "async-generator",
        elementCarrier: generator.yieldType,
      };
}

function selectRustIterationLowering(
  source: Exclude<import("@tsonic/tsts").ResolvedSourceIterationInfo, { readonly iterationKind: "for-in" }>,
  target: RustIterableTargetPolicy,
  consumeResult: boolean,
): Extract<
  RustTargetOperationFact,
  { readonly kind: "iteration"; readonly iterationKind: "for-of" | "for-await-of" }
>["lowering"] | undefined {
  if (source.mechanism.kind === "union" || source.mechanism.kind === "untyped-dynamic-iteration") {
    return undefined;
  }
  if (source.iterationKind === "for-of") {
    if (target.kind === "async-generator") {
      return undefined;
    }
    if (target.kind === "borrowed") {
      if (consumeResult) {
        return { kind: "owned" };
      }
      return {
        kind: "borrowed",
        style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned",
        input: target.input,
      };
    }
    if (target.kind === "receiver-method") {
      return { kind: "receiver-method", name: target.method };
    }
    return target.kind === "js-array" ? { kind: "js-array" } : { kind: "owned" };
  }
  if (source.mechanism.kind === "asynchronous-iterator-protocol") {
    return target.kind === "async-generator" ? { kind: "async-generator" } : undefined;
  }
  if (target.kind === "async-generator") {
    return undefined;
  }
  if (target.kind === "borrowed") {
    if (consumeResult) {
      return { kind: "owned" };
    }
    return {
      kind: "borrowed",
      style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned",
      input: target.input,
    };
  }
  if (target.kind === "receiver-method") {
    return { kind: "receiver-method", name: target.method };
  }
  return target.kind === "js-array" ? { kind: "js-array" } : { kind: "owned" };
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

function recordIterationInitializerCarrier(
  initializer: ExtensionFactSubject | undefined,
  carrier: TargetTypeRef,
  context: RustOperationPolicyContext,
): void {
  const root = asNode(initializer, context);
  if (root === undefined) {
    return;
  }
  const evidence = [{ message: "rust selected iteration binding carrier" }];
  context.facts.set(root, rustRuntimeCarrierKey, { carrier }, evidence);
  const declarations = VariableDeclarationList_Declarations(context.ast, root);
  if (declarations === undefined || !isDenseDataArray(declarations)) {
    return;
  }
  for (const declaration of declarations) {
    if (declaration !== undefined && context.ast.kindName(declaration) === "KindVariableDeclaration") {
      context.facts.set(declaration, rustRuntimeCarrierKey, { carrier }, evidence);
    }
  }
}
