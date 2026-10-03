import type { RustExpr, RustStmt } from "../nodes.js";
import {
  rustExpressionChildren,
  rustExpressionReferencesPath,
  rustPatternBindsPath,
  rustStatementReferencesPath,
  rustStatementsReferencePath,
} from "./source-usage.js";

type FirstAccess = "read" | "write" | "exit" | "none";

export function firstDirectPathAccessInStatements(
  statements: readonly RustStmt[],
  path: string,
): "read" | "write" | "none" {
  for (const statement of statements) {
    if (statement.kind === "let" && statement.name === path) {
      return statement.init !== undefined && rustExpressionReferencesPath(statement.init, path)
        ? "read"
        : "none";
    }
    if (statement.kind === "assign" && statement.target.kind === "path" &&
      statement.target.path === path) {
      return statement.operator === "=" && !rustExpressionReferencesPath(statement.value, path)
        ? "write"
        : "read";
    }
    if (rustStatementReferencesPath(statement, path)) {
      return "read";
    }
    if (statementAlwaysExits(statement)) {
      return "none";
    }
  }
  return "none";
}

export function statementAlwaysExits(statement: RustStmt): boolean {
  return statement.kind === "return" || statement.kind === "tail" ||
    statement.kind === "throw" || statement.kind === "completion-exit" ||
    statement.kind === "break" || statement.kind === "continue" ||
    statement.kind === "loop" && statement.neverFallsThrough === true ||
    statement.kind === "expr" && rustExpressionAlwaysExits(statement.expr);
}

export function rustExpressionAlwaysExits(expression: RustExpr): boolean {
  const exits = (statements: readonly RustStmt[]): boolean => statements.some(statement =>
    statement.kind === "tail" ? rustExpressionAlwaysExits(statement.expr)
      : statement.kind === "if" ? rustExpressionAlwaysExits(statement.condition) ||
        statement.else !== undefined && exits(statement.then.statements) && exits(statement.else.statements)
      : statement.kind === "scope" || statement.kind === "unsafe-scope" ? exits(statement.body.statements)
      : statementAlwaysExits(statement));
  switch (expression.kind) {
    case "return-expression":
    case "bottom": return true;
    case "closure":
    case "closure-block":
    case "async-block": return false;
    case "block": return exits(expression.body.statements);
    case "conditional": return rustExpressionAlwaysExits(expression.condition) ||
      rustExpressionAlwaysExits(expression.whenTrue) && rustExpressionAlwaysExits(expression.whenFalse);
    case "if-let": return rustExpressionAlwaysExits(expression.expression) ||
      expression.whenFalse !== undefined && rustExpressionAlwaysExits(expression.whenTrue) &&
      rustExpressionAlwaysExits(expression.whenFalse);
    case "match": return rustExpressionAlwaysExits(expression.expression) || expression.arms.length > 0 &&
      expression.arms.every(arm => rustExpressionAlwaysExits(arm.expression));
    case "binary": return rustExpressionAlwaysExits(expression.left) ||
      expression.operator !== "&&" && expression.operator !== "||" && rustExpressionAlwaysExits(expression.right);
    default: return rustExpressionChildren(expression).some(rustExpressionAlwaysExits);
  }
}

export function maxWritesInStatements(
  statements: readonly RustStmt[],
  path: string,
): number {
  let writes = 0;
  for (const statement of statements) {
    writes = cappedWriteCount(writes + maxWritesInStatement(statement, path));
    if (writes === 2 || statement.kind === "let" && statement.name === path) {
      break;
    }
  }
  return writes;
}

export function firstAccessesInStatements(
  statements: readonly RustStmt[],
  path: string,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const statement of statements) {
    outcomes = replaceNone(outcomes, firstAccessesInStatement(statement, path));
    if (!outcomes.has("none")) {
      break;
    }
  }
  return outcomes;
}

export function hasUnobservedFinalPathWrite(
  statements: readonly RustStmt[], path: string, referencedAfter = false,
): boolean {
  const shadowIndex = statements.findIndex(statement => statement.kind === "let" && statement.name === path);
  if (shadowIndex !== -1) {
    const shadow = statements[shadowIndex]!;
    const initializer = shadow.kind === "let" ? shadow.init : undefined;
    return initializer !== undefined && expressionHasUnobservedWrite(initializer, path, referencedAfter) ||
      hasUnobservedFinalPathWrite(statements.slice(0, shadowIndex), path,
        referencedAfter || initializer !== undefined && rustExpressionReferencesPath(initializer, path));
  }
  for (let index = statements.length - 1; index >= 0; index--) {
    const statement = statements[index]!;
    if (statement.kind === "assign" && statement.operator === "=" &&
      statement.target.kind === "path" && statement.target.path === path && !referencedAfter) return true;
    if ((statement.kind === "expr" || statement.kind === "tail" || statement.kind === "return") &&
      statement.expr !== undefined && expressionHasUnobservedWrite(statement.expr, path, referencedAfter)) return true;
    if (statement.kind === "let" && statement.init !== undefined &&
      expressionHasUnobservedWrite(statement.init, path, referencedAfter)) return true;
    if (statement.kind === "if" && (hasUnobservedFinalPathWrite(statement.then.statements, path, referencedAfter) ||
      statement.else !== undefined && hasUnobservedFinalPathWrite(statement.else.statements, path, referencedAfter))) return true;
    if ((statement.kind === "scope" || statement.kind === "unsafe-scope") &&
      hasUnobservedFinalPathWrite(statement.body.statements, path, referencedAfter)) return true;
    referencedAfter ||= rustStatementReferencesPath(statement, path);
  }
  return false;
}

function expressionHasUnobservedWrite(expression: RustExpr, path: string, referencedAfter: boolean): boolean {
  if (expression.kind === "assignment" && expression.operator === "=" &&
    expression.target.kind === "path" && expression.target.path === path && !referencedAfter) return true;
  if (expression.kind === "closure" || expression.kind === "closure-block" || expression.kind === "async-block") return false;
  if (expression.kind === "block") {
    return hasUnobservedFinalPathWrite(expression.body.statements, path, referencedAfter);
  }
  if (expression.kind === "conditional") {
    return expressionHasUnobservedWrite(expression.whenTrue, path, referencedAfter) ||
      expressionHasUnobservedWrite(expression.whenFalse, path, referencedAfter) ||
      expressionHasUnobservedWrite(expression.condition, path, referencedAfter ||
        rustExpressionReferencesPath(expression.whenTrue, path) || rustExpressionReferencesPath(expression.whenFalse, path));
  }
  if (expression.kind === "if-let") {
    const shadowed = rustPatternBindsPath(expression.pattern, path);
    return !shadowed && expressionHasUnobservedWrite(expression.whenTrue, path, referencedAfter) ||
      expression.whenFalse !== undefined && expressionHasUnobservedWrite(expression.whenFalse, path, referencedAfter) ||
      expressionHasUnobservedWrite(expression.expression, path, referencedAfter ||
        !shadowed && rustExpressionReferencesPath(expression.whenTrue, path) ||
        expression.whenFalse !== undefined && rustExpressionReferencesPath(expression.whenFalse, path));
  }
  if (expression.kind === "match") {
    return expression.arms.some(arm => expressionHasUnobservedWrite(arm.expression, path, referencedAfter)) ||
      expressionHasUnobservedWrite(expression.expression, path,
        referencedAfter || expression.arms.some(arm => rustExpressionReferencesPath(arm.expression, path)));
  }
  const children = rustExpressionChildren(expression);
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]!;
    if (expressionHasUnobservedWrite(child, path, referencedAfter)) return true;
    referencedAfter ||= rustExpressionReferencesPath(child, path);
  }
  return false;
}

function maxWritesInStatement(statement: RustStmt, path: string): number {
  switch (statement.kind) {
    case "item":
      return 0;
    case "let":
      return statement.init === undefined ? 0 : maxWritesInExpression(statement.init, path);
    case "expr":
    case "tail":
      return maxWritesInExpression(statement.expr, path);
    case "assign":
      return maxWritesInAssignment(statement.target, statement.operator, statement.value, path);
    case "return":
      return statement.expr === undefined ? 0 : maxWritesInExpression(statement.expr, path);
    case "if":
      return cappedWriteCount(
        maxWritesInExpression(statement.condition, path) +
          Math.max(
            maxWritesInStatements(statement.then.statements, path),
            statement.else === undefined
              ? 0
              : maxWritesInStatements(statement.else.statements, path),
          ),
      );
    case "loop":
      return maxWritesInStatements(statement.body.statements, path) === 0 ? 0 : 2;
    case "while":
      return cappedWriteCount(
        maxWritesInExpression(statement.condition, path) +
          (maxWritesInStatements(statement.body.statements, path) === 0 ? 0 : 2),
      );
    case "while-let-some":
      return cappedWriteCount(
        maxWritesInExpression(statement.expression, path) +
          (statement.binding === path ||
              maxWritesInStatements(statement.body.statements, path) === 0
            ? 0
            : 2),
      );
    case "for":
      return cappedWriteCount(
        maxWritesInExpression(statement.iterable, path) +
          (statement.binding === path ||
              maxWritesInStatements(statement.body.statements, path) === 0
            ? 0
            : 2),
      );

    case "break":
    case "continue":
      return 0;
    case "completion-exit":
      return statement.expr === undefined ? 0 : maxWritesInExpression(statement.expr, path);
    case "resource-scope":
      return cappedWriteCount(
        maxWritesInStatements(statement.body.statements, path) +
          maxWritesInStatements(statement.cleanup.statements, path) +
          maxDispatchPreludeWrites(statement.dispatchTargets, path),
      );
    case "index-assign":
      return cappedWriteCount(
        (statement.receiver.kind === "path" && statement.receiver.path === path ? 2 : 0) +
          maxWritesInExpression(statement.receiver, path) +
          maxWritesInExpression(statement.index, path) +
          maxWritesInExpression(statement.value, path),
      );
    case "scope":
    case "unsafe-scope":
      return maxWritesInStatements(statement.body.statements, path);
    case "throw":
      return maxWritesInExpression(statement.error, path);
    case "try-scope":
      return cappedWriteCount(
        maxWritesInStatements(statement.body.statements, path) +
          (statement.catchClause === undefined || statement.catchClause.binding === path
            ? 0
            : maxWritesInStatements(statement.catchClause.body.statements, path)) +
          (statement.finallyClause === undefined
            ? 0
            : maxWritesInStatements(statement.finallyClause.body.statements, path)) +
          maxDispatchPreludeWrites(statement.dispatchTargets, path),
      );
  }
}

function maxDispatchPreludeWrites(
  targets: readonly { readonly continuePrelude?: readonly RustStmt[] }[],
  path: string,
): number {
  return Math.max(0, ...targets.map((target) =>
    target.continuePrelude === undefined
      ? 0
      : maxWritesInStatements(target.continuePrelude, path)));
}

function maxWritesInAssignment(
  target: RustExpr,
  operator: string,
  value: RustExpr,
  path: string,
): number {
  const valueWrites = maxWritesInExpression(value, path);
  if (target.kind === "path" && target.path === path) {
    return operator === "=" ? cappedWriteCount(valueWrites + 1) : 2;
  }
  return cappedWriteCount(
    (rustPlaceIsRootedAtPath(target, path) ? 1 : maxWritesInExpression(target, path)) +
      valueWrites,
  );
}

function maxWritesInExpression(expression: RustExpr, path: string): number {
  if (expression.kind === "assignment") {
    return maxWritesInAssignment(expression.target, expression.operator, expression.value, path);
  }
  if (expression.kind === "conditional") {
    return cappedWriteCount(
      maxWritesInExpression(expression.condition, path) +
        Math.max(
          maxWritesInExpression(expression.whenTrue, path),
          maxWritesInExpression(expression.whenFalse, path),
        ),
    );
  }
  if (expression.kind === "if-let") return cappedWriteCount(maxWritesInExpression(expression.expression, path) +
    Math.max(rustPatternBindsPath(expression.pattern, path) ? 0 : maxWritesInExpression(expression.whenTrue, path),
      expression.whenFalse === undefined ? 0 : maxWritesInExpression(expression.whenFalse, path)));
  if (expression.kind === "match") {
    return cappedWriteCount(
      maxWritesInExpression(expression.expression, path) +
        Math.max(0, ...expression.arms.map((arm) =>
          maxWritesInExpression(arm.expression, path))),
    );
  }
  if (expression.kind === "closure") {
    return expression.params.some((parameter) => parameter.name === path) ||
        maxWritesInExpression(expression.body, path) === 0
      ? 0
      : 2;
  }
  if (expression.kind === "closure-block") {
    return expression.params.some((parameter) => parameter.name === path) ||
        maxWritesInStatements(expression.body.statements, path) === 0
      ? 0
      : 2;
  }
  if (expression.kind === "async-block") return maxWritesInStatements(expression.body.statements, path) === 0 ? 0 : 2;
  if (expression.kind === "block") {
    return maxWritesInStatements(expression.body.statements, path);
  }
  if (expression.kind === "reference" && expression.mutable === true &&
    rustPlaceIsRootedAtPath(expression.expr, path)) {
    return 1;
  }
  if (expression.kind === "method-call" && (expression.receiverMode === "mut-ref" || expression.receiverMode === undefined) &&
    rustPlaceIsRootedAtPath(expression.receiver, path)) {
    return cappedWriteCount((expression.receiverMode === undefined ? 2 : 1) + rustExpressionChildren(expression).reduce(
      (writes, child) => cappedWriteCount(writes + maxWritesInExpression(child, path)),
      0,
    ));
  }
  return rustExpressionChildren(expression).reduce(
    (writes, child) => cappedWriteCount(writes + maxWritesInExpression(child, path)),
    0,
  );
}

function rustPlaceIsRootedAtPath(expression: RustExpr, path: string): boolean {
  switch (expression.kind) {
    case "path":
      return expression.path === path;
    case "field":
      return rustPlaceIsRootedAtPath(expression.receiver, path);
    case "index":
      return rustPlaceIsRootedAtPath(expression.receiver, path);
    case "dereference":
      return rustPlaceIsRootedAtPath(expression.pointer, path);
    default:
      return false;
  }
}

function cappedWriteCount(value: number): number {
  return Math.min(value, 2);
}

function firstAccessesInStatement(
  statement: RustStmt,
  path: string,
): ReadonlySet<FirstAccess> {
  switch (statement.kind) {
    case "item":
      return new Set<FirstAccess>(["none"]);
    case "let": {
      const initializer = statement.init === undefined
        ? new Set<FirstAccess>(["none"])
        : firstAccessesInExpression(statement.init, path);
      return statement.name === path
        ? replaceNone(initializer, new Set<FirstAccess>(["exit"]))
        : initializer;
    }
    case "expr":
      return firstAccessesInExpression(statement.expr, path);
    case "assign":
      return firstAccessesInAssignment(
        statement.target,
        statement.operator,
        statement.value,
        path,
      );
    case "return":
      return replaceNone(
        statement.expr === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(statement.expr, path),
        new Set<FirstAccess>(["exit"]),
      );
    case "tail":
      return replaceNone(
        firstAccessesInExpression(statement.expr, path),
        new Set<FirstAccess>(["exit"]),
      );
    case "if":
      return replaceNone(
        firstAccessesInExpression(statement.condition, path),
        unionFirstAccesses(
          firstAccessesInStatements(statement.then.statements, path),
          statement.else === undefined
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.else.statements, path),
        ),
      );
    case "loop":
      return unionFirstAccesses(
        firstAccessesInStatements(statement.body.statements, path),
        new Set<FirstAccess>(["none"]),
      );
    case "while":
      return replaceNone(
        firstAccessesInExpression(statement.condition, path),
        unionFirstAccesses(
          firstAccessesInStatements(statement.body.statements, path),
          new Set<FirstAccess>(["none"]),
        ),
      );
    case "while-let-some":
    case "for": {
      const input = statement.kind === "for" ? statement.iterable : statement.expression;
      return replaceNone(
        firstAccessesInExpression(input, path),
        unionFirstAccesses(
          statement.binding === path
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.body.statements, path),
          new Set<FirstAccess>(["none"]),
        ),
      );
    }

    case "break":
    case "continue":
      return new Set(["exit"]);
    case "completion-exit":
      return replaceNone(
        statement.expr === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(statement.expr, path),
        new Set<FirstAccess>(["exit"]),
      );
    case "resource-scope":
    case "try-scope":
      return conservativeStatementAccess(statement, path);
    case "index-assign":
      return firstAccessesInSequence([
        statement.receiver,
        statement.index,
        statement.value,
      ], path);
    case "scope":
    case "unsafe-scope":
      return firstAccessesInStatements(statement.body.statements, path);
    case "throw":
      return replaceNone(
        firstAccessesInExpression(statement.error, path),
        new Set<FirstAccess>(["exit"]),
      );
  }
}

function firstAccessesInAssignment(
  target: RustExpr,
  operator: string,
  value: RustExpr,
  path: string,
): ReadonlySet<FirstAccess> {
  if (target.kind !== "path" || target.path !== path) {
    return firstAccessesInSequence([target, value], path);
  }
  if (operator !== "=") {
    return new Set(["read"]);
  }
  return replaceNone(
    firstAccessesInExpression(value, path),
    new Set<FirstAccess>(["write"]),
  );
}

function firstAccessesInExpression(
  expression: RustExpr,
  path: string,
): ReadonlySet<FirstAccess> {
  switch (expression.kind) {
    case "path":
      return new Set([expression.path === path ? "read" : "none"]);
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "string-literal":
    case "str-literal":
    case "associated-value":
    case "unreachable":
      return new Set(["none"]);
    case "assignment":
      return firstAccessesInAssignment(
        expression.target,
        expression.operator,
        expression.value,
        path,
      );
    case "conditional":
      return replaceNone(
        firstAccessesInExpression(expression.condition, path),
        unionFirstAccesses(
          firstAccessesInExpression(expression.whenTrue, path),
          firstAccessesInExpression(expression.whenFalse, path),
        ),
      );
    case "if-let":
      return replaceNone(firstAccessesInExpression(expression.expression, path), unionFirstAccesses(
        rustPatternBindsPath(expression.pattern, path) ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(expression.whenTrue, path),
        expression.whenFalse === undefined ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(expression.whenFalse, path)));
    case "match":
      return replaceNone(
        firstAccessesInExpression(expression.expression, path),
        unionFirstAccesses(...expression.arms.map((arm) =>
          firstAccessesInExpression(arm.expression, path))),
      );
    case "binary": {
      const left = firstAccessesInExpression(expression.left, path);
      const right = firstAccessesInExpression(expression.right, path);
      return expression.operator === "&&" || expression.operator === "||"
        ? replaceNone(left, unionFirstAccesses(right, new Set<FirstAccess>(["none"])))
        : replaceNone(left, right);
    }
    case "closure":
      return rustExpressionReferencesPath(expression, path)
        ? new Set(["read"])
        : new Set(["none"]);
    case "closure-block":
      return rustStatementsReferencePath(expression.body.statements, path) &&
          !expression.params.some((parameter) => parameter.name === path)
        ? new Set(["read"])
        : new Set(["none"]);
    case "async-block":
      return rustStatementsReferencePath(expression.body.statements, path)
        ? new Set(["read"]) : new Set(["none"]);
    case "block":
      return firstAccessesInBlockExpression(expression, path);
    case "return-expression":
      return replaceNone(
        expression.expr === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(expression.expr, path),
        new Set<FirstAccess>(["exit"]),
      );
    default:
      return firstAccessesInSequence(rustExpressionChildren(expression), path);
  }
}

function firstAccessesInBlockExpression(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
  path: string,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const statement of expression.body.statements) {
    if (statement.kind === "let" && statement.name === path) {
      return statement.init === undefined ? outcomes : replaceNone(outcomes, firstAccessesInExpression(statement.init, path));
    }
    outcomes = replaceNone(outcomes, statement.kind === "tail"
      ? firstAccessesInExpression(statement.expr, path) : firstAccessesInStatement(statement, path));
    if (!outcomes.has("none")) {
      return outcomes;
    }
  }
  return outcomes;
}

function firstAccessesInSequence(
  expressions: readonly RustExpr[],
  path: string,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const expression of expressions) {
    outcomes = replaceNone(outcomes, firstAccessesInExpression(expression, path));
    if (!outcomes.has("none")) {
      break;
    }
  }
  return outcomes;
}

function replaceNone(
  current: ReadonlySet<FirstAccess>,
  replacement: ReadonlySet<FirstAccess>,
): Set<FirstAccess> {
  const result = new Set<FirstAccess>();
  for (const value of current) {
    if (value === "none") {
      for (const replacementValue of replacement) {
        result.add(replacementValue);
      }
    } else {
      result.add(value);
    }
  }
  return result;
}

function unionFirstAccesses(
  ...values: readonly ReadonlySet<FirstAccess>[]
): Set<FirstAccess> {
  return new Set(values.flatMap((value) => [...value]));
}

function conservativeStatementAccess(
  statement: RustStmt,
  path: string,
): ReadonlySet<FirstAccess> {
  return rustStatementReferencesPath(statement, path)
    ? new Set(["read"])
    : new Set(["none"]);
}
