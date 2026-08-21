import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";

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
  const summary = input.navigation.declarationUseSummary(declaration);
  if (summary.bindingWritten || summary.captured || summary.exported) return;
  const runtimeUses = summary.uses.filter((use) =>
    use.kind !== "source-linkage" && use.kind !== "type-only");
  const reference = runtimeUses.length === 1
    ? runtimeUses[0]?.reference
    : undefined;
  if (reference !== undefined &&
    !isInsideRepeatedRegion(reference, declaration, input.ast)) {
    movableReferences.add(reference);
  }
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
