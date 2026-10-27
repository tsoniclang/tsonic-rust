import { KindIdentifier, KindParenthesizedExpression, KindVariableDeclaration, Node_Expression, Node_Initializer, Node_Type } from "@tsonic/target-api/source";
import { type Node } from "@tsonic/tsts";
import { appendRustDiagnostic, type RustFactWalk, rustResolutionContext } from "../../program/walk.js";
import { rustFutureValueForOperation, rustFutureValueForSourceStorage, rustFutureValueMatchesCarrier, transportRustFutureValue } from "./future-values.js";
import { setCarrierFact } from "../../operations/project-calls.js";
import { type RustFutureValueFact } from "../../../target-model/records/objects/object-methods.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import { rustFutureValueForStoredBranch } from "../storage/future-storage.js";
import { requireRustRecord } from "../../program/records/objects/required-records.js";
import { type RustSourceErrorEffectSelection } from "../../errors/source-error-effects.js";
import { type RustAsyncFunctionFact, type RustGeneratorFact } from "../../../target-model/records/callables/callables-and-resources.js";
import { type RustRetainedEnvironment } from "../../../target-model/records/callables/retained-environments.js";
import { type TargetTypeRef } from "../../../target-model/types/model.js";
import { getRustGeneratorProtocol } from "../../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { rustGeneratorFact } from "../../program/records/callables/generator.js";
import { selectedSourceCallableReturn } from "../calls/source-callable-abi.js";
import { resolveRustSuspendedCallableStorage } from "../storage/suspension-storage.js";
import { selectRustAsyncBodyFacts } from "./async-results.js";

export function completeRustFutureValue(walk: RustFactWalk, errors: RustSourceErrorEffectSelection,
  fact: RustFutureValueFact | undefined): RustFutureValueFact | undefined {
  if (fact?.errorBoundary !== "source-native") return fact;
  if (fact.errorSource === undefined || fact.errorCarrier === undefined) return undefined;
  const error = errors.complete({ identity: fact.errorSource, errorType: fact.errorCarrier },
    walk.context.callableValues.nativeStorage);
  return error === undefined ? undefined : { ...fact, errorCarrier: error.errorType, errorSource: error.identity };
}

export function recordFutureValueFacts(walk: RustFactWalk, sourceErrors: RustSourceErrorEffectSelection): void {
  walk.context.records.assertOpen();
  const resolve = (node: Node): RustFutureValueFact | undefined => walk.context.records.futureValues.resolve(node, () => {
    const transport = (operand: Node | undefined): RustFutureValueFact | undefined => {
      if (operand === undefined) return undefined;
      const fact = resolve(operand);
      const source = walk.context.records.runtimeCarrier.get(operand)?.carrier;
      let target = walk.context.records.runtimeCarrier.get(node)?.carrier;
      if (fact === undefined) return undefined;
      if (target === undefined && source !== undefined && walk.context.ast.kindName(node) === KindIdentifier) {
        target = setCarrierFact(walk, node, source);
      }
      const selected = transportRustFutureValue(fact, source, target, walk.context.typeDefinitions);
      if (selected === undefined) {
        appendRustDiagnostic(walk, "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
          "Future-value transport requires an exact native representation relationship.", node,
          ["target.capability=rust.async.future-value"]);
      }
      return selected;
    };
    const operation = walk.context.records.targetOperation.get(node);
    const effects = operation?.kind === "source-call"
      ? walk.context.records.sourceCallEffects.get(node)
      : undefined;
    let fact = operation?.kind === "source-call"
      ? rustFutureValueForStoredBranch(walk, node, operation.resultCarrier, sourceErrors)
      : rustFutureValueForOperation(operation, effects, walk.context.typeDefinitions);
    if (fact === undefined) {
      const kind = walk.context.ast.kindName(node);
      if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
        kind === "KindTypeAssertionExpression") {
        const operand = Node_Expression(walk.context.ast, node);
        fact = transport(operand);
      } else if (kind === KindVariableDeclaration) {
        const initializer = Node_Initializer(walk.context.ast, node);
        fact = walk.context.records.mutatedBinding.get(node) !== undefined || initializer === undefined
          ? rustFutureValueForSourceStorage(walk.context.records.runtimeCarrier.get(node)?.carrier)
          : transport(initializer);
      } else if (kind === KindIdentifier) {
        const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
        fact = transport(declaration);
      } else if (kind === "KindParameter" || kind === "KindPropertyDeclaration" || kind === "KindPropertySignature" ||
        kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") {
        fact = rustFutureValueForSourceStorage(walk.context.records.runtimeCarrier.get(node)?.carrier);
      }
    }
    if (fact === undefined) {
      return undefined;
    }
    fact = completeRustFutureValue(walk, sourceErrors, fact);
    if (fact === undefined) {
      appendRustDiagnostic(walk, "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
        "Future-value transport requires its completed exact native error channel.", node,
        ["target.capability=rust.async.future-value"]);
      return undefined;
    }
    const carrier = walk.context.records.runtimeCarrier.get(node)?.carrier;
    if (!rustFutureValueMatchesCarrier(fact, carrier, walk.context.typeDefinitions)) {
      appendRustDiagnostic(
        walk,
        "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
        "First-class future evidence conflicts with the exact runtime carrier of this value.",
        node,
        ["target.capability=rust.async.future-value"],
      );
      return undefined;
    }
    requireRustRecord(walk.context.requiredRecords, "futureValue", node,
      "future-value", "recordFutureValueFacts");
    return fact;
  });
  for (const node of walk.context.nativeNodes) resolve(node);
  for (const node of walk.context.nativeNodes) {
    if (walk.context.ast.kindName(node) !== "KindAwaitExpression") continue;
    const operand = Node_Expression(walk.context.ast, node);
    const operation = walk.context.records.targetOperation.get(node);
    const carrier = rustEffectiveValueCarrier(walk.context.records, operand);
    if (operand === undefined || operation?.kind !== "await-op" || carrier === undefined) continue;
    const knownFuture = resolve(operand);
    requireRustRecord(walk.context.requiredRecords, "awaitValue", node,
      "await", "recordFutureValueFacts");
    const awaiting = walk.context.records.awaitValues.finalize(node, carrier, operation.resultCarrier, leaf => {
      if (knownFuture !== undefined && rustFutureValueMatchesCarrier(knownFuture, leaf, walk.context.typeDefinitions)) return knownFuture;
      const intrinsic = rustFutureValueForSourceStorage(leaf);
      return intrinsic === undefined ? completeRustFutureValue(walk, sourceErrors,
        rustFutureValueForStoredBranch(walk, operand, leaf, sourceErrors)) : intrinsic;
    }, (source, target) => selectRustSourceValueConversion(source, target, walk.context.typeDefinitions));
    if (awaiting === undefined) {
      appendRustDiagnostic(walk, "RUST_AWAIT_VALUE_CONTRACT_NOT_PROVEN",
        "Await requires a closed native branch selection with exact future effects and result conversions.", node,
        ["target.capability=rust.async.await-value"]);
    }
  }
}

export type RustCallableSuspensionSelection =
  | { readonly kind: "none" }
  | { readonly kind: "async"; readonly fact: RustAsyncFunctionFact; readonly retainedEnvironment?: RustRetainedEnvironment }
  | { readonly kind: "generator"; readonly fact: RustGeneratorFact; readonly sourceCarrier: TargetTypeRef;
      readonly retainedEnvironment?: RustRetainedEnvironment };

export function selectRustCallableSuspension(
  walk: RustFactWalk, declaration: Node, ownedReceiver?: TargetTypeRef, contextualResult?: TargetTypeRef,
): RustCallableSuspensionSelection | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const sourceGenerator = walk.context.semanticsFor(declaration).operations.generator(declaration);
  if (sourceGenerator !== undefined) {
    const carrier = resolveRustTargetTypeRef(Node_Type(ast, declaration) ?? sourceGenerator.sourceReturnType ?? sourceReturn,
      rustResolutionContext(walk, declaration), walk.operationOptions);
    const protocol = getRustGeneratorProtocol(carrier);
    if (carrier === undefined || protocol?.kind !== sourceGenerator.generatorKind) {
      appendRustDiagnostic(walk, "RUST_GENERATOR_PROTOCOL_NOT_CLOSED",
        "The checked generator declaration has no closed Rust yield, return, and next protocol.", declaration,
        ["target.capability=rust.generator.protocol"]);
      return undefined;
    }
    const storage = resolveRustSuspendedCallableStorage(walk, declaration,
      [protocol.yieldType, protocol.returnType, protocol.nextType], ownedReceiver);
    if (storage.kind === "rejected") {
      appendRustDiagnostic(walk, "RUST_GENERATOR_STORAGE_LIFETIME_NOT_PROVEN", storage.reason, declaration,
        ["target.capability=rust.generator.storage-lifetime"]);
      return undefined;
    }
    return { kind: "generator", fact: rustGeneratorFact(protocol, storage), sourceCarrier: carrier,
      ...(storage.retainedEnvironment === undefined ? {} : { retainedEnvironment: storage.retainedEnvironment }),
    };
  }
  if (!ast.hasModifierKind(declaration, "async")) return { kind: "none" };
  const future = resolveRustTargetTypeRef(Node_Type(ast, declaration) ?? sourceReturn,
    rustResolutionContext(walk, declaration), walk.operationOptions);
  const selected = selectRustAsyncBodyFacts(walk, declaration, future, ownedReceiver, contextualResult);
  return selected === undefined ? undefined : { kind: "async", ...selected };
}
