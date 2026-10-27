import type { Node } from "@tsonic/tsts";
import type { RustSafetyApplication, RustSafetyOperation } from "../../../target-model/records/storage/safety.js";
import type { RustPlanningContext } from "../context.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustAttribute } from "../../target-ast/syntax/attributes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustExplicitSafetyExpression(
  node: Node,
  selected: RustSafetyOperation,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  if (selected.kind !== "unsafe-context" || selected.fact.kind !== "expression")
    failRustPlannerInvariant("An admitted unsafe expression requires its exact source operand and placement.", node);
  const expression = planExpression(
    selected.fact.expression,
    withExplicitUnsafeContext(context),
  );
  return expression === undefined ? undefined : { kind: "unsafe", expression };
}


export function isRustExplicitUnsafeBlockMarker(
  statement: Node | undefined,
  input: RustPlanningContext,
): boolean {
  const expression = statement === undefined ||
      input.program.source.ast.kindName(statement) !== "KindExpressionStatement"
    ? undefined
    : Node_Expression(input.program.source.ast, statement);
  const selected = expression === undefined
    ? undefined
    : input.program.records.safetyOperation.get(expression);
  return selected?.kind === "unsafe-context" &&
    selected.fact.kind === "remaining-block";
}

export function isErasedRustSafetyExpressionStatement(
  statement: Node,
  input: RustPlanningContext,
): boolean {
  if (input.program.source.ast.kindName(statement) !== "KindExpressionStatement") {
    return false;
  }
  const expression = Node_Expression(input.program.source.ast, statement);
  if (expression === undefined) {
    return false;
  }
  const selected = input.program.records.safetyOperation.get(expression);
  return (selected?.kind === "safety-builder" &&
      selected.fact.kind === "application") ||
    (selected?.kind === "unsafe-context" &&
      selected.fact.kind === "remaining-block");
}

export function withExplicitUnsafeContext(
  context: RustPlanContext,
): RustPlanContext {
  return {
    ...context,
    explicitUnsafeContextDepth: (context.explicitUnsafeContextDepth ?? 0) + 1,
  };
}


export function rustDeclarationRequiresUnsafe(declaration: Node, placement: RustSafetyApplication["applicationPlacement"],
  input: RustPlanningContext, additionalDeclaration?: Node): boolean {
  const selected = input.program.records.declarationSafety.get(declaration, placement);
  if (selected === undefined) failRustPlannerInvariant("An admitted declaration requires its sealed native caller-safety contract.", declaration);
  if (additionalDeclaration === undefined) return selected;
  const additional = input.program.records.declarationSafety.get(additionalDeclaration, placement);
  if (additional === undefined) failRustPlannerInvariant("An admitted declaration requires its additional native caller-safety contract.", additionalDeclaration);
  return selected || additional;
}

export function rustSelectedCallRequiresUnsafe(call: Node, input: RustPlanningContext): boolean {
  return input.program.records.callSafety.get(call)
    ?? failRustPlannerInvariant("An admitted call requires its sealed native safety contract.", call);
}

export function rustSelectedAccessorRequiresUnsafe(access: Node, role: "getter" | "setter", input: RustPlanningContext): boolean {
  return input.program.records.accessorSafety.get(access, role)
    ?? failRustPlannerInvariant("An admitted accessor requires its sealed native safety contract.", access);
}

export function rustSafetyAttributesForDeclaration(declaration: Node, isUnsafe: boolean, input: RustPlanningContext): readonly RustAttribute[] {
  const selected = input.program.records.safetyAttributes.get(declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted declaration requires its source-owned native safety lint selection.", declaration);
  return [...(isUnsafe ? [rustLintAttributes.missingSafetyDoc] : []),
    ...(!isUnsafe && selected.nativePointer ? [rustLintAttributes.pointerDerefOutsideUnsafeFunction] : []),
    ...(selected.unusedUnsafe ? [rustLintAttributes.unusedUnsafe] : [])];
}
