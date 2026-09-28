import type { RustExpr, RustStmt } from "../nodes.js";
import { rustParametersBindName, rustPatternBindsName } from "../patterns.js";
import {
  rustExpressionReferencesPath,
  rustStatementReferencesPath,
} from "./source-usage.js";
import { rustExpressionChildren } from "./expression-children.js";

type FirstAccess = "read" | "write" | "exit" | "none";

export function firstDirectPathAccessInStatements(
  statements: readonly RustStmt[],
  path: string,
  visible = true,
): "read" | "write" | "none" {
  for (const statement of statements) {
    if (visible && statement.kind === "assign" && statement.target.kind === "path" &&
      statement.target.path === path) {
      return statement.operator === "=" && !rustExpressionReferencesPath(statement.value, path, visible)
        ? "write"
        : "read";
    }
    if (rustStatementReferencesPath(statement, path, visible)) {
      return "read";
    }
    if (statementAlwaysExits(statement)) {
      return "none";
    }
    if (statement.kind === "let" && rustPatternBindsName(statement.pattern, path) === true) visible = false;
  }
  return "none";
}

export function statementAlwaysExits(statement: RustStmt): boolean {
  return statement.kind === "return" || statement.kind === "tail" ||
    statement.kind === "throw" || statement.kind === "completion-exit" ||
    statement.kind === "break" || statement.kind === "continue" ||
    statement.kind === "loop" && statement.neverFallsThrough === true;
}

export function maxWritesInStatements(
  statements: readonly RustStmt[],
  path: string,
  visible = true,
): number {
  let writes = 0;
  for (const statement of statements) {
    writes = cappedWriteCount(writes + maxWritesInStatement(statement, path, visible));
    if (writes === 2) break;
    if (statement.kind === "let" && rustPatternBindsName(statement.pattern, path) === true) visible = false;
  }
  return writes;
}

export function firstAccessesInStatements(
  statements: readonly RustStmt[],
  path: string,
  visible = true,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const statement of statements) {
    outcomes = replaceNone(outcomes, firstAccessesInStatement(statement, path, visible));
    if (statement.kind === "let" && rustPatternBindsName(statement.pattern, path) === true) visible = false;
    if (!outcomes.has("none")) {
      break;
    }
  }
  return outcomes;
}

function maxWritesInStatement(statement: RustStmt, path: string, visible: boolean): number {
  switch (statement.kind) {
    case "macro-statement":
      return 2;
    case "item":
      return statement.item.kind === "macro-invocation" ? 2 : 0;
    case "let":
      return rustPatternBindsName(statement.pattern, path) === undefined ? 2 : cappedWriteCount(
        (statement.init === undefined ? 0 : maxWritesInExpression(statement.init, path, visible)) +
        (statement.else === undefined ? 0 : maxWritesInStatements(statement.else.statements, path, visible)),
      );
    case "expr":
    case "tail":
      return maxWritesInExpression(statement.expr, path, visible);
    case "assign":
      return maxWritesInAssignment(statement.target, statement.operator, statement.value, path, visible);
    case "return":
      return statement.expr === undefined ? 0 : maxWritesInExpression(statement.expr, path, visible);
    case "if":
      return cappedWriteCount(
        maxWritesInExpression(statement.condition, path, visible) +
          Math.max(
            maxWritesInStatements(statement.then.statements, path, visible),
            statement.else === undefined
              ? 0
              : maxWritesInStatements(statement.else.statements, path, visible),
          ),
      );
    case "loop":
      return maxWritesInStatements(statement.body.statements, path, visible) === 0 ? 0 : 2;
    case "while":
      return cappedWriteCount(
        maxWritesInExpression(statement.condition, path, visible) +
          (maxWritesInStatements(statement.body.statements, path, visible) === 0 ? 0 : 2),
      );
    case "while-let":
      return cappedWriteCount(
        maxWritesInExpression(statement.expression, path, visible) +
          (patternBodyWrites(statement, path, visible) === 0 ? 0 : 2),
      );
    case "for":
      return cappedWriteCount(
        maxWritesInExpression(statement.iterable, path, visible) +
          (patternBodyWrites(statement, path, visible) === 0 ? 0 : 2),
      );
    case "if-let":
      return cappedWriteCount(
        maxWritesInExpression(statement.expression, path, visible) +
          Math.max(
            patternBodyWrites(statement, path, visible),
            statement.else === undefined
              ? 0
              : maxWritesInStatements(statement.else.statements, path, visible),
          ),
      );
    case "break":
    case "continue":
      return 0;
    case "completion-exit":
      return statement.expr === undefined ? 0 : maxWritesInExpression(statement.expr, path, visible);
    case "resource-scope":
      return cappedWriteCount(
        maxWritesInStatements(statement.body.statements, path, visible) +
          maxWritesInStatements(statement.cleanup.statements, path, visible) +
          maxDispatchPreludeWrites(statement.dispatchTargets, path, visible),
      );
    case "index-assign":
      return cappedWriteCount(
        (visible && statement.receiver.kind === "path" && statement.receiver.path === path ? 2 : 0) +
          maxWritesInExpression(statement.receiver, path, visible) +
          maxWritesInExpression(statement.index, path, visible) +
          maxWritesInExpression(statement.value, path, visible),
      );
    case "scope":
    case "unsafe-scope":
      return maxWritesInStatements(statement.body.statements, path, visible);
    case "throw":
      return maxWritesInExpression(statement.error, path, visible);
    case "try-scope":
      return cappedWriteCount(
        maxWritesInStatements(statement.body.statements, path, visible) +
          (statement.catchClause === undefined ? 0
            : maxWritesInStatements(statement.catchClause.body.statements, path, visible && statement.catchClause.binding !== path)) +
          (statement.finallyClause === undefined
            ? 0
            : maxWritesInStatements(statement.finallyClause.body.statements, path, visible)) +
          maxDispatchPreludeWrites(statement.dispatchTargets, path, visible),
      );
  }
}

function patternBodyWrites(statement: Extract<RustStmt, { kind: "for" | "if-let" | "while-let" }>, path: string, visible: boolean): number {
  const bound = rustPatternBindsName(statement.pattern, path);
  return bound === undefined ? 2 : maxWritesInStatements(statement.body.statements, path, visible && !bound);
}

function maxDispatchPreludeWrites(
  targets: readonly { readonly continuePrelude?: readonly RustStmt[] }[],
  path: string,
  visible: boolean,
): number {
  return Math.max(0, ...targets.map((target) =>
    target.continuePrelude === undefined
      ? 0
      : maxWritesInStatements(target.continuePrelude, path, visible)));
}

function maxWritesInAssignment(
  target: RustExpr,
  operator: string,
  value: RustExpr,
  path: string,
  visible: boolean,
): number {
  const valueWrites = maxWritesInExpression(value, path, visible);
  if (visible && target.kind === "path" && target.path === path) {
    return operator === "=" ? cappedWriteCount(valueWrites + 1) : 2;
  }
  return cappedWriteCount(
    (rustPlaceIsRootedAtPath(target, path, visible) ? 1 : maxWritesInExpression(target, path, visible)) +
      valueWrites,
  );
}

function maxWritesInExpression(expression: RustExpr, path: string, visible: boolean): number {
  if (expression.kind === "macro-invocation") return 2;
  if (expression.kind === "matches" && rustPatternBindsName(expression.pattern, path) === undefined) return 2;
  if (expression.kind === "assignment") {
    return maxWritesInAssignment(expression.target, expression.operator, expression.value, path, visible);
  }
  if (expression.kind === "conditional") {
    return cappedWriteCount(
      maxWritesInExpression(expression.condition, path, visible) +
        Math.max(
          maxWritesInExpression(expression.whenTrue, path, visible),
          maxWritesInExpression(expression.whenFalse, path, visible),
        ),
    );
  }
  if (expression.kind === "match") {
    return cappedWriteCount(
      maxWritesInExpression(expression.expression, path, visible) +
        Math.max(0, ...expression.arms.map((arm) => {
          const bound = rustPatternBindsName(arm.pattern, path);
          return bound === undefined ? 2 : maxWritesInExpression(arm.expression, path, visible && !bound);
        })),
    );
  }
  if (expression.kind === "closure") {
    const bound = rustParametersBindName(expression.params, path);
    if (bound === undefined) return 2;
    return maxWritesInExpression(expression.body, path, visible && !bound) === 0 ? 0 : 2;
  }
  if (expression.kind === "closure-block") {
    const bound = rustParametersBindName(expression.params, path);
    if (bound === undefined) return 2;
    return maxWritesInStatements(expression.body.statements, path, visible && !bound) === 0 ? 0 : 2;
  }
  if (expression.kind === "block") {
    let writes = 0;
    for (const binding of expression.bindings) {
      writes = cappedWriteCount(writes + (binding.value === undefined ? 0 : maxWritesInExpression(binding.value, path, visible)));
      if (writes === 2) return writes;
      if (binding.name === path) visible = false;
    }
    return cappedWriteCount(writes + maxWritesInExpression(expression.value, path, visible));
  }
  if (expression.kind === "reference" && expression.mutable === true &&
    rustPlaceIsRootedAtPath(expression.expr, path, visible)) {
    return 1;
  }
  if (expression.kind === "method-call" && expression.receiverMode === "mut-ref" &&
    rustPlaceIsRootedAtPath(expression.receiver, path, visible)) {
    return cappedWriteCount(1 + rustExpressionChildren(expression).reduce(
      (writes, child) => cappedWriteCount(writes + maxWritesInExpression(child, path, visible)),
      0,
    ));
  }
  return rustExpressionChildren(expression).reduce(
    (writes, child) => cappedWriteCount(writes + maxWritesInExpression(child, path, visible)),
    0,
  );
}

function rustPlaceIsRootedAtPath(expression: RustExpr, path: string, visible: boolean): boolean {
  if (!visible) return false;
  switch (expression.kind) {
    case "path":
      return expression.path === path;
    case "field":
      return rustPlaceIsRootedAtPath(expression.receiver, path, visible);
    case "index":
      return rustPlaceIsRootedAtPath(expression.receiver, path, visible);
    case "dereference":
      return rustPlaceIsRootedAtPath(expression.pointer, path, visible);
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
  visible: boolean,
): ReadonlySet<FirstAccess> {
  switch (statement.kind) {
    case "macro-statement":
      return new Set<FirstAccess>(["none", "read", "write", "exit"]);
    case "item":
      return statement.item.kind === "macro-invocation"
        ? new Set<FirstAccess>(["none", "read", "write", "exit"]) : new Set<FirstAccess>(["none"]);
    case "let": {
      const bound = rustPatternBindsName(statement.pattern, path);
      if (bound === undefined) return new Set<FirstAccess>(["none", "read", "write", "exit"]);
      const initializer = statement.init === undefined
        ? new Set<FirstAccess>(["none"])
        : firstAccessesInExpression(statement.init, path, visible);
      const success = new Set<FirstAccess>(["none"]);
      const outcomes = statement.else === undefined ? success : unionFirstAccesses(success,
        replaceNone(firstAccessesInStatements(statement.else.statements, path, visible), new Set<FirstAccess>(["exit"])));
      return replaceNone(initializer, outcomes);
    }
    case "expr":
      return firstAccessesInExpression(statement.expr, path, visible);
    case "assign":
      return firstAccessesInAssignment(
        statement.target,
        statement.operator,
        statement.value,
        path,
        visible,
      );
    case "return":
      return replaceNone(
        statement.expr === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(statement.expr, path, visible),
        new Set<FirstAccess>(["exit"]),
      );
    case "tail":
      return replaceNone(
        firstAccessesInExpression(statement.expr, path, visible),
        new Set<FirstAccess>(["exit"]),
      );
    case "if":
      return replaceNone(
        firstAccessesInExpression(statement.condition, path, visible),
        unionFirstAccesses(
          firstAccessesInStatements(statement.then.statements, path, visible),
          statement.else === undefined
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.else.statements, path, visible),
        ),
      );
    case "loop":
      return unionFirstAccesses(
        firstAccessesInStatements(statement.body.statements, path, visible),
        new Set<FirstAccess>(["none"]),
      );
    case "while":
      return replaceNone(
        firstAccessesInExpression(statement.condition, path, visible),
        unionFirstAccesses(
          firstAccessesInStatements(statement.body.statements, path, visible),
          new Set<FirstAccess>(["none"]),
        ),
      );
    case "while-let":
    case "for": {
      const input = statement.kind === "for" ? statement.iterable : statement.expression;
      return replaceNone(
        firstAccessesInExpression(input, path, visible),
        unionFirstAccesses(
          patternBodyAccesses(statement, path, visible),
          new Set<FirstAccess>(["none"]),
        ),
      );
    }
    case "if-let":
      return replaceNone(
        firstAccessesInExpression(statement.expression, path, visible),
        unionFirstAccesses(
          patternBodyAccesses(statement, path, visible),
          statement.else === undefined
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.else.statements, path, visible),
        ),
      );
    case "break":
    case "continue":
      return new Set(["exit"]);
    case "completion-exit":
      return replaceNone(
        statement.expr === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(statement.expr, path, visible),
        new Set<FirstAccess>(["exit"]),
      );
    case "resource-scope":
    case "try-scope":
      return conservativeStatementAccess(statement, path, visible);
    case "index-assign":
      return firstAccessesInSequence([
        statement.receiver,
        statement.index,
        statement.value,
      ], path, visible);
    case "scope":
    case "unsafe-scope":
      return firstAccessesInStatements(statement.body.statements, path, visible);
    case "throw":
      return replaceNone(
        firstAccessesInExpression(statement.error, path, visible),
        new Set<FirstAccess>(["exit"]),
      );
  }
}

function patternBodyAccesses(statement: Extract<RustStmt, { kind: "for" | "if-let" | "while-let" }>, path: string, visible: boolean): ReadonlySet<FirstAccess> {
  const bound = rustPatternBindsName(statement.pattern, path);
  return bound === undefined ? new Set<FirstAccess>(["none", "read", "write", "exit"])
    : firstAccessesInStatements(statement.body.statements, path, visible && !bound);
}

function firstAccessesInAssignment(
  target: RustExpr,
  operator: string,
  value: RustExpr,
  path: string,
  visible: boolean,
): ReadonlySet<FirstAccess> {
  if (!visible || target.kind !== "path" || target.path !== path) {
    return firstAccessesInSequence([target, value], path, visible);
  }
  if (operator !== "=") {
    return new Set(["read"]);
  }
  return replaceNone(
    firstAccessesInExpression(value, path, visible),
    new Set<FirstAccess>(["write"]),
  );
}

function firstAccessesInExpression(
  expression: RustExpr,
  path: string,
  visible: boolean,
): ReadonlySet<FirstAccess> {
  switch (expression.kind) {
    case "macro-invocation":
      return new Set<FirstAccess>(["none", "read", "write", "exit"]);
    case "matches":
      return rustPatternBindsName(expression.pattern, path) === undefined
        ? new Set<FirstAccess>(["none", "read", "write", "exit"])
        : firstAccessesInExpression(expression.expression, path, visible);
    case "path":
      return new Set([visible && expression.path === path ? "read" : "none"]);
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
      visible,
      );
    case "conditional":
      return replaceNone(
        firstAccessesInExpression(expression.condition, path, visible),
        unionFirstAccesses(
          firstAccessesInExpression(expression.whenTrue, path, visible),
          firstAccessesInExpression(expression.whenFalse, path, visible),
        ),
      );
    case "match":
      return replaceNone(
        firstAccessesInExpression(expression.expression, path, visible),
        unionFirstAccesses(...expression.arms.map((arm) => {
          const bound = rustPatternBindsName(arm.pattern, path);
          return bound === undefined ? new Set<FirstAccess>(["none", "read", "write", "exit"])
            : firstAccessesInExpression(arm.expression, path, visible && !bound);
        })),
      );
    case "binary": {
      const left = firstAccessesInExpression(expression.left, path, visible);
      const right = firstAccessesInExpression(expression.right, path, visible);
      return expression.operator === "&&" || expression.operator === "||"
        ? replaceNone(left, unionFirstAccesses(right, new Set<FirstAccess>(["none"])))
        : replaceNone(left, right);
    }
    case "closure":
      return rustExpressionReferencesPath(expression, path, visible)
        ? new Set(["read"])
        : new Set(["none"]);
    case "closure-block":
      return rustExpressionReferencesPath(expression, path, visible)
        ? new Set(["read"])
        : new Set(["none"]);
    case "block":
      return firstAccessesInBlockExpression(expression, path, visible);
    case "return-expression":
      return replaceNone(
        expression.expr === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInExpression(expression.expr, path, visible),
        new Set<FirstAccess>(["exit"]),
      );
    default:
      return firstAccessesInSequence(rustExpressionChildren(expression), path, visible);
  }
}

function firstAccessesInBlockExpression(
  expression: Extract<RustExpr, { readonly kind: "block" }>,
  path: string,
  visible: boolean,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const binding of expression.bindings) {
    if (binding.value !== undefined) {
      outcomes = replaceNone(outcomes, firstAccessesInExpression(binding.value, path, visible));
    }
    if (!outcomes.has("none")) return outcomes;
    if (binding.name === path) visible = false;
  }
  return replaceNone(outcomes, firstAccessesInExpression(expression.value, path, visible));
}

function firstAccessesInSequence(
  expressions: readonly RustExpr[],
  path: string,
  visible: boolean,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const expression of expressions) {
    outcomes = replaceNone(outcomes, firstAccessesInExpression(expression, path, visible));
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
  visible: boolean,
): ReadonlySet<FirstAccess> {
  return rustStatementReferencesPath(statement, path, visible)
    ? new Set(["read"])
    : new Set(["none"]);
}
