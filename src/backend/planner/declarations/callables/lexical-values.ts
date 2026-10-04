import type { Node } from "@tsonic/tsts";
import { rustSourceCallableValueFactKey } from "../../../../analysis/facts/keys.js";
import type { RustStmt } from "../../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { planRustSourceCallableValueConstruction } from "../../expressions/source-callable-value.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

export function planRustLexicalFunctionValues(
  statement: Node, context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  const navigation = context.input.program.sourceNavigation;
  for (const declaration of context.input.program.lexicalFunctions.valueDeclarationsAt(statement)) {
    const selection = context.input.program.lexicalFunctions.forDeclaration(declaration);
    if (selection?.kind !== "resolved" || !selection.valueObserved) continue;
    const name = context.input.program.names.callableValueNameForDeclaration(declaration);
    const values = navigation.declarationUseSummary(declaration).uses.flatMap(use => {
      const value = context.input.program.facts.getFact(use.reference, rustSourceCallableValueFactKey);
      return value === undefined ? [] : [value];
    });
    const value = values[0];
    const type = value === undefined ? undefined : rustTypeFromCarrierInContext(value.carrier, context);
    if (name === undefined || value === undefined || type === undefined ||
      value.sourceDeclaration !== declaration ||
      !values.every(candidate => rustSourceCallableValueFactKey.equals(candidate, value))) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
        "rust.backend.lexical-function-value-contract", "A lexical function requires one exact checked callable value contract."));
      return undefined;
    }
    const initializer = planRustSourceCallableValueConstruction(value, context);
    if (initializer === undefined) return undefined;
    statements.push({ kind: "let", name, mutable: false, type, init: initializer });
  }
  return statements;
}
