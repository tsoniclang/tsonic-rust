import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustClosureCaptureFact } from "../facts/operations/keys.js";
import {
  Node_Expression,
  sourceNodesEqual,
  type SourceProgramNavigation,
} from "@tsonic/target-api/source";

export interface RustValueLifetimePlan {
  canMove(reference: Node): boolean;
  canMoveCapture(closure: Node, declaration: Node): boolean;
  canBorrowStableValue(reference: Node): boolean;
}

export function analyzeRustValueLifetimes(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly navigation: SourceProgramNavigation;
  readonly isOwnedString: (declaration: Node) => boolean;
  readonly hasSharedIdentityStorage: (declaration: Node) => boolean;
  readonly mayBorrowArgument: (argument: Node) => boolean;
  readonly isSharedBorrowArgument: (argument: Node) => boolean;
  readonly capturesFor: (closure: Node) => RustClosureCaptureFact | undefined;
}): RustValueLifetimePlan {
  const movableReferences = new WeakSet<Node>();
  const movableCaptures = new WeakMap<Node, ReadonlySet<Node>>();
  const stableBindings = new WeakSet<Node>();
  const visit = (node: Node): void => {
    const kind = input.ast.kindName(node);
    if (["KindStringLiteral", "KindNoSubstitutionTemplateLiteral", "KindNumericLiteral", "KindBigIntLiteral",
      "KindTrueKeyword", "KindFalseKeyword"].includes(kind)) stableBindings.add(node);
    if (input.ast.is.IsCallExpression(node) || input.ast.is.IsNewExpression(node)) {
      movableReferences.add(node);
    }
    if (kind === "KindVariableDeclaration" || kind === "KindParameter") {
      classifyDeclaration(node, input, movableReferences);
      const summary = input.navigation.declarationUseSummary(node);
      const immutableString = input.isOwnedString(node) && !summary.hasUnclassifiedValueUse &&
        summary.uses.every(use => use.kind === "type-only" ||
          use.role === "argument" && input.isSharedBorrowArgument(use.reference) ||
          ["comparison", "condition", "return", "storage"].includes(use.role));
      if ((input.hasSharedIdentityStorage(node) || immutableString) && enclosingCallable(node, input.ast) !== undefined && !summary.captured &&
        !summary.exported && !summary.bindingWritten && !summary.memberWritten) {
        for (const use of summary.uses) {
          if (input.ast.is.IsIdentifier(use.reference)) stableBindings.add(use.reference);
        }
      }
    }
    if (kind === "KindArrowFunction" || kind === "KindFunctionExpression" ||
      kind === "KindClassDeclaration" || kind === "KindClassExpression") {
      const captures = input.capturesFor(node)?.captures.filter(capture =>
        capture.storage === "value" &&
        isSingleOwnedCapture(node, capture.declaration, input));
      if (captures !== undefined && captures.length > 0) {
        movableCaptures.set(node, new Set(captures.map(capture => capture.declaration)));
      }
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
    canMoveCapture(closure: Node, declaration: Node): boolean {
      return movableCaptures.get(closure)?.has(declaration) === true;
    },
    canBorrowStableValue(reference: Node): boolean {
      return stableBindings.has(reference);
    },
  });
}

function isSingleOwnedCapture(
  closure: Node,
  declaration: Node,
  input: { readonly ast: AstReader; readonly navigation: SourceProgramNavigation },
): boolean {
  const { ast, navigation } = input;
  const owner = enclosingCallable(declaration, ast);
  const parent = ast.parent(closure);
  if (owner === undefined || parent === undefined || enclosingCallable(parent, ast) !== owner) return false;
  const declarationKind = ast.variableDeclarationKind(declaration);
  if (declarationKind === "using" || declarationKind === "await using" ||
    isInsideRepeatedRegion(closure, declaration, ast)) return false;
  const summary = navigation.declarationUseSummary(declaration);
  if (summary.bindingWritten || summary.exported) return false;
  const uses = summary.uses.filter(use => use.kind !== "source-linkage" && use.kind !== "type-only");
  return uses.length > 0 && uses.every(use => {
    let current: Node | undefined = use.reference;
    while (current !== undefined && current !== closure && current !== owner) current = ast.parent(current);
    return current === closure;
  });
}

function classifyDeclaration(
  declaration: Node,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
    readonly isOwnedString: (declaration: Node) => boolean;
    readonly mayBorrowArgument: (argument: Node) => boolean;
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
    if (isExactCallableExitValue(reference, declaration, input) ||
      input.isOwnedString(declaration) && isLastUseOnPath(reference, declaration, input)) {
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
  if (selected === undefined || !sourceNodesEqual(
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
    if (input.ast.is.IsConditionalExpression(parent)) {
      const conditional = input.ast.as.AsConditionalExpression(parent);
      if (sourceNodesEqual(input.ast, conditional?.WhenTrue, current) ||
        sourceNodesEqual(input.ast, conditional?.WhenFalse, current)) {
        current = parent;
        continue;
      }
    }
    if (input.ast.is.IsReturnStatement(parent) &&
      sourceNodesEqual(input.ast, Node_Expression(input.ast, parent), current) &&
      !returnCrossesRetainedControlRegion(parent, declarationCallable, input.ast)) {
      return true;
    }
    return false;
  }
}

function isLastUseOnPath(
  reference: Node,
  declaration: Node,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
    readonly mayBorrowArgument: (argument: Node) => boolean;
  },
): boolean {
  const callable = enclosingCallable(declaration, input.ast);
  const body = declarationLifetimeBlock(declaration, input.ast);
  if (body === undefined || !input.ast.is.IsBlock(body)) return false;
  if (isInsideRepeatedRegion(reference, declaration, input.ast)) return false;
  const range = input.ast.authoredRange(reference);
  if (range.kind !== "authored") return false;
  const invocations = new Set<Node>();
  let terminalRegion: Node | undefined;
  let current = reference;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return false;
    if (terminalRegion === undefined && input.ast.is.IsBlock(parent) && blockEndsLifetime(parent, declaration, callable, input.ast)) {
      terminalRegion = parent;
    }
    if (parent === body) break;
    const kind = input.ast.kindName(parent);
    if (input.ast.is.IsCallExpression(parent) || input.ast.is.IsNewExpression(parent)) invocations.add(parent);
    if (!isTransparentValueWrapper(parent, current, input.ast) &&
      kind !== "KindCallExpression" && kind !== "KindNewExpression" &&
      kind !== "KindReturnStatement" && kind !== "KindExpressionStatement" &&
      kind !== "KindVariableDeclaration" && kind !== "KindVariableDeclarationList" &&
      kind !== "KindVariableStatement" && kind !== "KindBlock" &&
      !(kind === "KindIfStatement" && input.ast.as.AsIfStatement(parent)?.Expression !== current)) return false;
    current = parent;
  }
  return input.navigation.declarationUses(declaration).every(use => {
    if (use.kind === "source-linkage" || use.kind === "type-only" || use.reference === reference) return true;
    if (use.captured) return false;
    if (terminalRegion !== undefined && !isWithin(use.reference, terminalRegion, input.ast)) return true;
    const other = input.ast.authoredRange(use.reference);
    return other.kind === "authored" && other.end <= range.start &&
      !hasOverlappingArgumentBorrow(use.reference, invocations, input);
  });
}

function declarationLifetimeBlock(declaration: Node, ast: AstReader): Node | undefined {
  if (ast.kindName(declaration) === "KindParameter" || ast.variableDeclarationKind(declaration) === "var") {
    return ast.body(enclosingCallable(declaration, ast));
  }
  let current = ast.parent(declaration);
  while (current !== undefined) {
    if (ast.is.IsBlock(current)) return current;
    if (isCallableKind(ast.kindName(current))) return ast.body(current);
    current = ast.parent(current);
  }
  return undefined;
}

function isWithin(node: Node, ancestor: Node, ast: AstReader): boolean {
  let current: Node | undefined = node;
  while (current !== undefined && current !== ancestor) current = ast.parent(current);
  return current === ancestor;
}

function blockEndsLifetime(block: Node, declaration: Node, callable: Node | undefined, ast: AstReader): boolean {
  const statements = ast.statements(block);
  const last = statements[statements.length - 1];
  const kind = last === undefined ? undefined : ast.kindName(last);
  if (kind !== "KindContinueStatement" && kind !== "KindBreakStatement" &&
    kind !== "KindReturnStatement" && kind !== "KindThrowStatement") return false;
  if (last === undefined || (ast.is.IsContinueStatement(last) ? ast.as.AsContinueStatement(last)?.Label :
    ast.is.IsBreakStatement(last) ? ast.as.AsBreakStatement(last)?.Label : undefined) !== undefined) return false;
  let current = ast.parent(block);
  let exitedRegion: Node | undefined;
  while (current !== undefined && current !== callable) {
    const ownerKind = ast.kindName(current);
    if (ast.is.IsTryStatement(current) || isCallableKind(ownerKind)) return false;
    if (exitedRegion === undefined && (ownerKind === "KindForStatement" ||
      ownerKind === "KindForOfStatement" || ownerKind === "KindForInStatement" ||
      ownerKind === "KindWhileStatement" || ownerKind === "KindDoStatement" ||
      kind === "KindBreakStatement" && ownerKind === "KindSwitchStatement")) exitedRegion = current;
    current = ast.parent(current);
  }
  return current === callable && (kind === "KindReturnStatement" || kind === "KindThrowStatement" ||
    exitedRegion !== undefined && isWithin(declaration, exitedRegion, ast));
}

function hasOverlappingArgumentBorrow(
  reference: Node,
  invocations: ReadonlySet<Node>,
  input: { readonly ast: AstReader; readonly mayBorrowArgument: (argument: Node) => boolean },
): boolean {
  let current = reference;
  for (;;) {
    const parent = input.ast.parent(current);
    if (parent === undefined) return false;
    if (isTransparentValueWrapper(parent, current, input.ast)) {
      current = parent;
      continue;
    }
    return invocations.has(parent) && input.mayBorrowArgument(current);
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
  const declarationCallable = declarationLifetimeBlock(declaration, ast);
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
