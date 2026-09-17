import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { Node_Expression, sourceClassFieldIsTypeOnly, sourceMemberOwner } from "@tsonic/target-api/source";
import type { RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";

export function rustLocalClassIssue(
  declaration: Node,
  ast: AstReader,
  navigation: SourceProgramNavigation,
  genericParameters: readonly RustSourceGenericParameterContract[] | undefined,
): { readonly node: Node; readonly message: string } | undefined {
  if (ast.parent(declaration) === ast.getSourceFile(declaration)) return undefined;
  if (genericParameters === undefined) {
    return { node: declaration, message: "Local class has no exact non-conflicting enclosing generic parameter contract." };
  }
  if (ast.extendsHeritageElements(declaration).length !== 0) {
    const heritage = navigation.declaredHeritage(declaration);
    if (heritage.kind !== "resolved" || heritage.edges.filter(edge => edge.kind === "extends").some(edge => {
      let expression = ast.is.IsExpressionWithTypeArguments(edge.heritage)
        ? ast.as.AsExpressionWithTypeArguments(edge.heritage)?.Expression
        : edge.heritage;
      while (expression !== undefined && ast.kindName(expression) === "KindParenthesizedExpression") {
        expression = Node_Expression(ast, expression);
      }
      return expression === undefined ||
        (ast.kindName(expression) !== "KindIdentifier" && ast.kindName(expression) !== "KindPropertyAccessExpression") ||
        ast.kindName(edge.target.declaration) !== "KindClassDeclaration" ||
        ast.parent(edge.target.declaration) !== ast.getSourceFile(edge.target.declaration);
    })) {
      return { node: declaration, message: "Local class heritage requires a directly selected module class without per-evaluation base effects." };
    }
  }
  for (const member of ast.members(declaration)) {
    if (member === undefined) return { node: declaration, message: "Local class has an absent member." };
    if (!sourceClassFieldIsTypeOnly(ast, member) &&
      (ast.hasModifierKind(member, "static") && ast.kindName(member) !== "KindMethodDeclaration" ||
        ast.kindName(member) === "KindClassStaticBlockDeclaration")) {
      return { node: member, message: "Local class static state requires per-evaluation storage." };
    }
  }
  for (const use of navigation.declarationUses(declaration)) {
    if (use.kind === "type-only") continue;
    let expression = use.reference;
    let parent = ast.parent(expression);
    while (parent !== undefined && ast.kindName(parent) === "KindParenthesizedExpression") {
      expression = parent;
      parent = ast.parent(expression);
    }
    const selectedMember = parent === undefined ? undefined : navigation.sourceReferenceFor(parent)?.declaration;
    const call = parent === undefined ? undefined : ast.parent(parent);
    const staticCall = parent !== undefined && ast.kindName(parent) === "KindPropertyAccessExpression" &&
      Node_Expression(ast, parent) === expression && selectedMember !== undefined &&
      ast.parent(selectedMember) === declaration && ast.kindName(selectedMember) === "KindMethodDeclaration" &&
      ast.hasModifierKind(selectedMember, "static") && call !== undefined &&
      ast.kindName(call) === "KindCallExpression" && Node_Expression(ast, call) === parent;
    if (!staticCall && (parent === undefined || ast.kindName(parent) !== "KindNewExpression" ||
      Node_Expression(ast, parent) !== expression)) {
      return { node: use.reference, message: "Local class constructor identity must not escape direct construction." };
    }
    if (!inside(use.reference, declaration, ast) && ast.pos(use.reference) < ast.end(declaration)) {
      return { node: use.reference, message: "Local class construction is not proved to follow class evaluation." };
    }
  }
  let issue: { readonly node: Node; readonly message: string } | undefined;
  const visit = (node: Node): void => {
    if (issue !== undefined) return;
    if (ast.kindName(node) === "KindIdentifier") {
      const selected = navigation.sourceReferenceFor(node)?.declaration;
      if (selected !== undefined && genericParameters.some(parameter => parameter.declaration === selected)) return;
      if (selected !== undefined && (ast.kindName(selected) === "KindClassDeclaration" ||
        ast.kindName(selected) === "KindTypeAliasDeclaration" ||
        ast.kindName(selected) === "KindInterfaceDeclaration")) return;
      const memberOwner = selected === undefined ? undefined : sourceMemberOwner(ast, selected);
      if (memberOwner !== undefined && (ast.kindName(memberOwner) === "KindClassDeclaration" ||
        ast.kindName(memberOwner) === "KindInterfaceDeclaration" || ast.kindName(memberOwner) === "KindTypeLiteral")) return;
      if (selected !== undefined && !inside(selected, declaration, ast)) {
        let owner = ast.parent(selected);
        while (owner !== undefined && ast.kindName(owner) !== "KindSourceFile") {
          const kind = ast.kindName(owner);
          if (kind === "KindBlock" || kind === "KindFunctionDeclaration" ||
            kind === "KindFunctionExpression" || kind === "KindArrowFunction" ||
            kind === "KindMethodDeclaration" || kind === "KindConstructor") {
            issue = { node, message: "Local class captures an enclosing lexical value or type without a finalized capture contract." };
            return;
          }
          owner = ast.parent(owner);
        }
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(declaration);
  return issue;
}

function inside(node: Node, owner: Node, ast: AstReader): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === owner) return true;
    current = ast.parent(current);
  }
  return false;
}
