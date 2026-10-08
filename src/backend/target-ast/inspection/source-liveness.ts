import { rustValueBlock } from "../value-block.js";
import { type RustAttribute } from "../attributes.js";
import type { RustBlock, RustExpr, RustStmt } from "../nodes.js";
import { mapRustExpressionChildren } from "../expression-children.js";
import { rustLintAttributes } from "../normalization/lint-policy.js";
import {
  firstAccessesInStatements,
  firstDirectPathAccessInStatements,
  maxWritesInStatements,
  statementAlwaysExits,
} from "./source-dataflow.js";
import {
  rustExpressionReferencesPath,
  rustExpressionChildren,
  rustStatementReferencesPath,
  rustStatementsReferencePath,
} from "./source-usage.js";

export function finalizeRustBlockLiveness(
  block: RustBlock,
  continuation: readonly RustStmt[] = [],
  inheritedLocals: ReadonlySet<string> = new Set(),
): RustBlock {
  const statements = foldTrivialTerminalBinding(
    combineDirectLateInitializers(block.statements),
  );
  const locals = new Set(inheritedLocals);
  return {
    ...block,
    statements: statements.map((statement, index) => {
      const following = [...statements.slice(index + 1), ...continuation];
      const result = finalizeRustStatementLiveness(
        finalizeRustNestedStatementLiveness(statement, following, locals),
        following,
        locals,
      );
      if (statement.kind === "let") locals.add(statement.name);
      return result;
    }),
  };
}

function foldTrivialTerminalBinding(
  statements: readonly RustStmt[],
): readonly RustStmt[] {
  if (statements.length < 2) {
    return statements;
  }
  const bindingIndex = statements.length - 2;
  const binding = statements[bindingIndex];
  const terminal = statements[bindingIndex + 1];
  if (binding?.kind !== "let" || binding.init === undefined || binding.mutable ||
    binding.type !== undefined || (binding.attrs?.length ?? 0) > 0 ||
    terminal === undefined || (terminal.kind !== "tail" && terminal.kind !== "return") ||
    terminal.expr?.kind !== "path" || terminal.expr.path !== binding.name ||
    terminal.kind === "tail" && !stableTerminalInputs(binding.init)) {
    return statements;
  }
  return [
    ...statements.slice(0, bindingIndex),
    { ...terminal, expr: binding.init },
  ];
}

function stableTerminalInputs(expression: RustExpr): boolean {
  if (expression.kind === "block") {
    const last = expression.body.statements[expression.body.statements.length - 1];
    return expression.label === undefined && (expression.body.innerAttrs?.length ?? 0) === 0 &&
      last?.kind === "tail" && (last.attrs?.length ?? 0) === 0 && stableTerminalInputs(last.expr) &&
      expression.body.statements.slice(0, -1).every(statement =>
        (statement.kind === "let" || statement.kind === "expr") && (statement.attrs?.length ?? 0) === 0 &&
        (statement.kind === "let" && !statement.mutable && statement.type === undefined &&
          statement.init !== undefined && stableTerminalInputs(statement.init) ||
          statement.kind === "expr" && stableTerminalInputs(statement.expr)));
  }
  if (expression.kind === "match") return stableTerminalOperand(expression.expression) &&
    expression.arms.every(arm => stableTerminalInputs(arm.expression));
  if (expression.kind === "conditional") return stableTerminalInputs(expression.condition) &&
    stableTerminalInputs(expression.whenTrue) && stableTerminalInputs(expression.whenFalse);
  if (expression.kind === "evaluate-then") return stableTerminalInputs(expression.effect) &&
    stableTerminalInputs(expression.value);
  const deferred = (value: RustExpr): boolean => value.kind === "closure" || value.kind === "closure-block" || value.kind === "async-block";
  if (deferred(expression)) return true;
  if (expression.kind === "call" || expression.kind === "associated-call" || expression.kind === "method-call") {
    return (expression.kind !== "method-call" || stableTerminalOperand(expression.receiver)) &&
      expression.args.every(argument => stableTerminalInputs(argument));
  }
  return rustExpressionChildren(expression).every(stableTerminalOperand);
}

function stableTerminalOperand(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "path":
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "char-literal":
    case "str-literal":
    case "none":
      return true;
    case "field":
    case "reference":
    case "dereference":
      return rustExpressionChildren(expression).every(stableTerminalOperand);
    default:
      return false;
  }
}

function finalizeRustNestedStatementLiveness(
  statement: RustStmt,
  following: readonly RustStmt[],
  locals: ReadonlySet<string>,
): RustStmt {
  const expression = (value: RustExpr, after: readonly RustStmt[] = following): RustExpr => {
    if (value.kind === "closure" || value.kind === "closure-block" || value.kind === "async-block") return value;
    if (value.kind === "block") return { ...value, body: finalizeRustBlockLiveness(value.body, after, locals) };
    const children = rustExpressionChildren(value);
    return mapRustExpressionChildren(value, child => expression(child, [
      ...children.filter(sibling => sibling !== child).map((expr): RustStmt => ({ kind: "expr", expr })), ...after,
    ]), body => finalizeRustBlockLiveness(body, after, locals));
  };
  switch (statement.kind) {
    case "if":
      return {
        ...statement,
        condition: expression(statement.condition),
        then: finalizeRustBlockLiveness(statement.then, following, locals),
        ...(statement.else === undefined
          ? {}
          : { else: finalizeRustBlockLiveness(statement.else, following, locals) }),
      };

    case "scope":
    case "unsafe-scope":
      if (statement.body.innerAttrs?.includes(rustLintAttributes.unusedAssignmentsInner)) return statement;
      return { ...statement, body: finalizeRustBlockLiveness(statement.body, following, locals) };
    case "loop":
    case "while":
    case "while-let-some":
    case "for":
      return { ...statement, body: finalizeRustBlockLiveness(statement.body, [statement, ...following], locals) };
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
    case "let": return statement.init === undefined ? statement : { ...statement, init: expression(statement.init) };
    case "expr":
    case "tail": return { ...statement, expr: expression(statement.expr) };
    case "assign": return { ...statement, target: expression(statement.target), value: expression(statement.value) };
    case "return": return statement.expr === undefined ? statement : { ...statement, expr: expression(statement.expr) };
    case "break":
    case "continue":
    case "completion-exit":
    case "index-assign":
    case "throw":
    case "item":
      return statement;
  }
}

function finalizeRustStatementLiveness(
  statement: RustStmt,
  following: readonly RustStmt[],
  locals: ReadonlySet<string>,
): RustStmt {
  if (statement.kind === "let") {
    const writes = maxWritesInStatements(following, statement.name);
    const mutabilityIsUnnecessary = writes === 0 ||
      statement.init === undefined && writes < 2;
    const normalized = statement.mutable && mutabilityIsUnnecessary
      ? { ...statement, mutable: false }
      : statement;
    if (statement.name === "_" || statement.name.startsWith("_")) {
      return normalized;
    }
    let attrs = normalized.attrs;
    if (!rustStatementsReferencePath(following, statement.name)) {
      attrs = appendRustAttribute(attrs, rustLintAttributes.unusedVariables);
      return { ...normalized, attrs };
    }
    if (normalized.mutable && normalized.init !== undefined &&
      !firstAccessesInStatements(following, statement.name).has("read")) {
      attrs = appendRustAttribute(attrs, rustLintAttributes.unusedAssignments);
    }
    return { ...normalized, attrs };
  }
  if (statement.kind === "assign" && statement.operator === "=" &&
    statement.target.kind === "path") {
    if (firstDirectPathAccessInStatements(following, statement.target.path) !== "write" &&
      !(locals.has(statement.target.path) && !rustStatementsReferencePath(following, statement.target.path))) {
      return statement;
    }
    return {
      kind: "scope",
      body: {
        innerAttrs: [rustLintAttributes.unusedAssignmentsInner],
        statements: [statement],
      },
    };
  }
  return statement;
}

function combineDirectLateInitializers(
  statements: readonly RustStmt[],
): readonly RustStmt[] {
  const replacements = new Map<number, {
    readonly declaration: Extract<RustStmt, { readonly kind: "let" }>;
    readonly initializer: RustExpr;
  }>();
  const combinedDeclarations = new Set<number>();

  for (let declarationIndex = 0; declarationIndex < statements.length; declarationIndex += 1) {
    const declaration = statements[declarationIndex];
    if (declaration === undefined || declaration.kind !== "let" || declaration.init !== undefined) {
      continue;
    }
    for (let assignmentIndex = declarationIndex + 1;
      assignmentIndex < statements.length;
      assignmentIndex += 1) {
      const candidate = statements[assignmentIndex];
      if (candidate === undefined) {
        break;
      }
      if (candidate.kind === "let" && candidate.name === declaration.name) {
        break;
      }
      if (!rustStatementReferencesPath(candidate, declaration.name)) {
        if (statementAlwaysExits(candidate)) {
          break;
        }
        continue;
      }
      if (candidate.kind === "assign" && candidate.operator === "=" &&
        candidate.target.kind === "path" && candidate.target.path === declaration.name &&
        !rustExpressionReferencesPath(candidate.value, declaration.name)) {
        replacements.set(assignmentIndex, {
          declaration,
          initializer: candidate.value,
        });
        combinedDeclarations.add(declarationIndex);
      } else {
        const initializer = conditionalLateInitializer(candidate, declaration.name);
        if (initializer !== undefined) {
          replacements.set(assignmentIndex, { declaration, initializer });
          combinedDeclarations.add(declarationIndex);
        }
      }
      break;
    }
  }

  return statements.flatMap((statement, index): readonly RustStmt[] => {
    if (combinedDeclarations.has(index)) {
      return [];
    }
    const replacement = replacements.get(index);
    if (replacement === undefined) {
      return [statement];
    }
    const following = statements.slice(index + 1);
    return [{
      ...replacement.declaration,
      mutable: maxWritesInStatements(following, replacement.declaration.name) > 0,
      init: replacement.initializer,
      attrs: replacement.declaration.attrs,
    }];
  });
}

function conditionalLateInitializer(
  statement: RustStmt,
  path: string,
): RustExpr | undefined {
  if (statement.kind !== "if" || statement.else === undefined ||
    (statement.attrs?.length ?? 0) > 0 ||
    (statement.then.innerAttrs?.length ?? 0) > 0 ||
    (statement.else.innerAttrs?.length ?? 0) > 0 ||
    rustExpressionReferencesPath(statement.condition, path)) {
    return undefined;
  }
  const whenTrue = branchAssignmentValue(statement.then, path);
  const whenFalse = branchAssignmentValue(statement.else, path);
  return whenTrue === undefined || whenFalse === undefined
    ? undefined
    : {
        kind: "conditional",
        condition: statement.condition,
        whenTrue,
        whenFalse,
      };
}

function branchAssignmentValue(
  block: RustBlock,
  path: string,
): RustExpr | undefined {
  if (block.statements.length === 0) {
    return undefined;
  }
  const statement = block.statements[block.statements.length - 1];
  let value = statement?.kind === "assign" &&
      statement.operator === "=" &&
      statement.target.kind === "path" &&
      statement.target.path === path &&
      !rustExpressionReferencesPath(statement.value, path)
    ? statement.value
    : statement === undefined ? undefined : conditionalLateInitializer(statement, path);
  if (value === undefined) {
    return undefined;
  }
  for (let index = block.statements.length - 2; index >= 0; index -= 1) {
    const setup = block.statements[index];
    if (setup === undefined || rustStatementReferencesPath(setup, path)) {
      return undefined;
    }
    if (isBranchBindingDeclaration(setup, path)) {
      const bindings = [setup];
      while (index > 0) {
        const previous = block.statements[index - 1];
        if (previous === undefined || !isBranchBindingDeclaration(previous, path)) {
          break;
        }
        bindings.unshift(previous);
        index -= 1;
      }
      value = rustValueBlock(bindings.map((declaration) => ({
          name: declaration.name,
          value: declaration.init,
          ...(declaration.type === undefined ? {} : { type: declaration.type }),
        })), value);
    } else if (setup.kind === "assign" || setup.kind === "expr") {
      value = {
        kind: "evaluate-then",
        effect: setup.kind === "expr" ? setup.expr : {
          kind: "assignment",
          target: setup.target,
          operator: setup.operator,
          value: setup.value,
        },
        discard: "unit",
        value,
      };
    } else {
      return undefined;
    }
  }
  return value;
}

function isBranchBindingDeclaration(
  statement: RustStmt,
  targetPath: string,
): statement is Extract<RustStmt, { readonly kind: "let" }> & {
  readonly init: RustExpr;
} {
  return statement.kind === "let" &&
    statement.init !== undefined &&
    statement.mutable !== true &&
    (statement.attrs?.length ?? 0) === 0 &&
    statement.name !== targetPath &&
    !rustExpressionReferencesPath(statement.init, targetPath);
}

function appendRustAttribute(
  attrs: readonly RustAttribute[] | undefined,
  attribute: RustAttribute,
): readonly RustAttribute[] {
  return attrs?.includes(attribute) === true
    ? attrs
    : [...attrs ?? [], attribute];
}
