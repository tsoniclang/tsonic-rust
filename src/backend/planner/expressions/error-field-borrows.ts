import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { planRustBuiltinErrorPropertyRead } from "./builtin-errors.js";
import { planExpression, planExpressionBeforeContextualConversion } from "./entry.js";
import { planRustRuntimeCategoryExpression } from "./runtime-category.js";

export function rustErrorFieldHasGuardedBorrow(node: Node, context: RustPlanContext): boolean {
  const selected = context.input.program.records.errorFieldEmission.get(node);
  return selected?.kind === "property" && selected.guarded;
}

export function rustErrorFieldBorrowNeedsSnapshot(node: Node, laterExpressions: readonly Node[], context: RustPlanContext): boolean {
  if (!rustErrorFieldHasGuardedBorrow(node, context)) return false;
  return laterExpressions.some(later => context.input.program.records.errorFieldSnapshot.get(node, later)
    ?? failRustPlannerInvariant("An admitted borrowed Error observation requires its sealed later-effect relationship.", node));
}

function overridden(node: Node, context: RustPlanContext): boolean {
  const selected = context.input.program.records.errorFieldEmission.get(node);
  return context.expressionOverrides?.has(node) === true || selected?.kind === "property" && context.expressionOverrides?.has(selected.expression) === true;
}

export function rustErrorFieldSharedView(node: Node, _expression: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.errorFieldEmission.get(node);
  return selected?.kind === "property" && selected.shared && selected.directRead && !overridden(node, context)
    ? { kind: "reference", expr: { kind: "dereference", pointer: planRustBuiltinErrorPropertyRead(node, context) } } : undefined;
}

export function rustErrorFieldOptionalView(node: Node, expression: RustExpr, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.errorFieldEmission.get(node);
  return selected?.kind === "property" && selected.property === "stack" && selected.directRead && !overridden(node, context)
    ? planRustBuiltinErrorPropertyRead(node, context) : expression;
}

export function rustErrorFieldComparisonView(node: Node | undefined, expression: RustExpr,
  laterExpression: Node | undefined, context: RustPlanContext): RustExpr {
  if (node === undefined || context.expressionOverrides?.has(node) === true) return expression;
  if (laterExpression !== undefined && rustErrorFieldBorrowNeedsSnapshot(node, [laterExpression], context)) {
    const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted Error snapshot requires its native binding scope.", node);
    const name = allocateRustSyntheticName(names, "error_snapshot");
    return rustValueBlock([{ name, value: expression }], { kind: "path", path: name });
  }
  const selected = context.input.program.records.stringComparisonView.get(node)
    ?? failRustPlannerInvariant("An admitted comparison requires its sealed native string view.", node);
  if (selected.kind === "literal") return { kind: "str-literal", value: selected.value };
  if (selected.kind === "runtime-category") return context.expressionOverrides?.has(selected.expression) === true
    ? expression : planRustRuntimeCategoryExpression(selected.expression, context);
  if (selected.kind === "native-str-reference") return {
    kind: "call", path: "core::convert::AsRef::<str>::as_ref",
    args: [selected.inputForm === "shared-reference" ? expression : { kind: "reference", expr: expression }],
  };
  if (selected.kind === "error") {
    const field = context.input.program.records.errorFieldEmission.get(node);
    const read = planRustBuiltinErrorPropertyRead(node, context);
    return field?.kind === "property" && field.shared ? { kind: "reference", expr: { kind: "dereference", pointer: read } } : read;
  }
  if (selected.kind === "source") return planExpression(selected.operand, context)
    ?? failRustPlannerInvariant("An admitted borrowed source string requires its native operand.", selected.operand);
  if (selected.kind === "contextual") return planExpressionBeforeContextualConversion(node, context)
    ?? failRustPlannerInvariant("An admitted borrowed string requires its native pre-conversion value.", node);
  return expression;
}
