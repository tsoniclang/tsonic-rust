import type { RustBlock, RustExpr, RustImplFunction, RustItem, RustSourceFileModel, RustStmt, RustType } from "../syntax/nodes.js";
import { mapRustExpressionChildren } from "../syntax/expression-children.js";
import { nameRustSignatureTypes, type RustNamedSignatureScope } from "./signature-aliases.js";
import { lowerRustCompletionScope } from "./completion-regions.js";
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
    return { ...value, statements: [
      ...scope.aliases.map((item): RustStmt => ({ kind: "item", item })),
      ...value.statements.flatMap((statement): RustStmt[] => {
        if (statement.kind === "item") return [{ ...statement, item: scope.items[itemIndex++]! }];
        const styled = styleStatement(statement);
        return isRustUnitLiteralStatement(styled) ? [] : [styled];
      }),
    ] };
  };
  const expression = (value: RustExpr): RustExpr => {
    namingAllowance ||= rustExpressionDeclaresNonSnakeName(value);
    const mapped = mapRustExpressionChildren(value, expression, block);
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
      case "if": return { ...value, condition: expression(value.condition), then: block(value.then),
        ...(value.else === undefined ? {} : { else: block(value.else) }) };
      case "while": return { ...value, condition: expression(value.condition), body: block(value.body) };
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


// A unit literal used as a statement (`();` or `let _ = ();`) has no effect by construction; it is dropped as
// syntax only. Attributed statements are kept.
function isRustUnitLiteralStatement(statement: RustStmt): boolean {
  const value = statement.kind === "expr" ? statement.expr
    : statement.kind === "let" && statement.name === "_" && !statement.mutable && statement.type === undefined
      ? statement.init : undefined;
  const attributed = "attrs" in statement && (statement.attrs?.length ?? 0) !== 0;
  return !attributed && value?.kind === "tuple-literal" && value.elements.length === 0;
}
