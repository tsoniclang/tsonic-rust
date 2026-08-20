import type { AstReader, Node } from "@tsonic/tsts";
import {
  sourceNodesEqual,
  type SourceProgramNavigation,
} from "@tsonic/target-api/source";

interface RustSourceLifetimeContext {
  readonly input: {
    readonly program: {
      readonly source: {
        readonly ast: AstReader;
        readonly navigation: SourceProgramNavigation;
      };
    };
  };
}

export function rustSourceReferenceCanMove(
  reference: Node,
  context: RustSourceLifetimeContext,
): boolean {
  const selected = context.input.program.source.navigation.sourceReferenceFor(reference);
  const declaration = selected?.declaration;
  if (declaration === undefined ||
    !isLocalValueDeclaration(declaration, context) ||
    isInsideRepeatedRegion(reference, declaration, context)) {
    return false;
  }
  const summary = context.input.program.source.navigation.declarationUseSummary(declaration);
  if (summary.bindingWritten || summary.captured || summary.exported) {
    return false;
  }
  const runtimeUses = summary.uses.filter((use) =>
    use.kind !== "source-linkage" && use.kind !== "type-only");
  return runtimeUses.length === 1 &&
    sourceNodesEqual(context.input.program.source.ast, runtimeUses[0]?.reference, reference);
}

function isLocalValueDeclaration(
  declaration: Node,
  context: RustSourceLifetimeContext,
): boolean {
  const { ast } = context.input.program.source;
  if (!ast.is.IsVariableDeclaration(declaration) &&
    !ast.is.IsParameterDeclaration(declaration)) {
    return false;
  }
  let current = ast.parent(declaration);
  while (current !== undefined) {
    if (isCallable(current, context)) {
      return true;
    }
    if (ast.is.IsSourceFile(current)) {
      return false;
    }
    current = ast.parent(current);
  }
  return false;
}

function isInsideRepeatedRegion(
  reference: Node,
  declaration: Node,
  context: RustSourceLifetimeContext,
): boolean {
  const { ast } = context.input.program.source;
  const declarationCallable = enclosingCallable(declaration, context);
  let current = ast.parent(reference);
  while (current !== undefined && current !== declarationCallable) {
    if (isCallable(current, context) || ast.is.IsForStatement(current) ||
      ast.is.IsForInStatement(current) || ast.is.IsForOfStatement(current) ||
      ast.is.IsWhileStatement(current) || ast.is.IsDoStatement(current)) {
      return true;
    }
    current = ast.parent(current);
  }
  return current !== declarationCallable;
}

function enclosingCallable(
  node: Node,
  context: RustSourceLifetimeContext,
): Node | undefined {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (isCallable(current, context)) {
      return current;
    }
    current = context.input.program.source.ast.parent(current);
  }
  return undefined;
}

function isCallable(node: Node, context: RustSourceLifetimeContext): boolean {
  const { ast } = context.input.program.source;
  return ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node) ||
    ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
    ast.is.IsSetAccessorDeclaration(node);
}
