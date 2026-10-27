import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { KindParenthesizedExpression, KindPropertyAccessExpression, KindElementAccessExpression, KindCallExpression,
  KindIdentifier, Node_Expression } from "@tsonic/target-api/source";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustReferentWrite } from "../program/records/storage/mutated-referent.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustReferentMutationRequiresMutableBinding } from "../../policy/types/storage/referent-mutation.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function recordBindingWrite(walk: RustFactWalk, target: Node | undefined, writeKind: "binding" | "referent" = "binding"): void {
  walk.context.records.assertOpen();
  if (target === undefined) {
    return;
  }
  const { ast } = walk.context;
  const original = target;
  const receivers: { readonly expression: Node; readonly use: Node }[] = [];
  const record = (current: Node | undefined, kind: "binding" | "referent"): void => {
    if (current === undefined) return;
    const nodeKind = ast.kindName(current);
    if (nodeKind === KindParenthesizedExpression) {
      record(Node_Expression(ast, current), kind);
      return;
    }
    if (nodeKind === KindPropertyAccessExpression || nodeKind === KindElementAccessExpression) {
      const operation = walk.context.records.targetOperation.get(current);
      if (operation?.kind === "source-indexed-field" ||
        operation?.kind === "source-index-signature" && operation.storage.kind === "record") return;
      const receiver = Node_Expression(ast, current);
      const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
      if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") return;
      if (receiver !== undefined) receivers.push({ expression: receiver, use: current });
      record(receiver, "referent");
      return;
    }
    if (nodeKind === KindCallExpression) {
      const fact = walk.context.records.targetOperation.get(current);
      if (fact?.kind === "flow-marker") {
        const receiver = ast.arguments(current)[0];
        if (receiver !== undefined) receivers.push({ expression: receiver, use: current });
        record(receiver, "referent");
      }
      return;
    }
    if (nodeKind !== KindIdentifier) return;
    const declaration = walk.context.source.navigation.sourceReferenceFor(current)?.declaration;
    if (declaration === undefined) return;
    requireRustRecord(walk.context.requiredRecords, kind === "binding" ? "mutatedBinding" : "mutatedReferent",
      declaration, kind, "recordBindingWrite");
    if (kind === "binding") walk.context.records.mutatedBindings.written(declaration);
    else walk.context.records.mutatedReferents.written(declaration, { target: original,
      receivers: receivers.length === 0 ? [{ expression: current, use: original }] : receivers });
  };
  record(target, writeKind);
}

export function rustReferentWriteRequiresMutableBinding(
  records: Pick<RustProgramRecords, "targetOperation" | "runtimeCarrier" | "flowReadProjection">,
  write: RustReferentWrite,
  isSharedObject: (carrier: TargetTypeRef) => boolean,
): boolean {
  const path = write.receivers.map(receiver => {
    const operation = records.targetOperation.get(receiver.use);
    if (operation?.kind === "source-union-field") {
      if (operation.selectedVariantIndexes.length === 0)
        failTargetAnalysisInvariant("tsonic-rust", "A native referent write requires its selected union receivers.", receiver.use);
      return operation.selectedVariantIndexes.map(index => {
        const variant = operation.variants[index];
        if (variant === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native referent write requires its exact selected union receiver.", receiver.use);
        return variant.carrier;
      });
    }
    const carrier = records.runtimeCarrier.get(receiver.expression)?.carrier;
    if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native referent write requires its actual receiver carrier.", receiver.expression);
    const projection = records.flowReadProjection.get(receiver.expression);
    if (projection !== undefined && !rustTargetTypeRefEquals(carrier, projection.sourceCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "A native referent write requires its exact source projection.", receiver.expression);
    return [projection === undefined ? carrier : projection.selectedCarrier];
  });
  return rustReferentMutationRequiresMutableBinding(path, isSharedObject);
}

export function recordAssignmentWrite(
  walk: RustFactWalk,
  expression: Node,
  target: Node | undefined,
): void {
  const targetKind = target === undefined ? "" : walk.context.ast.kindName(target);
  const operation = walk.context.records.compoundWrite.get(expression) ??
    walk.context.records.targetOperation.get(expression);
  if ((targetKind === KindPropertyAccessExpression || targetKind === KindElementAccessExpression) &&
    operation?.kind === "runtime-set" && operation.abi.targetReceiver.kind === "input" &&
    operation.abi.targetReceiver.input.mode === "ref") {
    return;
  }
  recordBindingWrite(walk, target);
}
