import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { Node_Expression, sourceClassFieldIsTypeOnly } from "@tsonic/target-api/source";

export function rustLocalClassIssue(
  declaration: Node,
  ast: AstReader,
  navigation: SourceProgramNavigation,
): { readonly node: Node; readonly message: string } | undefined {
  if (ast.parent(declaration) === ast.getSourceFile(declaration)) return undefined;
  if (ast.extendsHeritageElements(declaration).length !== 0 ||
    ast.implementsHeritageElements(declaration).length !== 0) {
    return { node: declaration, message: "Local class heritage requires a per-evaluation constructor contract." };
  }
  for (const member of ast.members(declaration)) {
    if (member === undefined) return { node: declaration, message: "Local class has an absent member." };
    if (!sourceClassFieldIsTypeOnly(ast, member) &&
      (ast.hasModifierKind(member, "static") || ast.kindName(member) === "KindClassStaticBlockDeclaration")) {
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
    if (parent === undefined || ast.kindName(parent) !== "KindNewExpression" ||
      Node_Expression(ast, parent) !== expression) {
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
