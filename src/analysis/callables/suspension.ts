import { KindIdentifier, KindParenthesizedExpression, KindVariableDeclaration, Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { appendRustDiagnostic, type RustFactWalk } from "../program/walk.js";
import { rustFutureValueForOperation, rustFutureValueForSourceStorage, rustFutureValueMatchesCarrier, transportRustFutureValue } from "./future-values.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { RustFutureValueFact } from "../../target-model/records/object-methods.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { rustFutureValueForStoredBranch } from "./future-storage.js";
import { requireRustRecord } from "../program/records/required-records.js";
import type { RustSourceErrorEffectSelection } from "../errors/source-error-effects.js";

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
      return intrinsic === undefined ? rustFutureValueForStoredBranch(walk, operand, leaf, sourceErrors) : intrinsic;
    }, (source, target) => selectRustSourceValueConversion(source, target, walk.context.typeDefinitions));
    if (awaiting === undefined) {
      appendRustDiagnostic(walk, "RUST_AWAIT_VALUE_CONTRACT_NOT_PROVEN",
        "Await requires a closed native branch selection with exact future effects and result conversions.", node,
        ["target.capability=rust.async.await-value"]);
    }
  }
}
