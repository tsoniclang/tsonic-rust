import type {
  RustBlock,
  RustExpr,
  RustFunctionParam,
  RustImplFunction,
  RustItem,
  RustPattern,
  RustStmt,
  RustTraitFunction,
  RustType,
  RustGenerics,
  RustTypeBound,
} from "../nodes.js";

export function rustItemsReferenceModuleAlias(
  items: readonly RustItem[],
  alias: string,
): boolean {
  return items.some((item) => rustItemReferencesModuleAlias(item, alias));
}

function rustItemReferencesModuleAlias(item: RustItem, alias: string): boolean {
  switch (item.kind) {
    case "function":
      return rustGenericsReferenceModuleAlias(item.generics, alias) ||
        rustFunctionParametersReferenceModuleAlias(item.params, alias) ||
        rustOptionalTypeReferencesModuleAlias(item.returnType, alias) ||
        rustOptionalTypeReferencesModuleAlias(item.errorType, alias) ||
        rustBlockReferencesModuleAlias(item.body, alias);
    case "const":
    case "thread-local":
      return rustTypeReferencesModuleAlias(item.type, alias) ||
        rustExpressionReferencesModuleAlias(item.value, alias);
    case "mod-decl":
      return false;
    case "struct":
      return rustGenericsReferenceModuleAlias(item.generics, alias) ||
        item.fields.some((field) => rustTypeReferencesModuleAlias(field.type, alias));
    case "trait":
      return rustGenericsReferenceModuleAlias(item.generics, alias) ||
        item.superTraits?.some((type) =>
          rustTypeReferencesModuleAlias(type, alias)) === true ||
        item.functions.some((fn) => rustTraitFunctionReferencesModuleAlias(fn, alias));
    case "impl":
      return rustGenericsReferenceModuleAlias(item.generics, alias) ||
        rustOptionalTypeReferencesModuleAlias(item.trait, alias) ||
        rustTypeReferencesModuleAlias(item.target, alias) ||
        item.functions.some((fn) => rustImplFunctionReferencesModuleAlias(fn, alias));
    case "enum":
      return rustGenericsReferenceModuleAlias(item.generics, alias) ||
        item.variants.some((variant) =>
        variant.fields?.some((type) =>
          rustTypeReferencesModuleAlias(type, alias)) === true);
    case "type-alias":
      return rustGenericsReferenceModuleAlias(item.generics, alias) ||
        rustTypeReferencesModuleAlias(item.target, alias);
    case "use":
      return rustPathReferencesModuleAlias(item.path, alias);
  }
}

function rustTraitFunctionReferencesModuleAlias(
  fn: RustTraitFunction,
  alias: string,
): boolean {
  return rustGenericsReferenceModuleAlias(fn.generics, alias) ||
    rustFunctionParametersReferenceModuleAlias(fn.params, alias) ||
    rustOptionalTypeReferencesModuleAlias(fn.returnType, alias) ||
    rustOptionalTypeReferencesModuleAlias(fn.errorType, alias);
}

function rustImplFunctionReferencesModuleAlias(
  fn: RustImplFunction,
  alias: string,
): boolean {
  return rustGenericsReferenceModuleAlias(fn.generics, alias) ||
    rustFunctionParametersReferenceModuleAlias(fn.params, alias) ||
    rustOptionalTypeReferencesModuleAlias(fn.returnType, alias) ||
    rustOptionalTypeReferencesModuleAlias(fn.errorType, alias) ||
    rustBlockReferencesModuleAlias(fn.body, alias);
}

function rustFunctionParametersReferenceModuleAlias(
  parameters: readonly RustFunctionParam[],
  alias: string,
): boolean {
  return parameters.some((parameter) =>
    rustTypeReferencesModuleAlias(parameter.type, alias));
}

function rustGenericsReferenceModuleAlias(
  generics: RustGenerics,
  alias: string,
): boolean {
  return generics.parameters.some((parameter) =>
    parameter.kind === "type"
      ? parameter.bounds.some((bound) => rustTypeBoundReferencesModuleAlias(bound, alias)) ||
        rustOptionalTypeReferencesModuleAlias(parameter.defaultType, alias)
      : parameter.kind === "const"
        ? rustTypeReferencesModuleAlias(parameter.type, alias)
        : false) ||
    generics.wherePredicates.some((predicate) =>
      predicate.kind === "type" &&
        (rustTypeReferencesModuleAlias(predicate.type, alias) ||
          predicate.bounds.some((bound) =>
            rustTypeBoundReferencesModuleAlias(bound, alias))));
}

function rustTypeBoundReferencesModuleAlias(
  bound: RustTypeBound,
  alias: string,
): boolean {
  switch (bound.kind) {
    case "trait":
      return rustPathReferencesModuleAlias(bound.path, alias);
    case "trait-type":
      return rustTypeReferencesModuleAlias(bound.trait, alias);
    case "callable":
      return bound.parameters.some((parameter) =>
        rustTypeReferencesModuleAlias(parameter, alias)) ||
        rustTypeReferencesModuleAlias(bound.result, alias);
    case "lifetime":
    case "maybe-sized":
      return false;
  }
}

function rustOptionalTypeReferencesModuleAlias(
  type: RustType | undefined,
  alias: string,
): boolean {
  return type !== undefined && rustTypeReferencesModuleAlias(type, alias);
}

function rustTypeReferencesModuleAlias(type: RustType, alias: string): boolean {
  switch (type.kind) {
    case "infer":
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return false;
    case "named":
      return rustPathReferencesModuleAlias(type.path, alias) ||
        type.genericArguments?.some((argument) =>
          argument.kind === "type" &&
            rustTypeReferencesModuleAlias(argument.type, alias)) === true;
    case "qualified":
      return rustTypeReferencesModuleAlias(type.owner, alias) ||
        rustOptionalTypeReferencesModuleAlias(type.trait, alias) ||
        type.genericArguments?.some((argument) =>
          argument.kind === "type" &&
            rustTypeReferencesModuleAlias(argument.type, alias)) === true;
    case "trait-object":
      return rustTypeReferencesModuleAlias(type.principal, alias) ||
        type.autoTraits.some((trait) => rustTypeReferencesModuleAlias(trait, alias));
    case "impl-trait":
      return type.bounds.some((bound) => rustTypeReferencesModuleAlias(bound, alias));
    case "reference":
      return rustTypeReferencesModuleAlias(type.referent, alias);
    case "raw-pointer":
      return rustTypeReferencesModuleAlias(type.pointee, alias);
    case "fixed-array":
    case "slice":
      return rustTypeReferencesModuleAlias(type.element, alias);
    case "function-pointer":
      return type.parameters.some((parameter) =>
        rustTypeReferencesModuleAlias(parameter, alias)) ||
        rustTypeReferencesModuleAlias(type.result, alias);
    case "tuple":
      return type.elements.some((element) =>
        rustTypeReferencesModuleAlias(element, alias));
  }
}

function rustBlockReferencesModuleAlias(block: RustBlock, alias: string): boolean {
  return block.statements.some((statement) =>
    rustStatementReferencesModuleAlias(statement, alias));
}

function rustStatementReferencesModuleAlias(statement: RustStmt, alias: string): boolean {
  switch (statement.kind) {
    case "let":
      return rustOptionalTypeReferencesModuleAlias(statement.type, alias) ||
        (statement.init !== undefined &&
          rustExpressionReferencesModuleAlias(statement.init, alias));
    case "expr":
    case "tail":
      return rustExpressionReferencesModuleAlias(statement.expr, alias);
    case "assign":
      return rustExpressionReferencesModuleAlias(statement.target, alias) ||
        rustExpressionReferencesModuleAlias(statement.value, alias);
    case "return":
      return statement.expr !== undefined &&
        rustExpressionReferencesModuleAlias(statement.expr, alias);
    case "if":
      return rustExpressionReferencesModuleAlias(statement.condition, alias) ||
        rustBlockReferencesModuleAlias(statement.then, alias) ||
        (statement.else !== undefined &&
          rustBlockReferencesModuleAlias(statement.else, alias));
    case "loop":
      return rustBlockReferencesModuleAlias(statement.body, alias);
    case "while":
      return rustExpressionReferencesModuleAlias(statement.condition, alias) ||
        rustBlockReferencesModuleAlias(statement.body, alias);
    case "while-let-some":
    case "if-let-some":
      return rustExpressionReferencesModuleAlias(statement.expression, alias) ||
        rustBlockReferencesModuleAlias(statement.body, alias);
    case "for":
      return rustExpressionReferencesModuleAlias(statement.iterable, alias) ||
        rustBlockReferencesModuleAlias(statement.body, alias);
    case "break":
    case "continue":
      return false;
    case "completion-exit":
      return alias === "rt" ||
        statement.expr !== undefined &&
          rustExpressionReferencesModuleAlias(statement.expr, alias);
    case "resource-scope":
      return alias === "rt" ||
        rustTypeReferencesModuleAlias(statement.returnType, alias) ||
        rustBlockReferencesModuleAlias(statement.body, alias) ||
        rustBlockReferencesModuleAlias(statement.cleanup, alias) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) =>
            rustStatementReferencesModuleAlias(value, alias)) === true);
    case "index-assign":
      return rustExpressionReferencesModuleAlias(statement.receiver, alias) ||
        rustExpressionReferencesModuleAlias(statement.index, alias) ||
        rustExpressionReferencesModuleAlias(statement.value, alias);
    case "scope":
    case "unsafe-scope":
      return rustBlockReferencesModuleAlias(statement.body, alias);
    case "throw":
      return rustExpressionReferencesModuleAlias(statement.error, alias);
    case "try-scope":
      return alias === "rt" ||
        rustTypeReferencesModuleAlias(statement.returnType, alias) ||
        rustBlockReferencesModuleAlias(statement.body, alias) ||
        (statement.catchClause !== undefined &&
          rustBlockReferencesModuleAlias(statement.catchClause.body, alias)) ||
        (statement.finallyClause !== undefined &&
          rustBlockReferencesModuleAlias(statement.finallyClause.body, alias)) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((value) =>
            rustStatementReferencesModuleAlias(value, alias)) === true);
  }
}

function rustExpressionReferencesModuleAlias(expression: RustExpr, alias: string): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "char-literal":
    case "string-literal":
    case "str-literal":
    case "unreachable":
      return false;
    case "path":
      return rustPathReferencesModuleAlias(expression.path, alias);
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return rustExpressionReferencesModuleAlias(expression.expression, alias);
    case "unary":
      return rustExpressionReferencesModuleAlias(expression.operand, alias);
    case "dereference":
      return rustExpressionReferencesModuleAlias(expression.pointer, alias);
    case "binary":
      return rustExpressionReferencesModuleAlias(expression.left, alias) ||
        rustExpressionReferencesModuleAlias(expression.right, alias);
    case "range":
      return rustExpressionReferencesModuleAlias(expression.start, alias) ||
        rustExpressionReferencesModuleAlias(expression.end, alias);
    case "conditional":
      return rustExpressionReferencesModuleAlias(expression.condition, alias) ||
        rustExpressionReferencesModuleAlias(expression.whenTrue, alias) ||
        rustExpressionReferencesModuleAlias(expression.whenFalse, alias);
    case "match":
      return rustExpressionReferencesModuleAlias(expression.expression, alias) ||
        expression.arms.some((arm) =>
          rustPatternReferencesModuleAlias(arm.pattern, alias) ||
          rustExpressionReferencesModuleAlias(arm.expression, alias));
    case "matches":
      return rustExpressionReferencesModuleAlias(expression.expression, alias) ||
        rustPatternReferencesModuleAlias(expression.pattern, alias);
    case "assignment":
      return rustExpressionReferencesModuleAlias(expression.target, alias) ||
        rustExpressionReferencesModuleAlias(expression.value, alias);
    case "call":
      return rustPathReferencesModuleAlias(expression.path, alias) ||
        expression.typeArguments?.some((argument) =>
          rustTypeReferencesModuleAlias(argument, alias)) === true ||
        expression.args.some((argument) =>
          rustExpressionReferencesModuleAlias(argument, alias));
    case "invoke":
      return rustExpressionReferencesModuleAlias(expression.callee, alias) ||
        expression.args.some((argument) =>
          rustExpressionReferencesModuleAlias(argument, alias));
    case "associated-value":
      return rustTypeReferencesModuleAlias(expression.owner, alias) ||
        rustOptionalTypeReferencesModuleAlias(expression.trait, alias);
    case "associated-call":
      return rustTypeReferencesModuleAlias(expression.owner, alias) ||
        rustOptionalTypeReferencesModuleAlias(expression.trait, alias) ||
        expression.typeArguments?.some((argument) =>
          rustTypeReferencesModuleAlias(argument, alias)) === true ||
        expression.args.some((argument) =>
          rustExpressionReferencesModuleAlias(argument, alias));
    case "method-call":
      return rustExpressionReferencesModuleAlias(expression.receiver, alias) ||
        expression.typeArguments?.some((argument) =>
          rustTypeReferencesModuleAlias(argument, alias)) === true ||
        expression.args.some((argument) =>
          rustExpressionReferencesModuleAlias(argument, alias));
    case "field":
      return rustExpressionReferencesModuleAlias(expression.receiver, alias);
    case "index":
      return rustExpressionReferencesModuleAlias(expression.receiver, alias) ||
        rustExpressionReferencesModuleAlias(expression.index, alias);
    case "block":
      return expression.bindings.some((binding) =>
        rustOptionalTypeReferencesModuleAlias(binding.type, alias) ||
        rustExpressionReferencesModuleAlias(binding.value, alias)) ||
        rustExpressionReferencesModuleAlias(expression.value, alias);
    case "evaluate-then":
      return rustExpressionReferencesModuleAlias(expression.effect, alias) ||
        rustExpressionReferencesModuleAlias(expression.value, alias);
    case "string-concat":
      return expression.parts.some((part) =>
        rustExpressionReferencesModuleAlias(part, alias));
    case "format-write":
      return rustExpressionReferencesModuleAlias(expression.writer, alias) ||
        expression.args.some((argument) =>
          rustExpressionReferencesModuleAlias(argument, alias));
    case "reference":
      return rustExpressionReferencesModuleAlias(expression.expr, alias);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some((element) =>
        rustExpressionReferencesModuleAlias(element, alias));
    case "closure":
      return rustExpressionReferencesModuleAlias(expression.body, alias);
    case "closure-block":
      return rustBlockReferencesModuleAlias(expression.body, alias);
    case "await":
      return rustExpressionReferencesModuleAlias(expression.expr, alias);
    case "try":
      return rustExpressionReferencesModuleAlias(expression.expr, alias) ||
        rustTypeReferencesModuleAlias(expression.resultErrorType, alias) ||
        rustTypeReferencesModuleAlias(expression.operandErrorType, alias);
    case "return-expression":
      return expression.expr !== undefined &&
        rustExpressionReferencesModuleAlias(expression.expr, alias);
    case "struct-literal":
      return rustPathReferencesModuleAlias(expression.path, alias) ||
        expression.fields.some((field) =>
          rustExpressionReferencesModuleAlias(field.value, alias)) ||
        (expression.base !== undefined &&
          rustExpressionReferencesModuleAlias(expression.base, alias));
  }
}

function rustPatternReferencesModuleAlias(pattern: RustPattern, alias: string): boolean {
  switch (pattern.kind) {
    case "wildcard":
    case "binding":
      return false;
    case "path":
      return rustPathReferencesModuleAlias(pattern.path, alias);
    case "tuple":
      return pattern.elements.some((element) =>
        rustPatternReferencesModuleAlias(element, alias));
    case "tuple-variant":
      return rustPathReferencesModuleAlias(pattern.path, alias) ||
        pattern.elements.some((element) =>
          rustPatternReferencesModuleAlias(element, alias));
  }
}

function rustPathReferencesModuleAlias(path: string, alias: string): boolean {
  return path === alias || path.startsWith(`${alias}::`);
}
