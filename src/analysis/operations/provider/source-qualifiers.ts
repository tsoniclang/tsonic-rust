import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustCheckedPropertySelectionInput, RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";

export function isIntrinsicSourceQualifier(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): boolean {
  const { ast } = context;
  const declaration = request.sourceSelectedDeclaration;
  if (!options.jsEnabled || request.accessMode !== "read" || request.optionalChain === true ||
    request.sourceReceiverIntrinsic !== "global-object" || declaration === undefined ||
    !ast.is.IsVariableDeclaration(declaration) ||
    options.sourceProfiles.profileForNode(declaration, ast) !== "js") return false;
  if (ast.is.IsElementAccessExpression(request.expression)) {
    const argument = ElementAccessExpression_ArgumentExpression(ast, request.expression);
    if (argument === undefined || (!ast.is.IsStringLiteral(argument) &&
      !ast.is.IsNoSubstitutionTemplateLiteral(argument))) return false;
  }
  let qualifier = request.expression;
  let parent = ast.parent(qualifier);
  while (parent !== undefined && (
    ast.is.IsParenthesizedExpression(parent) || ast.is.IsAsExpression(parent) ||
    ast.is.IsTypeAssertion(parent) || ast.is.IsSatisfiesExpression(parent) ||
    ast.is.IsNonNullExpression(parent))) {
    if (Node_Expression(ast, parent) !== qualifier) return false;
    qualifier = parent;
    parent = ast.parent(parent);
  }
  return parent !== undefined &&
    (ast.is.IsPropertyAccessExpression(parent) || ast.is.IsElementAccessExpression(parent)) &&
    Node_Expression(ast, parent) === qualifier;
}
