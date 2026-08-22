import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  Node_Expression,
  sourceNodesEqual,
  type SourceProgramNavigation,
} from "@tsonic/target-api/source";

export interface RustValueLifetimePlan {
  canMove(reference: Node): boolean;
}

export function analyzeRustValueLifetimes(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly navigation: SourceProgramNavigation;
}): RustValueLifetimePlan {
  const movableReferences = new WeakSet<Node>();
  const visit = (node: Node): void => {
    const kind = input.ast.kindName(node);
    if (kind === "KindVariableDeclaration" || kind === "KindParameter") {
      classifyDeclaration(node, input, movableReferences);
    }
    input.ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  for (const sourceFile of input.sourceFiles) visit(sourceFile);
  return Object.freeze({
    canMove(reference: Node): boolean {
      return movableReferences.has(reference);
    },
  });
}

function classifyDeclaration(
  declaration: Node,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
  },
  movableReferences: WeakSet<Node>,
): void {
  if (enclosingCallable(declaration, input.ast) === undefined) return;
  const declarationKind = input.ast.variableDeclarationKind(declaration);
  if (declarationKind === "using" || declarationKind === "await using") return;
  const summary = input.navigation.declarationUseSummary(declaration);
  if (summary.captured || summary.exported) return;
  const runtimeUses = summary.uses.filter((use) =>
    use.kind !== "source-linkage" && use.kind !== "type-only");
  for (const { reference } of runtimeUses) {
    if (isExactCallableExitValue(reference, declaration, input)) {
      movableReferences.add(reference);
    }
  }
  if (!summary.bindingWritten && runtimeUses.length === 1) {
    const reference = runtimeUses[0]?.reference;
    if (reference !== undefined &&
      !isInsideRepeatedRegion(reference, declaration, input.ast)) {
      movableReferences.add(reference);
    }
  }
}

function isExactCallableExitValue(
  reference: Node,
  declaration: Node,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
  },
): boolean {
  const declarationCallable = enclosingCallable(declaration, input.ast);
  if (declarationCallable === undefined) {
    return false;
  }
  const selected = input.navigation.sourceReferenceFor(reference);
  if (selected?.symbol === undefined || !sourceNodesEqual(
    input.ast,
    selected.declaration,
    declaration,
  )) {
    return false;
  }
  let current = reference;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined || parent === declarationCallable) {
      const body = input.ast.body(declarationCallable);
      return body !== undefined && sourceNodesEqual(input.ast, body, current);
    }
    if (isTransparentValueWrapper(parent, current, input.ast)) {
      current = parent;
      continue;
    }
    if (input.ast.is.IsReturnStatement(parent) &&
      sourceNodesEqual(input.ast, Node_Expression(input.ast, parent), current) &&
      !returnCrossesRetainedControlRegion(parent, declarationCallable, input.ast)) {
      const references = input.navigation.referencesWithin(selected.symbol, current);
      return references.length === 1 && sourceNodesEqual(
        input.ast,
        references[0],
        reference,
      );
    }
    return false;
  }
}

function returnCrossesRetainedControlRegion(
  statement: Node,
  callable: Node,
  ast: AstReader,
): boolean {
  let current = ast.parent(statement);
  while (current !== undefined && current !== callable) {
    const kind = ast.kindName(current);
    if (ast.is.IsTryStatement(current) || kind === "KindSwitchStatement" ||
      kind === "KindForStatement" || kind === "KindForInStatement" ||
      kind === "KindForOfStatement" || kind === "KindWhileStatement" ||
      kind === "KindDoStatement") {
      return true;
    }
    if (isCallableKind(kind)) {
      return true;
    }
    current = ast.parent(current);
  }
  return current !== callable;
}

function isTransparentValueWrapper(
  wrapper: Node,
  expression: Node,
  ast: AstReader,
): boolean {
  if (ast.is.IsParenthesizedExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsParenthesizedExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsAsExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsAsExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsSatisfiesExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsSatisfiesExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsNonNullExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsNonNullExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsTypeAssertion(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsTypeAssertion(wrapper)?.Expression, expression);
  }
  return false;
}

function isInsideRepeatedRegion(
  reference: Node,
  declaration: Node,
  ast: AstReader,
): boolean {
  const declarationCallable = enclosingCallable(declaration, ast);
  let current = ast.parent(reference);
  while (current !== undefined && current !== declarationCallable) {
    const kind = ast.kindName(current);
    if (isCallableKind(kind) || kind === "KindForStatement" ||
      kind === "KindForInStatement" || kind === "KindForOfStatement" ||
      kind === "KindWhileStatement" || kind === "KindDoStatement") {
      return true;
    }
    current = ast.parent(current);
  }
  return current !== declarationCallable;
}

function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (isCallableKind(ast.kindName(current))) return current;
    current = ast.parent(current);
  }
  return undefined;
}

function isCallableKind(kind: string): boolean {
  return kind === "KindFunctionDeclaration" || kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" || kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}
