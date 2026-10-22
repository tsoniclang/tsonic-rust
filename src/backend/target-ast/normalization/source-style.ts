import type { RustBlock, RustExpr, RustImplFunction, RustItem, RustSourceFileModel, RustStmt, RustType } from "../syntax/nodes.js";
import { mapRustExpressionChildren } from "../syntax/expression-children.js";
import { nameRustSignatureTypes, type RustNamedSignatureScope } from "./signature-aliases.js";
import { lowerRustCompletionScope } from "./completion-regions.js";
import { rustLintAttributes } from "./lint-policy.js";
import { rustValueBlock } from "../syntax/value-block.js";
import type { RustAttribute } from "../syntax/attributes.js";
import { appendRustNamingAllowance, finalizeRustFunctionNames, finalizeRustItemNames,
  rustExpressionDeclaresNonSnakeName, rustStatementDeclaresNonSnakeName } from "./authored-names.js";

export function finalizeRustSourceStyle(model: RustSourceFileModel): RustSourceFileModel {
  const scope = finalizeRustItemScope(model.items);
  return { ...model, items: [...scope.aliases, ...scope.items] };
}

function finalizeRustItemScope(items: readonly RustItem[]): RustNamedSignatureScope {
  const named = nameRustSignatureTypes(items, (callable, nameType) => styleCallable(callable, nameType));
  return { aliases: named.aliases.map(finalizeRustItemStyle), items: named.items.map(finalizeRustItemStyle) };
}

function styleCallable<Callable extends RustImplFunction>(
  callable: Callable, nameType?: (type: RustType, role: string) => RustType,
): Callable {
  const styler = createRustBodyStyler(nameType);
  const body = styler.block(callable.body);
  return { ...callable, body, ...(styler.requiresNamingAllowance()
    ? { attrs: appendRustNamingAllowance(callable.attrs, "snake") } : {}) };
}

function finalizeRustItemStyle(source: RustItem): RustItem {
  const item = finalizeRustItemNames(source);
  switch (item.kind) {
    case "mod-decl": return item.body === undefined ? item : { ...item, body: finalizeRustSourceStyle(item.body) };
    case "impl": return { ...item, members: item.members.map(member => member.kind === "function"
      ? finalizeRustFunctionNames(member, item.trait === undefined) : member) };
    case "trait": return { ...item, members: item.members.map(member => {
      if (member.kind !== "function") return member;
      const fn = finalizeRustFunctionNames(member);
      if (fn.body === undefined) return fn;
      const styler = createRustBodyStyler();
      const body = styler.block(fn.body);
      return { ...fn, body, ...(styler.requiresNamingAllowance()
        ? { attrs: appendRustNamingAllowance(fn.attrs, "snake") } : {}) };
    }) };
    case "const":
    case "thread-local": {
      const styler = createRustBodyStyler();
      const value = styler.expression(item.value);
      return { ...item, value, ...(styler.requiresNamingAllowance()
        ? { attrs: appendRustNamingAllowance(item.attrs, "snake") } : {}) };
    }
    default: return item;
  }
}

function createRustBodyStyler(nameType?: (type: RustType, role: string) => RustType) {
  let namingAllowance = false;
  const block = (value: RustBlock): RustBlock => {
    const localItems = value.statements.flatMap(statement => statement.kind === "item" ? [statement.item] : []);
    const scope = finalizeRustItemScope(localItems);
    let itemIndex = 0;
    return { ...value, statements: foldRustDirectLateInitializations([
      ...scope.aliases.map((item): RustStmt => ({ kind: "item", item })),
      ...value.statements.flatMap((statement): RustStmt[] => {
        if (statement.kind === "item") return [{ ...statement, item: scope.items[itemIndex++]! }];
        const styled = styleStatement(statement);
        return isRustUnitLiteralStatement(styled) || isRustEmptyBlockStatement(styled) ? [] : [styled];
      }),
    ]) };
  };
  const expression = (value: RustExpr): RustExpr => {
    namingAllowance ||= rustExpressionDeclaresNonSnakeName(value);
    const mapped = mapRustExpressionChildren(value, expression, block);
    // Evaluating the unit literal has no effect, so `{ (); value }` is the value itself (syntax only).
    if (mapped.kind === "evaluate-then" && mapped.effect.kind === "tuple-literal" && mapped.effect.elements.length === 0)
      return mapped.value;
    // `|value| f(value)` (or `|value| { f(value) }`) with an unannotated parameter is the function or variant
    // constructor path `f` itself (clippy::redundant_closure), e.g. `Ok` or `js_abi::JsValue::from_error`. A bare
    // lowercase path may be a local callable, which the closure borrows and the path would move, so it stays.
    const result = mapped.kind === "closure" ? mapped.body
      : mapped.kind === "closure-block" && !mapped.async && mapped.body.statements.length === 1 &&
        mapped.body.statements[0]?.kind === "tail" ? mapped.body.statements[0].expr : undefined;
    if ((mapped.kind === "closure" || mapped.kind === "closure-block") && mapped.params.length === 1 && result?.kind === "call" &&
      result.genericArguments === undefined && result.args.length === 1 && rustItemCallPath(result.path)) {
      const parameter = mapped.params[0];
      const argument = result.args[0];
      if (parameter !== undefined && parameter.type === undefined && parameter.mutable !== true && parameter.byRefCopy !== true &&
        (parameter.attrs?.length ?? 0) === 0 && argument?.kind === "path" && argument.path === parameter.name)
        return { kind: "path", path: result.path };
    }
    if ((mapped.kind !== "closure" && mapped.kind !== "closure-block") || nameType === undefined) return mapped;
    return { ...mapped, params: mapped.params.map(parameter => parameter.type === undefined ? parameter
      : { ...parameter, type: nameType(parameter.type, parameter.name) }) };
  };
  const styleStatement = (value: RustStmt): RustStmt => {
    namingAllowance ||= rustStatementDeclaresNonSnakeName(value);
    switch (value.kind) {
      case "let": return { ...value,
        ...(value.type === undefined || nameType === undefined ? {} : { type: nameType(value.type, value.name) }),
        ...(value.init === undefined ? {} : { init: expression(value.init) }) };
      case "let-pattern": return { ...value, init: expression(value.init) };
      case "expr":
      case "tail": return { ...value, expr: expression(value.expr) };
      case "return":
      case "completion-exit": return value.expr === undefined ? value : { ...value, expr: expression(value.expr) };
      case "assign": return { ...value, target: expression(value.target), value: expression(value.value) };
      case "index-assign": return { ...value, receiver: expression(value.receiver), index: expression(value.index),
        value: expression(value.value) };
      case "if": {
        const condition = expression(value.condition);
        const then = block(value.then);
        const nested = then.statements.length === 1 ? then.statements[0] : undefined;
        const attrs = withLintAttributes(value.attrs, [
          rustConditionPrintsAsBlock(condition) ? rustLintAttributes.blocksInConditions : undefined,
          isReflexivePathComparison(condition) ? rustLintAttributes.reflexiveComparison : undefined,
          value.else === undefined && nested?.kind === "if" && nested.else === undefined ? rustLintAttributes.collapsibleIf : undefined,
        ]);
        return { ...value, ...(attrs === undefined ? {} : { attrs }), condition, then,
          ...(value.else === undefined ? {} : { else: block(value.else) }) };
      }
      case "while": {
        const condition = expression(value.condition);
        const attrs = withLintAttributes(value.attrs, [
          rustConditionPrintsAsBlock(condition) ? rustLintAttributes.blocksInConditions : undefined]);
        return { ...value, ...(attrs === undefined ? {} : { attrs }), condition, body: block(value.body) };
      }
      case "while-let-some": return { ...value, expression: expression(value.expression), body: block(value.body) };
      case "for": return { ...value, iterable: expression(value.iterable), body: block(value.body) };
      case "loop":
      case "scope":
      case "unsafe-scope": return { ...value, body: block(value.body) };
      case "throw": return { ...value, error: expression(value.error) };
      case "try-scope":
      case "resource-scope": return styleStatement(lowerRustCompletionScope(value));
      case "item":
      case "break":
      case "continue": return value;
    }
  };
  return { block, expression, requiresNamingAllowance: () => namingAllowance };
}


// `let x: T;` followed by `x = value;` is `let x: T = value;` (clippy::needless_late_init). A run of such declarations
// followed by their assignments folds the same way (`let a; let b; a = e1; b = e2;`), also across initialized `let`s
// of other names between them (`let a; let b = e1; a = e2;`). Syntax only: no statement in the run can read or capture
// a still-uninitialized binding, so moving each declaration to its first write changes nothing.
function foldRustDirectLateInitializations(statements: readonly RustStmt[]): readonly RustStmt[] {
  const deferred = (statement: RustStmt | undefined): statement is Extract<RustStmt, { readonly kind: "let" }> =>
    statement?.kind === "let" && statement.init === undefined && (statement.attrs?.length ?? 0) === 0;
  const folded: RustStmt[] = [];
  let index = 0;
  while (index < statements.length) {
    const statement = statements[index]!;
    if (!deferred(statement)) {
      folded.push(statement);
      index++;
      continue;
    }
    const run: Extract<RustStmt, { readonly kind: "let" }>[] = [];
    for (let candidate = statements[index]; deferred(candidate); candidate = statements[index]) {
      run.push(candidate);
      index++;
    }
    const pending = new Map(run.map(declaration => [declaration.name, declaration]));
    if (pending.size !== run.length) {
      folded.push(...run);
      continue;
    }
    const initialized: RustStmt[] = [];
    let accepted = index;
    let crossed = 0;
    for (let next = statements[index]; next !== undefined && pending.size !== 0; next = statements[index]) {
      if (next.kind === "let" && next.init !== undefined && !pending.has(next.name)) {
        initialized.push(next);
        crossed++;
        index++;
        continue;
      }
      if (next.kind !== "assign" || next.operator !== "=" || next.target.kind !== "path") break;
      const declaration = pending.get(next.target.path);
      if (declaration === undefined) break;
      initialized.push({ ...declaration, init: next.value });
      pending.delete(next.target.path);
      index++;
      accepted = index;
      crossed = 0;
    }
    // Initialized `let`s after the last folded assignment stay where they were.
    if (crossed !== 0) {
      initialized.splice(initialized.length - crossed);
      index = accepted;
    }
    folded.push(...run.filter(declaration => pending.has(declaration.name)), ...initialized);
  }
  return foldRustLetAndReturn(foldRustConditionalLateInitializations(folded));
}

// `let x: T;` followed by an `if` whose every branch ends by assigning x is `let x: T = if c { … } else { … };`
// (clippy::needless_late_init). Each branch may first bind immutable locals or evaluate effects that do not mention x;
// an else-if chain folds branch by branch. Syntax only: x is unread before its assignment in every branch.
function foldRustConditionalLateInitializations(statements: readonly RustStmt[]): readonly RustStmt[] {
  const folded: RustStmt[] = [];
  for (let index = 0; index < statements.length; index++) {
    const declaration = statements[index]!;
    const next = statements[index + 1];
    const initializer = declaration.kind === "let" && declaration.init === undefined && (declaration.attrs?.length ?? 0) === 0 &&
      next !== undefined ? rustConditionalLateInitializer(next, declaration.name) : undefined;
    if (declaration.kind !== "let" || initializer === undefined) {
      folded.push(declaration);
      continue;
    }
    folded.push({ ...declaration, init: initializer });
    index++;
  }
  return folded;
}

function rustConditionalLateInitializer(statement: RustStmt, path: string): RustExpr | undefined {
  if (statement.kind !== "if" || statement.else === undefined || (statement.attrs?.length ?? 0) !== 0 ||
    (statement.then.innerAttrs?.length ?? 0) !== 0 || (statement.else.innerAttrs?.length ?? 0) !== 0 ||
    rustSyntaxReferencesPath(statement.condition, path)) return undefined;
  const whenTrue = rustBranchAssignmentValue(statement.then, path);
  const whenFalse = whenTrue === undefined ? undefined : rustBranchAssignmentValue(statement.else, path);
  return whenTrue === undefined || whenFalse === undefined ? undefined
    : { kind: "conditional", condition: statement.condition, whenTrue, whenFalse };
}

function rustBranchAssignmentValue(block: RustBlock, path: string): RustExpr | undefined {
  const last = block.statements[block.statements.length - 1];
  if (last === undefined) return undefined;
  let value = last.kind === "assign" && last.operator === "=" && last.target.kind === "path" && last.target.path === path &&
    !rustSyntaxReferencesPath(last.value, path) ? last.value : rustConditionalLateInitializer(last, path);
  if (value === undefined) return undefined;
  for (let index = block.statements.length - 2; index >= 0; index--) {
    const setup = block.statements[index]!;
    if (rustSyntaxReferencesPath(setup, path)) return undefined;
    const binding = (statement: RustStmt | undefined) => statement?.kind === "let" && statement.init !== undefined &&
      !statement.mutable && (statement.attrs?.length ?? 0) === 0
      ? { name: statement.name, value: statement.init, ...(statement.type === undefined ? {} : { type: statement.type }) } : undefined;
    const selected = binding(setup);
    if (selected !== undefined) {
      const bindings = [selected];
      for (let previous = binding(block.statements[index - 1]); previous !== undefined; previous = binding(block.statements[index - 1])) {
        bindings.unshift(previous);
        index--;
      }
      value = rustValueBlock(bindings, value);
    } else if (setup.kind === "expr" || setup.kind === "assign") {
      value = { kind: "evaluate-then", discard: "unit", value, effect: setup.kind === "expr" ? setup.expr
        : { kind: "assignment", target: setup.target, operator: setup.operator, value: setup.value } };
    } else return undefined;
  }
  return value;
}

// Whether a syntax subtree mentions `path` as a path expression or assignment target (conservative: nested
// bindings that shadow it still count).
function rustSyntaxReferencesPath(value: unknown, path: string): boolean {
  if (Array.isArray(value)) return value.some(entry => rustSyntaxReferencesPath(entry, path));
  if (value === null || typeof value !== "object") return false;
  const node = value as { readonly kind?: unknown; readonly path?: unknown; readonly name?: unknown };
  if (node.kind === "path" && node.path === path) return true;
  if (node.kind === "let" && node.name === path) return true;
  return Object.values(value).some(entry => rustSyntaxReferencesPath(entry, path));
}

// A block ending in `let x = value; x` is the value itself (clippy::let_and_return). Only an unannotated, unattributed,
// immutable binding is folded, so no coercion site or lint expectation is lost.
function foldRustLetAndReturn(statements: readonly RustStmt[]): readonly RustStmt[] {
  const last = statements[statements.length - 1];
  const binding = statements[statements.length - 2];
  if (last?.kind !== "tail" || last.expr.kind !== "path" || binding?.kind !== "let" || binding.name !== last.expr.path ||
    binding.init === undefined || binding.type !== undefined || binding.mutable || (binding.attrs?.length ?? 0) !== 0) return statements;
  return [...statements.slice(0, -2), { kind: "tail", expr: binding.init }];
}

// A unit literal used as a statement (`();` or `let _ = ();`) has no effect by construction; it is dropped as
// syntax only. Attributed statements are kept.
function isRustUnitLiteralStatement(statement: RustStmt): boolean {
  const value = statement.kind === "expr" ? statement.expr
    : statement.kind === "let" && statement.name === "_" && !statement.mutable && statement.type === undefined
      ? statement.init : undefined;
  const attributed = "attrs" in statement && (statement.attrs?.length ?? 0) !== 0;
  return !attributed && value?.kind === "tuple-literal" && value.elements.length === 0;
}

// An unlabelled empty block used as a statement (`{}`, e.g. a base constructor call with no effect) has no effect;
// dropping it lets a late initialization meet its first assignment.
function isRustEmptyBlockStatement(statement: RustStmt): boolean {
  const block = statement.kind === "scope" ? statement
    : statement.kind === "expr" && statement.expr.kind === "block" ? statement.expr : undefined;
  return block !== undefined && block.label === undefined && block.body.statements.length === 0;
}

// Syntax-only lint expectations for conditions, as before the rewrite: each attribute names a lint that the printed
// form of this one statement triggers, so the expectation is always fulfilled.
function withLintAttributes(existing: readonly RustAttribute[] | undefined,
  selected: readonly (RustAttribute | undefined)[]): readonly RustAttribute[] | undefined {
  const added = selected.filter((attribute): attribute is RustAttribute => attribute !== undefined &&
    !(existing ?? []).includes(attribute));
  return added.length === 0 ? existing : [...existing ?? [], ...added];
}

function rustConditionPrintsAsBlock(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "block":
    case "evaluate-then": return true;
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str": return rustConditionPrintsAsBlock(expression.expression);
    case "option-try":
    case "try":
    case "await": return rustConditionPrintsAsBlock(expression.expr);
    default: return false;
  }
}

function isReflexivePathComparison(condition: RustExpr): boolean {
  return condition.kind === "binary" && (condition.operator === "==" || condition.operator === "!=") &&
    condition.left.kind === "path" && condition.right.kind === "path" && condition.left.path === condition.right.path;
}

function rustItemCallPath(path: string): boolean {
  return path.includes("::") || /^[A-Z]/u.test(path);
}
