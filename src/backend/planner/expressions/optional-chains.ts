import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression, planRawExpression } from "./entry.js";
import { readRustStructuralObjectMethodStorage } from "../objects/project-storage.js";
import { planRustAbsentValue, planRustCheckedSourceOptional } from "./optional-storage.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";

export function effectiveMemberResultCarrier(node: Node, innerResultCarrier: TargetTypeRef,
  context: RustPlanContext): TargetTypeRef {
  return context.input.program.records.optionalChainEmission.get(node)?.fact.resultCarrier ?? innerResultCarrier;
}

export function planOptionalChainExpression(node: Node, context: RustPlanContext,
  planInner: (context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const selected = context.input.program.records.optionalChainEmission.get(node);
  if (selected === undefined) return planInner(context);
  const { fact, structuralGuard } = selected;
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted optional chain requires its native name scope.", node);
  const guard = structuralGuard === undefined ? planRawExpression(fact.guard, context, "value") : (() => {
    const receiver = planExpression(structuralGuard.receiverNode, context);
    return receiver === undefined ? undefined : readRustStructuralObjectMethodStorage(
      structuralGuard.receiverCarrier, receiver, structuralGuard.storageIndex, context);
  })();
  if (guard === undefined) failRustPlannerInvariant("An admitted optional chain requires its native guard.", fact.guard);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "optional_receiver");
  // An indexed element guard (`callbacks[1]?.(..)`) is an owned Option temporary; it is matched by value, not borrowed
  // through `.as_ref()`.
  const ast = context.input.program.source.ast;
  const indexed = context.input.program.records.targetOperation.get(fact.guard);
  const ownedGuard = structuralGuard === undefined && fact.guardDepth === 1 && ast.is.IsElementAccessExpression(fact.guard) &&
    indexed?.kind === "provider-operation" && indexed.abi.operationKind === "indexer";
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fact.guard, { expression: { kind: "path", path: receiverName },
    carrier: structuralGuard?.selectedStorageCarrier ?? fact.selectedGuardCarrier, valueForm: ownedGuard ? "value" : "shared-reference" });
  const body = planInner({ ...context, expressionOverrides: overrides });
  if (body === undefined) failRustPlannerInvariant("An admitted optional chain requires its selected native body.", node);
  let borrowedGuard: RustExpr = ownedGuard ? guard : { kind: "method-call", receiver: guard, method: "as_ref", args: [] };
  for (let depth = 1; depth < fact.guardDepth; depth++) borrowedGuard = {
    kind: "method-call", receiver: borrowedGuard, method: "and_then",
    args: [{ kind: "path", path: "core::option::Option::as_ref" }],
  };
  const pattern = { kind: "tuple-variant" as const, path: "Some", elements: [{ kind: "binding" as const, name: receiverName }] };
  if (selected.unit) return { kind: "if-let", expression: borrowedGuard, pattern, whenTrue: body };
  if (selected.closure !== undefined) {
    const closure: RustExpr = { kind: "closure", params: [{ name: receiverName, byRefCopy: false }], body };
    // An and_then chain over optional storage reads its stored value through the checked optional form.
    const storageValue = selected.closure === "and_then" && rustOptionalStorageValue(fact.innerResultCarrier) !== undefined;
    const method = selected.closure === "map" || storageValue ? "map" : "and_then";
    const mapped: RustExpr = { kind: "method-call", receiver: borrowedGuard, method, args: [closure] };
    return method === "map" ? planRustCheckedSourceOptional(mapped, fact.innerResultCarrier, context) : mapped;
  }
  const value: RustExpr = { kind: "match", expression: borrowedGuard, arms: [
    { pattern, expression: fact.lowering === "map" ? { kind: "call", path: "Some", args: [body] } : body },
    { pattern: { kind: "path", path: "None" }, expression: fact.lowering === "map"
      ? { kind: "none" } : planRustAbsentValue(fact.resultCarrier, context) },
  ] };
  return fact.lowering === "map" ? planRustCheckedSourceOptional(value, fact.innerResultCarrier, context) : value;
}
