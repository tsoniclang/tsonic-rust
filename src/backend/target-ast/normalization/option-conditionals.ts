import type { RustExpr } from "../nodes.js";

export function normalizeRustOptionalUnitMatch(
  expression: Extract<RustExpr, { readonly kind: "match" }>,
): RustExpr {
  if (expression.arms.length !== 2) return expression;
  const [present, absent] = expression.arms;
  if (present!.pattern.kind !== "tuple-variant" || present!.pattern.path !== "Some" ||
    present!.pattern.elements.length !== 1 || absent!.pattern.kind !== "path" || absent!.pattern.path !== "None" ||
    absent!.expression.kind !== "tuple-literal" || absent!.expression.elements.length !== 0) return expression;
  return { kind: "if-let", pattern: present!.pattern, expression: expression.expression, whenTrue: present!.expression };
}
