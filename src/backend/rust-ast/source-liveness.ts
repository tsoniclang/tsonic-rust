import type { RustBlock, RustExpr, RustStmt } from "./nodes.js";

type FirstAccess = "read" | "write" | "exit" | "none";

const unusedAssignmentsAttribute = "#[allow(unused_assignments)]";
const unusedAssignmentsInnerAttribute = "#![allow(unused_assignments)]";
const unusedVariablesAttribute = "#[allow(unused_variables)]";

export function finalizeRustBlockLiveness(
  block: RustBlock,
  continuation: readonly RustStmt[] = [],
): RustBlock {
  return {
    ...block,
    statements: block.statements.map((statement, index) => {
      const following = [...block.statements.slice(index + 1), ...continuation];
      return finalizeRustStatementLiveness(
        finalizeRustNestedStatementLiveness(statement, following),
        following,
      );
    }),
  };
}

function finalizeRustNestedStatementLiveness(
  statement: RustStmt,
  following: readonly RustStmt[],
): RustStmt {
  switch (statement.kind) {
    case "if":
      return {
        ...statement,
        then: finalizeRustBlockLiveness(statement.then, following),
        ...(statement.else === undefined
          ? {}
          : { else: finalizeRustBlockLiveness(statement.else, following) }),
      };
    case "if-let-some":
      return { ...statement, body: finalizeRustBlockLiveness(statement.body, following) };
    case "scope":
    case "unsafe-scope":
      return { ...statement, body: finalizeRustBlockLiveness(statement.body, following) };
    case "loop":
    case "while":
    case "while-let-some":
    case "for":
      return { ...statement, body: finalizeRustBlockLiveness(statement.body) };
    case "resource-scope":
      return {
        ...statement,
        body: finalizeRustBlockLiveness(statement.body),
        cleanup: finalizeRustBlockLiveness(statement.cleanup),
      };
    case "try-scope":
      return {
        ...statement,
        body: finalizeRustBlockLiveness(statement.body),
        ...(statement.catchClause === undefined
          ? {}
          : {
              catchClause: {
                ...statement.catchClause,
                body: finalizeRustBlockLiveness(statement.catchClause.body),
              },
            }),
        ...(statement.finallyClause === undefined
          ? {}
          : {
              finallyClause: {
                ...statement.finallyClause,
                body: finalizeRustBlockLiveness(statement.finallyClause.body),
              },
            }),
      };
    case "let":
    case "expr":
    case "assign":
    case "return":
    case "tail":
    case "break":
    case "continue":
    case "completion-exit":
    case "index-assign":
    case "throw":
      return statement;
  }
}

function finalizeRustStatementLiveness(
  statement: RustStmt,
  following: readonly RustStmt[],
): RustStmt {
  if (statement.kind === "let") {
    if (statement.name === "_" || statement.name.startsWith("_")) {
      return statement;
    }
    let attrs = statement.attrs;
    if (!rustStatementsReferencePath(following, statement.name)) {
      attrs = appendRustAttribute(attrs, unusedVariablesAttribute);
    } else if (statement.mutable && statement.init !== undefined &&
      !firstAccessesInStatements(following, statement.name).has("read")) {
      attrs = appendRustAttribute(attrs, unusedAssignmentsAttribute);
    }
    return attrs === statement.attrs ? statement : { ...statement, attrs };
  }
  if (statement.kind === "assign" && statement.operator === "=" &&
    statement.target.kind === "path") {
    const nextAccesses = firstAccessesInStatements(following, statement.target.path);
    if (nextAccesses.has("read") || nextAccesses.has("none")) {
      return statement;
    }
    return {
      kind: "scope",
      body: {
        innerAttrs: [unusedAssignmentsInnerAttribute],
        statements: [statement],
      },
    };
  }
  return statement;
}

function firstAccessesInStatements(
  statements: readonly RustStmt[],
  path: string,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const statement of statements) {
    outcomes = continueFirstAccesses(outcomes, firstAccessesInStatement(statement, path));
    if (!outcomes.has("none")) {
      break;
    }
  }
  return outcomes;
}

function firstAccessesInStatement(
  statement: RustStmt,
  path: string,
): ReadonlySet<FirstAccess> {
  switch (statement.kind) {
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
    case "if": {
      const condition = firstAccessesInExpression(statement.condition, path);
      return replaceNone(condition, unionFirstAccesses(
        firstAccessesInStatements(statement.then.statements, path),
        statement.else === undefined
          ? new Set<FirstAccess>(["none"])
          : firstAccessesInStatements(statement.else.statements, path),
      ));
    }
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
      return replaceNone(
        firstAccessesInExpression(statement.expression, path),
        unionFirstAccesses(
          statement.binding === path
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.body.statements, path),
          new Set<FirstAccess>(["none"]),
        ),
      );
    case "for":
      return replaceNone(
        firstAccessesInExpression(statement.iterable, path),
        unionFirstAccesses(
          statement.binding === path
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.body.statements, path),
          new Set<FirstAccess>(["none"]),
        ),
      );
    case "if-let-some":
      return replaceNone(
        firstAccessesInExpression(statement.expression, path),
        unionFirstAccesses(
          statement.binding === path
            ? new Set<FirstAccess>(["none"])
            : firstAccessesInStatements(statement.body.statements, path),
          new Set<FirstAccess>(["none"]),
        ),
      );
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
    case "try-scope":
      return conservativeStatementAccess(statement, path);
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
      return firstAccessesInAssignment(expression.target, expression.operator, expression.value, path);
    case "conditional":
      return replaceNone(
        firstAccessesInExpression(expression.condition, path),
        unionFirstAccesses(
          firstAccessesInExpression(expression.whenTrue, path),
          firstAccessesInExpression(expression.whenFalse, path),
        ),
      );
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
      return rustExpressionReferencesPath(expression.body, path)
        ? new Set(["read"])
        : new Set(["none"]);
    case "closure-block":
      return rustStatementsReferencePath(expression.body.statements, path)
        ? new Set(["read"])
        : new Set(["none"]);
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

function firstAccessesInSequence(
  expressions: readonly RustExpr[],
  path: string,
): ReadonlySet<FirstAccess> {
  let outcomes = new Set<FirstAccess>(["none"]);
  for (const expression of expressions) {
    outcomes = continueFirstAccesses(outcomes, firstAccessesInExpression(expression, path));
    if (!outcomes.has("none")) {
      break;
    }
  }
  return outcomes;
}

function continueFirstAccesses(
  current: ReadonlySet<FirstAccess>,
  next: ReadonlySet<FirstAccess>,
): Set<FirstAccess> {
  return replaceNone(current, next);
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

function rustStatementsReferencePath(
  statements: readonly RustStmt[],
  path: string,
): boolean {
  return statements.some((statement) => rustStatementReferencesPath(statement, path));
}

function rustStatementReferencesPath(statement: RustStmt, path: string): boolean {
  switch (statement.kind) {
    case "let":
      return statement.init !== undefined && rustExpressionReferencesPath(statement.init, path);
    case "expr":
    case "tail":
      return rustExpressionReferencesPath(statement.expr, path);
    case "assign":
      return rustExpressionReferencesPath(statement.target, path) ||
        rustExpressionReferencesPath(statement.value, path);
    case "return":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path);
    case "if":
      return rustExpressionReferencesPath(statement.condition, path) ||
        rustStatementsReferencePath(statement.then.statements, path) ||
        (statement.else !== undefined && rustStatementsReferencePath(statement.else.statements, path));
    case "loop":
      return rustStatementsReferencePath(statement.body.statements, path);
    case "while":
      return rustExpressionReferencesPath(statement.condition, path) ||
        rustStatementsReferencePath(statement.body.statements, path);
    case "while-let-some":
    case "if-let-some":
      return rustExpressionReferencesPath(statement.expression, path) ||
        rustStatementsReferencePath(statement.body.statements, path);
    case "for":
      return rustExpressionReferencesPath(statement.iterable, path) ||
        rustStatementsReferencePath(statement.body.statements, path);
    case "break":
    case "continue":
      return false;
    case "completion-exit":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path);
    case "resource-scope":
      return rustStatementsReferencePath(statement.body.statements, path) ||
        rustStatementsReferencePath(statement.cleanup.statements, path);
    case "index-assign":
      return [statement.receiver, statement.index, statement.value]
        .some((expression) => rustExpressionReferencesPath(expression, path));
    case "scope":
    case "unsafe-scope":
      return rustStatementsReferencePath(statement.body.statements, path);
    case "throw":
      return rustExpressionReferencesPath(statement.error, path);
    case "try-scope":
      return rustStatementsReferencePath(statement.body.statements, path) ||
        (statement.catchClause !== undefined &&
          rustStatementsReferencePath(statement.catchClause.body.statements, path)) ||
        (statement.finallyClause !== undefined &&
          rustStatementsReferencePath(statement.finallyClause.body.statements, path));
  }
}

function rustExpressionReferencesPath(expression: RustExpr, path: string): boolean {
  return expression.kind === "path" && expression.path === path ||
    rustExpressionChildren(expression).some((child) => rustExpressionReferencesPath(child, path)) ||
    expression.kind === "closure-block" &&
      rustStatementsReferencePath(expression.body.statements, path);
}

function rustExpressionChildren(expression: RustExpr): readonly RustExpr[] {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "string-literal":
    case "str-literal":
    case "path":
    case "associated-value":
    case "unreachable":
    case "closure-block":
      return [];
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return [expression.expression];
    case "unary":
      return [expression.operand];
    case "dereference":
      return [expression.pointer];
    case "binary":
      return [expression.left, expression.right];
    case "range":
      return [expression.start, expression.end];
    case "conditional":
      return [expression.condition, expression.whenTrue, expression.whenFalse];
    case "match":
      return [expression.expression, ...expression.arms.map((arm) => arm.expression)];
    case "matches":
      return [expression.expression];
    case "assignment":
      return [expression.target, expression.value];
    case "call":
    case "associated-call":
      return expression.args;
    case "invoke":
      return [expression.callee, ...expression.args];
    case "method-call":
      return [expression.receiver, ...expression.args];
    case "field":
      return [expression.receiver];
    case "index":
      return [expression.receiver, expression.index];
    case "block":
      return [...expression.bindings.map((binding) => binding.value), expression.value];
    case "evaluate-then":
      return [expression.effect, expression.value];
    case "string-concat":
      return expression.parts;
    case "format-write":
      return [expression.writer, ...expression.args];
    case "reference":
      return [expression.expr];
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements;
    case "closure":
      return [expression.body];
    case "await":
    case "try":
      return [expression.expr];
    case "return-expression":
      return expression.expr === undefined ? [] : [expression.expr];
    case "struct-literal":
      return expression.fields.map((field) => field.value);
  }
}

function appendRustAttribute(
  attrs: readonly string[] | undefined,
  attribute: string,
): readonly string[] {
  return attrs?.includes(attribute) === true
    ? attrs
    : [...attrs ?? [], attribute];
}
