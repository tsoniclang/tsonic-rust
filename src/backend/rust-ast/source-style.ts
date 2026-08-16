import type {
  RustBlock,
  RustExpr,
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustTraitFunction,
  RustType,
} from "./nodes.js";
import { finalizeRustBlockLiveness } from "./source-liveness.js";
import { rustExpressionContainsStatementBlock } from "./expressions.js";

const tooManyArgumentsAttribute = "#[allow(clippy::too_many_arguments)]";
const inherentToStringAttribute = "#[allow(clippy::inherent_to_string)]";
const privateInterfacesAttribute = "#[allow(private_interfaces)]";
const blocksInConditionsAttribute = "#[allow(clippy::blocks_in_conditions)]";
const collapsibleIfAttribute = "#[allow(clippy::collapsible_if)]";
const neverLoopAttribute = "#[allow(clippy::never_loop)]";
const unusedVariablesAttribute = "#[allow(unused_variables)]";

export function finalizeRustSourceStyle(
  model: RustSourceFileModel,
): RustSourceFileModel {
  const restrictedLocalTypes = new Set(model.items.flatMap((item) =>
    (item.kind === "struct" || item.kind === "enum" || item.kind === "type-alias") &&
      item.visibility !== "public"
      ? [item.name]
      : []));
  return {
    ...model,
    items: model.items.map((item) => finalizeRustItemStyle(item, restrictedLocalTypes)),
  };
}

function finalizeRustItemStyle(
  item: RustItem,
  restrictedLocalTypes: ReadonlySet<string>,
): RustItem {
  if (item.kind === "function") {
    const attrs = item.params.length <= 7
      ? item.attrs
      : appendRustAttribute(item.attrs, tooManyArgumentsAttribute);
    return { ...item, attrs, body: finalizeRustFunctionBodyStyle(item.body) };
  }
  if (item.kind === "trait") {
    return {
      ...item,
      functions: item.functions.map(finalizeRustTraitFunctionStyle),
    };
  }
  if (item.kind === "impl") {
    return {
      ...item,
      functions: item.functions.map((fn) =>
        finalizeRustImplFunctionStyle(fn, item.trait === undefined, restrictedLocalTypes)),
    };
  }
  if (item.kind === "const" || item.kind === "thread-local") {
    return { ...item, value: finalizeRustExpressionStyle(item.value) };
  }
  return item;
}

function finalizeRustTraitFunctionStyle(fn: RustTraitFunction): RustTraitFunction {
  const argumentCount = fn.params.length + (fn.selfParam === undefined ? 0 : 1);
  return argumentCount <= 7
    ? fn
    : { ...fn, attrs: appendRustAttribute(fn.attrs, tooManyArgumentsAttribute) };
}

function finalizeRustImplFunctionStyle(
  fn: RustImplFunction,
  inherent: boolean,
  restrictedLocalTypes: ReadonlySet<string>,
): RustImplFunction {
  let attrs = fn.attrs;
  const argumentCount = fn.params.length + (fn.selfParam === undefined ? 0 : 1);
  if (argumentCount > 7) {
    attrs = appendRustAttribute(attrs, tooManyArgumentsAttribute);
  }
  if (inherent && fn.name === "to_string" && fn.selfParam !== undefined &&
    fn.params.length === 0 && fn.returnType?.kind === "string") {
    attrs = appendRustAttribute(attrs, inherentToStringAttribute);
  }
  if (fn.visibility === "public" &&
    [...fn.params.map((parameter) => parameter.type), fn.returnType]
      .some((type) => type !== undefined &&
        rustTypeContainsRestrictedLocalType(type, restrictedLocalTypes))) {
    attrs = appendRustAttribute(attrs, privateInterfacesAttribute);
  }
  return { ...fn, attrs, body: finalizeRustFunctionBodyStyle(fn.body) };
}

function finalizeRustFunctionBodyStyle(block: RustBlock): RustBlock {
  return finalizeRustBlockLiveness(finalizeRustBlockStyle(block));
}

function finalizeRustBlockStyle(block: RustBlock): RustBlock {
  return {
    ...block,
    statements: block.statements.map(finalizeRustStatementStyle),
  };
}

function finalizeRustStatementStyle(statement: RustStmt): RustStmt {
  switch (statement.kind) {
    case "let":
      return statement.init === undefined
        ? statement
        : { ...statement, init: finalizeRustExpressionStyle(statement.init) };
    case "expr":
      return { ...statement, expr: finalizeRustExpressionStyle(statement.expr) };
    case "assign":
      return {
        ...statement,
        target: finalizeRustExpressionStyle(statement.target),
        value: finalizeRustExpressionStyle(statement.value),
      };
    case "return":
      return statement.expr === undefined
        ? statement
        : { ...statement, expr: finalizeRustExpressionStyle(statement.expr) };
    case "tail":
      return { ...statement, expr: finalizeRustExpressionStyle(statement.expr) };
    case "if": {
      const condition = finalizeRustExpressionStyle(statement.condition);
      const then = finalizeRustBlockStyle(statement.then);
      const otherwise = statement.else === undefined
        ? undefined
        : finalizeRustBlockStyle(statement.else);
      let attrs = statement.attrs;
      if (rustExpressionContainsStatementBlock(condition)) {
        attrs = appendRustAttribute(attrs, blocksInConditionsAttribute);
      }
      const nested = then.statements.length === 1 ? then.statements[0] : undefined;
      if (otherwise === undefined && nested?.kind === "if" && nested.else === undefined) {
        attrs = appendRustAttribute(attrs, collapsibleIfAttribute);
      }
      return {
        ...statement,
        attrs,
        condition,
        then,
        ...(otherwise === undefined ? {} : { else: otherwise }),
      };
    }
    case "loop":
      return { ...statement, body: finalizeRustBlockStyle(statement.body) };
    case "while": {
      const condition = finalizeRustExpressionStyle(statement.condition);
      const attrs = rustExpressionContainsStatementBlock(condition)
        ? appendRustAttribute(statement.attrs, blocksInConditionsAttribute)
        : statement.attrs;
      return { ...statement, attrs, condition, body: finalizeRustBlockStyle(statement.body) };
    }
    case "while-let-some":
      return {
        ...statement,
        expression: finalizeRustExpressionStyle(statement.expression),
        body: finalizeRustBlockStyle(statement.body),
      };
    case "for": {
      const body = finalizeRustBlockStyle(statement.body);
      let attrs = statement.attrs;
      if (!rustBlockReferencesPath(body, statement.binding)) {
        attrs = appendRustAttribute(attrs, unusedVariablesAttribute);
      }
      const finalStatement = body.statements[body.statements.length - 1];
      if (finalStatement?.kind === "break" && finalStatement.label === statement.label) {
        attrs = appendRustAttribute(attrs, neverLoopAttribute);
      }
      return {
        ...statement,
        attrs,
        iterable: finalizeRustExpressionStyle(statement.iterable),
        body,
      };
    }
    case "if-let-some":
      return {
        ...statement,
        expression: finalizeRustExpressionStyle(statement.expression),
        body: finalizeRustBlockStyle(statement.body),
      };
    case "break":
    case "continue":
      return statement;
    case "completion-exit":
      return statement.expr === undefined
        ? statement
        : { ...statement, expr: finalizeRustExpressionStyle(statement.expr) };
    case "resource-scope":
      return {
        ...statement,
        body: finalizeRustBlockStyle(statement.body),
        cleanup: finalizeRustBlockStyle(statement.cleanup),
        dispatchTargets: statement.dispatchTargets.map((target) => ({
          ...target,
          ...(target.continuePrelude === undefined
            ? {}
            : { continuePrelude: target.continuePrelude.map(finalizeRustStatementStyle) }),
        })),
      };
    case "index-assign":
      return {
        ...statement,
        receiver: finalizeRustExpressionStyle(statement.receiver),
        index: finalizeRustExpressionStyle(statement.index),
        value: finalizeRustExpressionStyle(statement.value),
      };
    case "scope":
    case "unsafe-scope":
      return { ...statement, body: finalizeRustBlockStyle(statement.body) };
    case "throw":
      return { ...statement, error: finalizeRustExpressionStyle(statement.error) };
    case "try-scope":
      return {
        ...statement,
        body: finalizeRustBlockStyle(statement.body),
        ...(statement.catchClause === undefined
          ? {}
          : {
              catchClause: {
                ...statement.catchClause,
                body: finalizeRustBlockStyle(statement.catchClause.body),
              },
            }),
        ...(statement.finallyClause === undefined
          ? {}
          : {
              finallyClause: {
                ...statement.finallyClause,
                body: finalizeRustBlockStyle(statement.finallyClause.body),
              },
            }),
        dispatchTargets: statement.dispatchTargets.map((target) => ({
          ...target,
          ...(target.continuePrelude === undefined
            ? {}
            : { continuePrelude: target.continuePrelude.map(finalizeRustStatementStyle) }),
        })),
      };
  }
}

function finalizeRustExpressionStyle(expression: RustExpr): RustExpr {
  let result: RustExpr;
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
      return expression;
    case "bottom":
      result = { ...expression, expression: finalizeRustExpressionStyle(expression.expression) };
      break;
    case "owned-string-from-borrowed-str":
      result = { ...expression, expression: finalizeRustExpressionStyle(expression.expression) };
      break;
    case "unary":
      result = { ...expression, operand: finalizeRustExpressionStyle(expression.operand) };
      break;
    case "dereference":
      result = { ...expression, pointer: finalizeRustExpressionStyle(expression.pointer) };
      break;
    case "numeric-cast":
      result = { ...expression, expression: finalizeRustExpressionStyle(expression.expression) };
      break;
    case "binary":
      result = {
        ...expression,
        left: finalizeRustExpressionStyle(expression.left),
        right: finalizeRustExpressionStyle(expression.right),
      };
      break;
    case "range":
      result = {
        ...expression,
        start: finalizeRustExpressionStyle(expression.start),
        end: finalizeRustExpressionStyle(expression.end),
      };
      break;
    case "conditional":
      result = {
        ...expression,
        condition: finalizeRustExpressionStyle(expression.condition),
        whenTrue: finalizeRustExpressionStyle(expression.whenTrue),
        whenFalse: finalizeRustExpressionStyle(expression.whenFalse),
      };
      break;
    case "match":
      result = {
        ...expression,
        expression: finalizeRustExpressionStyle(expression.expression),
        arms: expression.arms.map((arm) => ({
          ...arm,
          expression: finalizeRustExpressionStyle(arm.expression),
        })),
      };
      break;
    case "matches":
      result = { ...expression, expression: finalizeRustExpressionStyle(expression.expression) };
      break;
    case "assignment":
      result = {
        ...expression,
        target: finalizeRustExpressionStyle(expression.target),
        value: finalizeRustExpressionStyle(expression.value),
      };
      break;
    case "call":
      result = { ...expression, args: expression.args.map(finalizeRustExpressionStyle) };
      break;
    case "invoke":
      result = {
        ...expression,
        callee: finalizeRustExpressionStyle(expression.callee),
        args: expression.args.map(finalizeRustExpressionStyle),
      };
      break;
    case "associated-call":
      result = { ...expression, args: expression.args.map(finalizeRustExpressionStyle) };
      break;
    case "method-call":
      result = {
        ...expression,
        receiver: finalizeRustExpressionStyle(expression.receiver),
        args: expression.args.map(finalizeRustExpressionStyle),
      };
      break;
    case "field":
      result = { ...expression, receiver: finalizeRustExpressionStyle(expression.receiver) };
      break;
    case "index":
      result = {
        ...expression,
        receiver: finalizeRustExpressionStyle(expression.receiver),
        index: finalizeRustExpressionStyle(expression.index),
      };
      break;
    case "block":
      result = {
        ...expression,
        bindings: expression.bindings.map((binding) => ({
          ...binding,
          value: finalizeRustExpressionStyle(binding.value),
        })),
        value: finalizeRustExpressionStyle(expression.value),
      };
      break;
    case "unsafe":
      result = { ...expression, expression: finalizeRustExpressionStyle(expression.expression) };
      break;
    case "evaluate-then":
      result = {
        ...expression,
        effect: finalizeRustExpressionStyle(expression.effect),
        value: finalizeRustExpressionStyle(expression.value),
      };
      break;
    case "string-concat":
      result = { ...expression, parts: expression.parts.map(finalizeRustExpressionStyle) };
      break;
    case "format-write":
      result = {
        ...expression,
        writer: finalizeRustExpressionStyle(expression.writer),
        args: expression.args.map(finalizeRustExpressionStyle),
      };
      break;
    case "reference":
      result = { ...expression, expr: finalizeRustExpressionStyle(expression.expr) };
      break;
    case "vec-literal":
    case "slice-literal":
      result = { ...expression, elements: expression.elements.map(finalizeRustExpressionStyle) };
      break;
    case "closure":
      result = { ...expression, body: finalizeRustExpressionStyle(expression.body) };
      break;
    case "closure-block":
      result = { ...expression, body: finalizeRustFunctionBodyStyle(expression.body) };
      break;
    case "await":
    case "try":
      result = { ...expression, expr: finalizeRustExpressionStyle(expression.expr) };
      break;
    case "return-expression":
      result = expression.expr === undefined
        ? expression
        : { ...expression, expr: finalizeRustExpressionStyle(expression.expr) };
      break;
    case "struct-literal":
      result = {
        ...expression,
        fields: expression.fields.map((field) => ({
          ...field,
          value: finalizeRustExpressionStyle(field.value),
        })),
      };
      break;
    case "tuple-literal":
      result = { ...expression, elements: expression.elements.map(finalizeRustExpressionStyle) };
      break;
  }
  return result;
}

function rustBlockReferencesPath(block: RustBlock, path: string): boolean {
  return block.statements.some((statement) => rustStatementReferencesPath(statement, path));
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
        rustBlockReferencesPath(statement.then, path) ||
        (statement.else !== undefined && rustBlockReferencesPath(statement.else, path));
    case "loop":
      return rustBlockReferencesPath(statement.body, path);
    case "while":
      return rustExpressionReferencesPath(statement.condition, path) ||
        rustBlockReferencesPath(statement.body, path);
    case "while-let-some":
    case "if-let-some":
      return rustExpressionReferencesPath(statement.expression, path) ||
        rustBlockReferencesPath(statement.body, path);
    case "for":
      return rustExpressionReferencesPath(statement.iterable, path) ||
        rustBlockReferencesPath(statement.body, path);
    case "break":
    case "continue":
      return false;
    case "completion-exit":
      return statement.expr !== undefined && rustExpressionReferencesPath(statement.expr, path);
    case "resource-scope":
      return rustBlockReferencesPath(statement.body, path) ||
        rustBlockReferencesPath(statement.cleanup, path) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) => rustStatementReferencesPath(value, path)) === true);
    case "index-assign":
      return rustExpressionReferencesPath(statement.receiver, path) ||
        rustExpressionReferencesPath(statement.index, path) ||
        rustExpressionReferencesPath(statement.value, path);
    case "scope":
    case "unsafe-scope":
      return rustBlockReferencesPath(statement.body, path);
    case "throw":
      return rustExpressionReferencesPath(statement.error, path);
    case "try-scope":
      return rustBlockReferencesPath(statement.body, path) ||
        (statement.catchClause !== undefined && rustBlockReferencesPath(statement.catchClause.body, path)) ||
        (statement.finallyClause !== undefined && rustBlockReferencesPath(statement.finallyClause.body, path)) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) => rustStatementReferencesPath(value, path)) === true);
  }
}

function rustExpressionReferencesPath(expression: RustExpr, path: string): boolean {
  return expression.kind === "path" && expression.path === path ||
    rustExpressionChildren(expression).some((child) => rustExpressionReferencesPath(child, path)) ||
    expression.kind === "closure-block" && rustBlockReferencesPath(expression.body, path);
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

function rustTypeContainsRestrictedLocalType(
  type: RustType,
  restrictedLocalTypes: ReadonlySet<string>,
): boolean {
  switch (type.kind) {
    case "named":
      return restrictedLocalTypes.has(type.path) ||
        type.typeArguments?.some((argument) =>
          rustTypeContainsRestrictedLocalType(argument, restrictedLocalTypes)) === true;
    case "trait-object":
      return rustTypeContainsRestrictedLocalType(type.trait, restrictedLocalTypes);
    case "reference":
      return rustTypeContainsRestrictedLocalType(type.referent, restrictedLocalTypes);
    case "raw-pointer":
      return rustTypeContainsRestrictedLocalType(type.pointee, restrictedLocalTypes);
    case "fixed-array":
    case "slice-ref":
      return rustTypeContainsRestrictedLocalType(type.element, restrictedLocalTypes);
    case "function-pointer":
      return type.parameters.some((parameter) =>
        rustTypeContainsRestrictedLocalType(parameter, restrictedLocalTypes)) ||
        rustTypeContainsRestrictedLocalType(type.result, restrictedLocalTypes);
    case "tuple":
      return type.elements.some((element) =>
        rustTypeContainsRestrictedLocalType(element, restrictedLocalTypes));
    case "primitive":
    case "string":
    case "str-ref":
    case "unit":
    case "never":
      return false;
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
