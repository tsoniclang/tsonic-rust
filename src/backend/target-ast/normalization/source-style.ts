import type {
  RustBlock,
  RustExpr,
  RustGenericArgument,
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustTraitFunction,
  RustType,
  RustTypeBound,
} from "../nodes.js";
import { finalizeRustBlockLiveness } from "../inspection/source-liveness.js";
import { rustLintAttributes } from "./lint-policy.js";
import { rustBlockReferencesPath } from "../inspection/source-usage.js";

export function finalizeRustSourceStyle(
  model: RustSourceFileModel,
): RustSourceFileModel {
  const items = sortRustUseRuns(closePublicRustTypeVisibility(model.items));
  const publicTypes = publicDeclaredRustTypeNames(items);
  return {
    ...model,
    items: items.map((item) => finalizeRustItemStyle(item, publicTypes)),
  };
}

function sortRustUseRuns(items: readonly RustItem[]): readonly RustItem[] {
  const sorted: RustItem[] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.kind !== "use") {
      sorted.push(item);
      index += 1;
      continue;
    }
    const run: Extract<RustItem, { readonly kind: "use" }>[] = [];
    while (index < items.length && items[index]?.kind === "use") {
      run.push(items[index] as Extract<RustItem, { readonly kind: "use" }>);
      index += 1;
    }
    run.sort((left, right) =>
      left.path.localeCompare(right.path, "en") ||
      (left.alias ?? "").localeCompare(right.alias ?? "", "en"));
    sorted.push(...run);
  }
  return Object.freeze(sorted);
}

export function rustPublicSignatureTypeNames(model: RustSourceFileModel): readonly string[] {
  const items = closePublicRustTypeVisibility(model.items);
  const publicTypes = publicDeclaredRustTypeNames(items);
  return Object.freeze([...new Set(items.flatMap((item) =>
    publicSignatureTypes(item, publicTypes).flatMap(rustTypeNames)))].sort((left, right) =>
      left.localeCompare(right, "en")));
}

function publicDeclaredRustTypeNames(items: readonly RustItem[]): ReadonlySet<string> {
  return new Set(items.flatMap((item) =>
    (item.kind === "struct" || item.kind === "trait" || item.kind === "enum" ||
        item.kind === "type-alias") && item.visibility === "public"
      ? [item.name]
      : []));
}

function finalizeRustItemStyle(
  item: RustItem,
  publicTypes: ReadonlySet<string>,
): RustItem {
  if (item.kind === "function") {
    const attrs = item.params.length <= 7
      ? item.attrs
      : appendRustAttribute(item.attrs, rustLintAttributes.tooManyArguments);
    return { ...item, attrs, body: finalizeRustFunctionBodyStyle(item.body) };
  }
  if (item.kind === "trait") {
    return {
      ...item,
      functions: item.functions.map(finalizeRustTraitFunctionStyle),
    };
  }
  if (item.kind === "impl") {
    const publicOwner = item.target.kind === "named" && publicTypes.has(item.target.path);
    return {
      ...item,
      functions: item.functions.map((fn) =>
        finalizeRustImplFunctionStyle(fn, item.trait === undefined, publicOwner)),
    };
  }
  if (item.kind === "const" || item.kind === "thread-local") {
    return { ...item, value: finalizeRustExpressionStyle(item.value) };
  }
  return item;
}

function finalizeRustTraitFunctionStyle(fn: RustTraitFunction): RustTraitFunction {
  const argumentCount = fn.params.length + (fn.selfParam === undefined ? 0 : 1);
  const attrs = argumentCount <= 7
    ? fn.attrs
    : appendRustAttribute(fn.attrs, rustLintAttributes.tooManyArguments);
  return {
    ...fn,
    ...(attrs === undefined ? {} : { attrs }),
    ...(fn.body === undefined ? {} : { body: finalizeRustFunctionBodyStyle(fn.body) }),
  };
}

function finalizeRustImplFunctionStyle(
  fn: RustImplFunction,
  inherent: boolean,
  publicOwner: boolean,
): RustImplFunction {
  let attrs = fn.attrs;
  const argumentCount = fn.params.length + (fn.selfParam === undefined ? 0 : 1);
  if (inherent && argumentCount > 7) {
    attrs = appendRustAttribute(attrs, rustLintAttributes.tooManyArguments);
  }
  if (inherent && fn.name === "to_string" && fn.selfParam !== undefined &&
    fn.params.length === 0 && fn.returnType?.kind === "string") {
    attrs = appendRustAttribute(attrs, rustLintAttributes.inherentToString);
  }
  if (inherent && publicOwner && fn.visibility === "public" && fn.name === "next" &&
    fn.selfParam !== undefined && fn.params.length === 0) {
    attrs = appendRustAttribute(attrs, rustLintAttributes.shouldImplementTrait);
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
      if (rustConditionPrintsAsBlock(condition)) {
        attrs = appendRustAttribute(attrs, rustLintAttributes.blocksInConditions);
      }
      const nested = then.statements.length === 1 ? then.statements[0] : undefined;
      if (otherwise === undefined && nested?.kind === "if" && nested.else === undefined) {
        attrs = appendRustAttribute(attrs, rustLintAttributes.collapsibleIf);
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
      const attrs = rustConditionPrintsAsBlock(condition)
        ? appendRustAttribute(statement.attrs, rustLintAttributes.blocksInConditions)
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
      if (!rustBlockReferencesPath(body, statement.binding) &&
        statement.binding !== "_" && !statement.binding.startsWith("_")) {
        attrs = appendRustAttribute(attrs, rustLintAttributes.unusedVariables);
      }
      const finalStatement = body.statements[body.statements.length - 1];
      if (finalStatement?.kind === "break" && finalStatement.label === statement.label &&
        !rustBlockMayContinueLoop(body, statement.label)) {
        attrs = appendRustAttribute(attrs, rustLintAttributes.neverLoop);
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
        ...(statement.else === undefined
          ? {}
          : { else: finalizeRustBlockStyle(statement.else) }),
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

function rustConditionPrintsAsBlock(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "block":
    case "evaluate-then":
      return true;
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return rustConditionPrintsAsBlock(expression.expression);
    case "try":
    case "await":
      return rustConditionPrintsAsBlock(expression.expr);
    default:
      return false;
  }
}

function rustBlockMayContinueLoop(block: RustBlock, label: string | undefined): boolean {
  return block.statements.some((statement) => rustStatementMayContinueLoop(statement, label));
}

function rustStatementMayContinueLoop(statement: RustStmt, label: string | undefined): boolean {
  switch (statement.kind) {
    case "continue":
      return statement.label === label;
    case "if":
      return rustBlockMayContinueLoop(statement.then, label) ||
        (statement.else !== undefined && rustBlockMayContinueLoop(statement.else, label));
    case "if-let-some":
      return rustBlockMayContinueLoop(statement.body, label) ||
        (statement.else !== undefined && rustBlockMayContinueLoop(statement.else, label));
    case "scope":
    case "unsafe-scope":
      return rustBlockMayContinueLoop(statement.body, label);
    case "resource-scope":
      return rustBlockMayContinueLoop(statement.body, label) ||
        rustBlockMayContinueLoop(statement.cleanup, label);
    case "try-scope":
      return rustBlockMayContinueLoop(statement.body, label) ||
        (statement.catchClause !== undefined &&
          rustBlockMayContinueLoop(statement.catchClause.body, label)) ||
        (statement.finallyClause !== undefined &&
          rustBlockMayContinueLoop(statement.finallyClause.body, label));
    case "loop":
    case "while":
    case "while-let-some":
    case "for":
      return label !== undefined && rustBlockMayContinueLoop(statement.body, label);
    case "let":
    case "expr":
    case "assign":
    case "return":
    case "tail":
    case "break":
    case "completion-exit":
    case "index-assign":
    case "throw":
      return false;
  }
}

function finalizeRustExpressionStyle(expression: RustExpr): RustExpr {
  let result: RustExpr;
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "char-literal":
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
    case "macro-invocation":
      result = { ...expression, args: expression.args.map(finalizeRustExpressionStyle) };
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
        ...(expression.base === undefined
          ? {}
          : { base: finalizeRustExpressionStyle(expression.base) }),
      };
      break;
    case "tuple-literal":
      result = { ...expression, elements: expression.elements.map(finalizeRustExpressionStyle) };
      break;
  }
  return result;
}

function closePublicRustTypeVisibility(items: readonly RustItem[]): readonly RustItem[] {
  const localTypes = new Set(items.flatMap((item) =>
    item.kind === "struct" || item.kind === "enum" || item.kind === "trait" ||
        item.kind === "type-alias"
      ? [item.name]
      : []));
  const publicTypes = new Set(items.flatMap((item) =>
    (item.kind === "struct" || item.kind === "enum" || item.kind === "trait" ||
        item.kind === "type-alias") && item.visibility === "public"
      ? [item.name]
      : []));
  for (;;) {
    const required = new Set<string>();
    for (const item of items) {
      for (const type of publicSignatureTypes(item, publicTypes)) {
        collectLocalRustTypeNames(type, localTypes, required);
      }
    }
    const additions = [...required].filter((name) => !publicTypes.has(name));
    if (additions.length === 0) {
      break;
    }
    for (const name of additions) {
      publicTypes.add(name);
    }
  }
  return items.map((item) =>
    (item.kind === "struct" || item.kind === "enum" || item.kind === "trait" ||
        item.kind === "type-alias") && publicTypes.has(item.name) &&
        item.visibility !== "public"
      ? { ...item, visibility: "public" }
      : item);
}

function publicSignatureTypes(
  item: RustItem,
  publicTypes: ReadonlySet<string>,
): readonly RustType[] {
  switch (item.kind) {
    case "function":
      return item.visibility === "public"
        ? [...item.params.map((parameter) => parameter.type), ...optionalType(item.returnType)]
        : [];
    case "const":
    case "thread-local":
      return item.visibility === "public" ? [item.type] : [];
    case "struct":
      return publicTypes.has(item.name)
        ? item.fields.filter((field) => field.visibility === "public").map((field) => field.type)
        : [];
    case "enum":
      return publicTypes.has(item.name)
        ? item.variants.flatMap((variant) => variant.fields ?? [])
        : [];
    case "trait":
      return publicTypes.has(item.name)
        ? [
            ...(item.superTraits ?? []),
            ...item.functions.flatMap((fn) => [
              ...fn.params.map((parameter) => parameter.type),
              ...optionalType(fn.returnType),
            ]),
          ]
        : [];
    case "impl":
      return rustTypeNames(item.target).some((name) => publicTypes.has(name))
        ? item.functions.flatMap((fn) => fn.visibility === "public"
          ? [
              ...fn.params.map((parameter) => parameter.type),
              ...optionalType(fn.returnType),
            ]
          : [])
        : [];
    case "type-alias":
      return publicTypes.has(item.name) ? [item.target] : [];
    case "mod-decl":
    case "extern-crate":
    case "use":
      return [];
  }
}

function optionalType(type: RustType | undefined): readonly RustType[] {
  return type === undefined ? [] : [type];
}

function collectLocalRustTypeNames(
  type: RustType,
  localTypes: ReadonlySet<string>,
  result: Set<string>,
): void {
  for (const name of rustTypeNames(type)) {
    if (localTypes.has(name)) {
      result.add(name);
    }
  }
}

function rustTypeNames(type: RustType): readonly string[] {
  switch (type.kind) {
    case "infer":
      return [];
    case "named":
      return [
        type.path,
        ...rustGenericArgumentTypeNames(type.genericArguments),
      ];
    case "qualified":
      return [
        ...rustTypeNames(type.owner),
        ...(type.trait === undefined ? [] : rustTypeNames(type.trait)),
        ...rustGenericArgumentTypeNames(type.genericArguments),
      ];
    case "trait-object":
      return [
        ...rustTypeNames(type.principal.trait),
        ...type.autoTraits.flatMap((trait) => rustTypeNames(trait.trait)),
      ];
    case "impl-trait":
      return [
        ...type.bounds.flatMap(rustTypeBoundNames),
        ...rustGenericArgumentTypeNames(type.captures),
      ];
    case "reference":
      return rustTypeNames(type.referent);
    case "raw-pointer":
      return rustTypeNames(type.pointee);
    case "fixed-array":
    case "slice":
      return rustTypeNames(type.element);
    case "function-pointer":
      return [...type.parameters.flatMap(rustTypeNames), ...rustTypeNames(type.result)];
    case "tuple":
      return type.elements.flatMap(rustTypeNames);
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return [];
  }
}

function rustTypeBoundNames(bound: RustTypeBound): readonly string[] {
  switch (bound.kind) {
    case "trait":
      return [bound.path];
    case "trait-type":
      return rustTypeNames(bound.reference.trait);
    case "callable":
      return [
        ...bound.parameters.flatMap(rustTypeNames),
        ...rustTypeNames(bound.result),
      ];
    case "lifetime":
    case "maybe-sized":
      return [];
  }
}

function rustGenericArgumentTypeNames(
  arguments_: readonly RustGenericArgument[] | undefined,
): readonly string[] {
  return (arguments_ ?? []).flatMap((argument) => {
    switch (argument.kind) {
      case "type":
        return rustTypeNames(argument.type);
      case "associated-equality":
        return [
          ...rustGenericArgumentTypeNames(argument.genericArguments),
          ...rustTypeNames(argument.type),
        ];
      case "associated-bounds":
        return [
          ...rustGenericArgumentTypeNames(argument.genericArguments),
          ...argument.bounds.flatMap((bound) =>
            bound.kind === "trait-type"
              ? rustTypeNames(bound.reference.trait)
              : bound.kind === "callable"
                ? [
                    ...bound.parameters.flatMap(rustTypeNames),
                    ...rustTypeNames(bound.result),
                  ]
                : []),
        ];
      case "lifetime":
      case "const":
        return [];
    }
  });
}

function appendRustAttribute(
  attrs: readonly string[] | undefined,
  attribute: string,
): readonly string[] {
  return attrs?.includes(attribute) === true
    ? attrs
    : [...attrs ?? [], attribute];
}
