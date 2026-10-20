import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { KindParenthesizedExpression, KindPropertyAccessExpression, KindElementAccessExpression, KindCallExpression,
  KindIdentifier, Node_Expression } from "@tsonic/target-api/source";
import { requireRustRecord } from "../program/records/required-records.js";

export function recordBindingWrite(walk: RustFactWalk, target: Node | undefined, writeKind: "binding" | "referent" = "binding"): void {
  walk.context.records.assertOpen();
  if (target === undefined) {
    return;
  }
  const { ast } = walk.context;
  const kind = ast.kindName(target);
  if (kind === KindParenthesizedExpression) {
    recordBindingWrite(walk, Node_Expression(ast, target), writeKind);
    return;
  }
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const operation = walk.context.records.targetOperation.get(target);
    if (operation?.kind === "source-indexed-field" ||
      operation?.kind === "source-index-signature" && operation.storage.kind === "record") return;
    const receiver = Node_Expression(walk.context.ast, target);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
      return;
    }
    recordBindingWrite(walk, receiver, "referent");
    return;
  }
  if (kind === KindCallExpression) {
    const fact = walk.context.records.targetOperation.get(target);
    if (fact !== undefined && fact.kind === "flow-marker") {
      recordBindingWrite(walk, ast.arguments(target)[0], "referent");
    }
    return;
  }
  if (kind !== KindIdentifier) {
    return;
  }
  const declaration = walk.context.source.navigation.sourceReferenceFor(target)?.declaration;
  if (declaration !== undefined) {
    requireRustRecord(walk.context.requiredRecords, writeKind === "binding" ? "mutatedBinding" : "mutatedReferent",
      declaration, writeKind, "recordBindingWrite");
    if (writeKind === "binding") walk.context.records.mutatedBindings.written(declaration);
    else walk.context.records.mutatedReferents.written(declaration);
  }
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
