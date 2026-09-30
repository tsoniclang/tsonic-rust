import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";

export function planRustCallableLeadingParameters(
  declaration: Node,
  leading: readonly { readonly kind: "this" | "receiver"; readonly carrier: TargetTypeRef }[],
  context: RustPlanContext,
) {
  if (leading.length > 0 && context.syntheticNames === undefined) return undefined;
  const parameters = leading.map(parameter => ({ ...parameter, name: allocateRustSyntheticName(
    context.syntheticNames!, parameter.kind === "this" ? "_object_this" : "_object_receiver",
  ) }));
  const expressionOverrides = new Map(context.expressionOverrides ?? []);
  const ast = context.input.program.source.ast;
  for (const parameter of parameters) {
    if (parameter.kind !== "this") continue;
    const visit = (node: Node): void => {
      const kind = ast.kindName(node);
      if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
        const carrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
        if (rustTargetTypeRefEquals(carrier, parameter.carrier)) expressionOverrides.set(node, {
          carrier: parameter.carrier, valueForm: "value", expression: { kind: "path", path: parameter.name },
        });
        return;
      }
      if (node !== declaration && (ast.is.IsFunctionExpression(node) || ast.is.IsFunctionDeclaration(node) ||
        ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
        ast.is.IsSetAccessorDeclaration(node) || ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node))) return;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(declaration);
  }
  return { parameters, context: { ...context, expressionOverrides } };
}
