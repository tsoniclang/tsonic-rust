import type { Node } from "@tsonic/tsts";
import type { RustStmt } from "../../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planRustSourceCallableValueConstruction } from "../../expressions/source-callable-value.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

export function planRustLexicalFunctionValues(
  statement: Node, context: RustPlanContext,
): readonly RustStmt[] {
  const statements: RustStmt[] = [];
  for (const { declaration, name, value } of context.input.program.records.lexicalValues.get(statement) ?? []) {
    // The binding holds the value as constructed: a callable construction stores its selected physical carrier.
    const construction = context.input.program.records.sourceCallableEmission.get(value.sourceDeclaration, value.carrier)?.construction;
    const type = rustTypeFromCarrierInContext(construction?.kind === "callable" ? construction.physical : value.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted lexical callable value requires its native storage type.", declaration);
    const initializer = planRustSourceCallableValueConstruction(value, context);
    if (initializer === undefined) failRustPlannerInvariant("An admitted lexical callable value requires its native initializer.", declaration);
    statements.push({ kind: "let", name, mutable: false, type, init: initializer });
  }
  return statements;
}
