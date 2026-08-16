import type { RustBlock, RustExpr, RustStmt } from "./nodes.js";
import { rustLintAttributes } from "./lint-policy.js";
import {
  firstAccessesInStatements,
  firstDirectPathAccessInStatements,
  maxWritesInStatements,
  statementAlwaysExits,
} from "./source-dataflow.js";
import {
  rustExpressionReferencesPath,
  rustStatementReferencesPath,
  rustStatementsReferencePath,
} from "./source-usage.js";

export function finalizeRustBlockLiveness(
  block: RustBlock,
  continuation: readonly RustStmt[] = [],
): RustBlock {
  const statements = foldTrivialTerminalBinding(
    combineDirectLateInitializers(block.statements),
  );
  return {
    ...block,
    statements: statements.map((statement, index) => {
      const following = [...statements.slice(index + 1), ...continuation];
      return finalizeRustStatementLiveness(
        finalizeRustNestedStatementLiveness(statement, following),
        following,
      );
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
    terminal.expr?.kind !== "path" || terminal.expr.path !== binding.name) {
    return statements;
  }
  return [
    ...statements.slice(0, bindingIndex),
    { ...terminal, expr: binding.init },
  ];
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
    if (firstDirectPathAccessInStatements(following, statement.target.path) !== "write") {
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
  if (statement?.kind !== "assign" ||
    statement.operator !== "=" ||
    statement.target.kind !== "path" ||
    statement.target.path !== path ||
    rustExpressionReferencesPath(statement.value, path)) {
    return undefined;
  }
  const declarations = block.statements.slice(0, -1);
  if (!declarations.every((candidate) => isBranchBindingDeclaration(candidate, path))) {
    return undefined;
  }
  if (declarations.length === 0) {
    return statement.value;
  }
  return {
    kind: "block",
    bindings: declarations.map((declaration) => ({
      name: declaration.name,
      value: declaration.init,
      ...(declaration.type === undefined ? {} : { type: declaration.type }),
    })),
    value: statement.value,
  };
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
  attrs: readonly string[] | undefined,
  attribute: string,
): readonly string[] {
  return attrs?.includes(attribute) === true
    ? attrs
    : [...attrs ?? [], attribute];
}
