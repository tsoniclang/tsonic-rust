import type {
  RustBlock,
  RustConstExpression,
  RustExpr,
  RustGenericArgument,
  RustGenerics,
  RustImplFunction,
  RustItem,
  RustPattern,
  RustStmt,
  RustStructFields,
  RustTraitFunction,
  RustType,
  RustTypeBound,
} from "../nodes.js";

export function rustItemsReferenceModuleAlias(
  items: readonly RustItem[],
  alias: string,
): boolean {
  return items.some((item) => itemReferencesAlias(item, alias));
}

function itemReferencesAlias(item: RustItem, alias: string): boolean {
  switch (item.kind) {
    case "function":
      return genericsReferenceAlias(item.generics, alias) ||
        item.params.some((parameter) => typeReferencesAlias(parameter.type, alias)) ||
        optionalTypeReferencesAlias(item.returnType, alias) ||
        optionalTypeReferencesAlias(item.errorType, alias) ||
        blockReferencesAlias(item.body, alias);
    case "const":
    case "static":
    case "thread-local":
      return typeReferencesAlias(item.type, alias) || expressionReferencesAlias(item.value, alias);
    case "mod-decl":
      return false;
    case "use":
      return pathReferencesAlias(item.path, alias);
    case "struct":
      return genericsReferenceAlias(item.generics, alias) ||
        structFieldsReferenceAlias(item.fields, alias);
    case "union":
      return genericsReferenceAlias(item.generics, alias) ||
        item.fields.some((field) => typeReferencesAlias(field.type, alias));
    case "enum":
      return genericsReferenceAlias(item.generics, alias) ||
        item.variants.some((variant) =>
          structFieldsReferenceAlias(variant.fields, alias) ||
          (variant.discriminant !== undefined &&
            constExpressionReferencesAlias(variant.discriminant, alias)));
    case "type-alias":
      return genericsReferenceAlias(item.generics, alias) ||
        typeReferencesAlias(item.target, alias);
    case "trait":
      return genericsReferenceAlias(item.generics, alias) ||
        item.superTraits.some((bound) => boundReferencesAlias(bound, alias)) ||
        item.functions.some((fn) => traitFunctionReferencesAlias(fn, alias)) ||
        item.associatedTypes.some((entry) =>
          genericsReferenceAlias(entry.generics, alias) ||
          entry.bounds.some((bound) => boundReferencesAlias(bound, alias)) ||
          optionalTypeReferencesAlias(entry.value, alias)) ||
        item.associatedConstants.some((entry) =>
          typeReferencesAlias(entry.type, alias) ||
          (entry.value !== undefined && expressionReferencesAlias(entry.value, alias)));
    case "impl":
      return genericsReferenceAlias(item.generics, alias) ||
        optionalTypeReferencesAlias(item.trait, alias) ||
        typeReferencesAlias(item.target, alias) ||
        item.functions.some((fn) => implFunctionReferencesAlias(fn, alias)) ||
        item.associatedTypes.some((entry) =>
          genericsReferenceAlias(entry.generics, alias) ||
          entry.bounds.some((bound) => boundReferencesAlias(bound, alias)) ||
          optionalTypeReferencesAlias(entry.value, alias)) ||
        item.associatedConstants.some((entry) =>
          typeReferencesAlias(entry.type, alias) ||
          (entry.value !== undefined && expressionReferencesAlias(entry.value, alias)));
    case "extern-block":
      return item.functions.some((fn) => traitFunctionReferencesAlias(fn, alias)) ||
        item.statics.some((entry) => typeReferencesAlias(entry.type, alias));
  }
}

function traitFunctionReferencesAlias(fn: RustTraitFunction, alias: string): boolean {
  return genericsReferenceAlias(fn.generics, alias) ||
    receiverReferencesAlias(fn.receiver, alias) ||
    fn.params.some((parameter) => typeReferencesAlias(parameter.type, alias)) ||
    optionalTypeReferencesAlias(fn.returnType, alias) ||
    optionalTypeReferencesAlias(fn.errorType, alias) ||
    (fn.body !== undefined && blockReferencesAlias(fn.body, alias));
}

function implFunctionReferencesAlias(fn: RustImplFunction, alias: string): boolean {
  return genericsReferenceAlias(fn.generics, alias) ||
    receiverReferencesAlias(fn.receiver, alias) ||
    fn.params.some((parameter) => typeReferencesAlias(parameter.type, alias)) ||
    optionalTypeReferencesAlias(fn.returnType, alias) ||
    optionalTypeReferencesAlias(fn.errorType, alias) ||
    blockReferencesAlias(fn.body, alias);
}

function receiverReferencesAlias(
  receiver: RustImplFunction["receiver"] | RustTraitFunction["receiver"],
  alias: string,
): boolean {
  return receiver?.kind === "typed" && typeReferencesAlias(receiver.type, alias);
}

function genericsReferenceAlias(generics: RustGenerics, alias: string): boolean {
  return generics.parameters.some((parameter) => {
    switch (parameter.kind) {
      case "lifetime": return false;
      case "type":
        return parameter.bounds.some((bound) => boundReferencesAlias(bound, alias)) ||
          optionalTypeReferencesAlias(parameter.defaultType, alias);
      case "const":
        return typeReferencesAlias(parameter.type, alias) ||
          (parameter.defaultValue !== undefined &&
            constExpressionReferencesAlias(parameter.defaultValue, alias));
    }
  }) || generics.wherePredicates.some((predicate) =>
    predicate.kind === "type" &&
      (typeReferencesAlias(predicate.type, alias) ||
        predicate.bounds.some((bound) => boundReferencesAlias(bound, alias))));
}

function boundReferencesAlias(bound: RustTypeBound, alias: string): boolean {
  switch (bound.kind) {
    case "lifetime": return false;
    case "trait": return typeReferencesAlias(bound.trait, alias);
    case "callable-trait":
      return bound.parameters.some((parameter) => typeReferencesAlias(parameter, alias)) ||
        typeReferencesAlias(bound.result, alias);
    case "precise-capture":
      return bound.captures.some((capture) => genericArgumentReferencesAlias(capture, alias));
  }
}

function genericArgumentReferencesAlias(argument: RustGenericArgument, alias: string): boolean {
  switch (argument.kind) {
    case "lifetime": return false;
    case "type": return typeReferencesAlias(argument.type, alias);
    case "const": return constExpressionReferencesAlias(argument.expression, alias);
    case "associated-equality":
      return typeReferencesAlias(argument.type, alias) ||
        genericArgumentsReferenceAlias(argument.genericArguments, alias);
    case "associated-bounds":
      return argument.bounds.some((bound) => boundReferencesAlias(bound, alias)) ||
        genericArgumentsReferenceAlias(argument.genericArguments, alias);
  }
}

function constExpressionReferencesAlias(value: RustConstExpression, alias: string): boolean {
  switch (value.kind) {
    case "integer":
    case "boolean":
    case "character":
    case "inferred":
      return false;
    case "path":
      return pathReferencesAlias(value.path, alias) ||
        genericArgumentsReferenceAlias(value.genericArguments, alias);
    case "unary":
      return constExpressionReferencesAlias(value.operand, alias);
    case "binary":
      return constExpressionReferencesAlias(value.left, alias) ||
        constExpressionReferencesAlias(value.right, alias);
  }
}

function optionalTypeReferencesAlias(type: RustType | undefined, alias: string): boolean {
  return type !== undefined && typeReferencesAlias(type, alias);
}

function typeReferencesAlias(type: RustType, alias: string): boolean {
  switch (type.kind) {
    case "infer":
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return false;
    case "named":
      return pathReferencesAlias(type.path, alias) ||
        genericArgumentsReferenceAlias(type.genericArguments, alias);
    case "qualified":
      return typeReferencesAlias(type.owner, alias) ||
        optionalTypeReferencesAlias(type.trait, alias) ||
        genericArgumentsReferenceAlias(type.genericArguments, alias);
    case "trait-object":
    case "opaque":
      return type.bounds.some((bound) => boundReferencesAlias(bound, alias));
    case "reference": return typeReferencesAlias(type.referent, alias);
    case "raw-pointer": return typeReferencesAlias(type.pointee, alias);
    case "fixed-array":
      return typeReferencesAlias(type.element, alias) ||
        constExpressionReferencesAlias(type.length, alias);
    case "slice": return typeReferencesAlias(type.element, alias);
    case "function-pointer":
      return type.parameters.some((parameter) => typeReferencesAlias(parameter, alias)) ||
        typeReferencesAlias(type.result, alias);
    case "tuple":
      return type.elements.some((element) => typeReferencesAlias(element, alias));
  }
}

function structFieldsReferenceAlias(fields: RustStructFields, alias: string): boolean {
  return fields.kind !== "unit" &&
    fields.fields.some((field) => typeReferencesAlias(field.type, alias));
}

function blockReferencesAlias(block: RustBlock, alias: string): boolean {
  return block.statements.some((statement) => statementReferencesAlias(statement, alias));
}

function statementReferencesAlias(statement: RustStmt, alias: string): boolean {
  switch (statement.kind) {
    case "let":
      return optionalTypeReferencesAlias(statement.type, alias) ||
        (statement.init !== undefined && expressionReferencesAlias(statement.init, alias));
    case "let-pattern":
      return patternReferencesAlias(statement.pattern, alias) ||
        expressionReferencesAlias(statement.init, alias);
    case "expr":
    case "tail": return expressionReferencesAlias(statement.expr, alias);
    case "assign":
      return expressionReferencesAlias(statement.target, alias) ||
        expressionReferencesAlias(statement.value, alias);
    case "return":
      return statement.expr !== undefined && expressionReferencesAlias(statement.expr, alias);
    case "if":
      return expressionReferencesAlias(statement.condition, alias) ||
        blockReferencesAlias(statement.then, alias) ||
        (statement.else !== undefined && blockReferencesAlias(statement.else, alias));
    case "loop": return blockReferencesAlias(statement.body, alias);
    case "while":
      return expressionReferencesAlias(statement.condition, alias) ||
        blockReferencesAlias(statement.body, alias);
    case "while-let-some":
    case "if-let-some":
      return expressionReferencesAlias(statement.expression, alias) ||
        blockReferencesAlias(statement.body, alias);
    case "for":
      return expressionReferencesAlias(statement.iterable, alias) ||
        blockReferencesAlias(statement.body, alias);
    case "break":
    case "continue": return false;
    case "completion-exit":
      return alias === "rt" ||
        (statement.expr !== undefined && expressionReferencesAlias(statement.expr, alias));
    case "resource-scope":
      return alias === "rt" || typeReferencesAlias(statement.returnType, alias) ||
        blockReferencesAlias(statement.body, alias) ||
        blockReferencesAlias(statement.cleanup, alias) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((entry) => statementReferencesAlias(entry, alias)) === true);
    case "index-assign":
      return expressionReferencesAlias(statement.receiver, alias) ||
        expressionReferencesAlias(statement.index, alias) ||
        expressionReferencesAlias(statement.value, alias);
    case "scope":
    case "unsafe-scope": return blockReferencesAlias(statement.body, alias);
    case "throw": return expressionReferencesAlias(statement.error, alias);
    case "try-scope":
      return alias === "rt" || typeReferencesAlias(statement.returnType, alias) ||
        blockReferencesAlias(statement.body, alias) ||
        (statement.catchClause !== undefined &&
          blockReferencesAlias(statement.catchClause.body, alias)) ||
        (statement.finallyClause !== undefined &&
          blockReferencesAlias(statement.finallyClause.body, alias)) ||
        statement.dispatchTargets.some((target) =>
          target.continuePrelude?.some((entry) => statementReferencesAlias(entry, alias)) === true);
  }
}

function expressionReferencesAlias(expression: RustExpr, alias: string): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "char-literal":
    case "string-literal":
    case "str-literal":
    case "unreachable": return false;
    case "path": return pathReferencesAlias(expression.path, alias);
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return expressionReferencesAlias(expression.expression, alias);
    case "unary": return expressionReferencesAlias(expression.operand, alias);
    case "dereference": return expressionReferencesAlias(expression.pointer, alias);
    case "binary":
      return expressionReferencesAlias(expression.left, alias) ||
        expressionReferencesAlias(expression.right, alias);
    case "range":
      return expressionReferencesAlias(expression.start, alias) ||
        expressionReferencesAlias(expression.end, alias);
    case "conditional":
      return expressionReferencesAlias(expression.condition, alias) ||
        expressionReferencesAlias(expression.whenTrue, alias) ||
        expressionReferencesAlias(expression.whenFalse, alias);
    case "match":
      return expressionReferencesAlias(expression.expression, alias) ||
        expression.arms.some((arm) =>
          patternReferencesAlias(arm.pattern, alias) ||
          expressionReferencesAlias(arm.expression, alias));
    case "matches":
      return expressionReferencesAlias(expression.expression, alias) ||
        patternReferencesAlias(expression.pattern, alias);
    case "assignment":
      return expressionReferencesAlias(expression.target, alias) ||
        expressionReferencesAlias(expression.value, alias);
    case "call":
      return pathReferencesAlias(expression.path, alias) ||
        genericArgumentsReferenceAlias(expression.genericArguments, alias) ||
        expression.args.some((argument) => expressionReferencesAlias(argument, alias));
    case "invoke":
      return expressionReferencesAlias(expression.callee, alias) ||
        expression.args.some((argument) => expressionReferencesAlias(argument, alias));
    case "associated-value":
      return typeReferencesAlias(expression.owner, alias) ||
        optionalTypeReferencesAlias(expression.trait, alias);
    case "associated-call":
      return typeReferencesAlias(expression.owner, alias) ||
        optionalTypeReferencesAlias(expression.trait, alias) ||
        genericArgumentsReferenceAlias(expression.genericArguments, alias) ||
        expression.args.some((argument) => expressionReferencesAlias(argument, alias));
    case "method-call":
      return expressionReferencesAlias(expression.receiver, alias) ||
        genericArgumentsReferenceAlias(expression.genericArguments, alias) ||
        expression.args.some((argument) => expressionReferencesAlias(argument, alias));
    case "field":
    case "tuple-field": return expressionReferencesAlias(expression.receiver, alias);
    case "index":
      return expressionReferencesAlias(expression.receiver, alias) ||
        expressionReferencesAlias(expression.index, alias);
    case "block":
      return expression.bindings.some((binding) =>
        optionalTypeReferencesAlias(binding.type, alias) ||
        expressionReferencesAlias(binding.value, alias)) ||
        expressionReferencesAlias(expression.value, alias);
    case "evaluate-then":
      return expressionReferencesAlias(expression.effect, alias) ||
        expressionReferencesAlias(expression.value, alias);
    case "string-concat":
      return expression.parts.some((part) => expressionReferencesAlias(part, alias));
    case "format-write":
      return expressionReferencesAlias(expression.writer, alias) ||
        expression.args.some((argument) => expressionReferencesAlias(argument, alias));
    case "reference": return expressionReferencesAlias(expression.expr, alias);
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements.some((element) => expressionReferencesAlias(element, alias));
    case "closure": return expressionReferencesAlias(expression.body, alias);
    case "closure-block": return blockReferencesAlias(expression.body, alias);
    case "await":
    case "try": return expressionReferencesAlias(expression.expr, alias);
    case "return-expression":
      return expression.expr !== undefined && expressionReferencesAlias(expression.expr, alias);
    case "struct-literal":
      return pathReferencesAlias(expression.path, alias) ||
        genericArgumentsReferenceAlias(expression.genericArguments, alias) ||
        expression.fields.some((field) => expressionReferencesAlias(field.value, alias)) ||
        (expression.base !== undefined && expressionReferencesAlias(expression.base, alias));
  }
}

function genericArgumentsReferenceAlias(
  values: readonly RustGenericArgument[] | undefined,
  alias: string,
): boolean {
  return values?.some((value) => genericArgumentReferencesAlias(value, alias)) === true;
}

function patternReferencesAlias(pattern: RustPattern, alias: string): boolean {
  switch (pattern.kind) {
    case "wildcard": return false;
    case "binding":
      return pattern.subpattern !== undefined && patternReferencesAlias(pattern.subpattern, alias);
    case "path": return pathReferencesAlias(pattern.path, alias);
    case "tuple":
      return pattern.elements.some((entry) => patternReferencesAlias(entry, alias));
    case "or":
      return pattern.patterns.some((entry) => patternReferencesAlias(entry, alias));
    case "tuple-variant":
      return pathReferencesAlias(pattern.path, alias) ||
        pattern.elements.some((entry) => patternReferencesAlias(entry, alias));
    case "struct":
      return pathReferencesAlias(pattern.path, alias) ||
        pattern.fields.some((field) => patternReferencesAlias(field.pattern, alias));
    case "slice":
      return pattern.prefix.some((entry) => patternReferencesAlias(entry, alias)) ||
        (pattern.rest !== undefined && patternReferencesAlias(pattern.rest, alias)) ||
        pattern.suffix.some((entry) => patternReferencesAlias(entry, alias));
    case "reference": return patternReferencesAlias(pattern.pattern, alias);
    case "literal": return expressionReferencesAlias(pattern.expression, alias);
  }
}

function pathReferencesAlias(path: string, alias: string): boolean {
  return path === alias || path.startsWith(`${alias}::`);
}
