import { type RustAttribute } from "../attributes.js";
import type {
  RustBlock,
  RustExpr,
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
  RustStmt,
  RustTraitFunction,
  RustType,
} from "../nodes.js";
import { finalizeRustBlockLiveness } from "../inspection/source-liveness.js";
import { firstAccessesInStatements } from "../inspection/source-dataflow.js";
import { rustLintAttributes } from "./lint-policy.js";
import { rustBlockReferencesPath, rustExpressionReferencesPath } from "../inspection/source-usage.js";
import { collapseRustForwardingClosure } from "./forwarding-closures.js";
import { nameRustSignatureTypes } from "./signature-aliases.js";
import type { RustNamedSignatureScope } from "./signature-aliases.js";
import { closePublicRustTypeVisibility, publicDeclaredRustTypeNames } from "./signature-visibility.js";
import { rustItemsReferenceModuleAlias } from "../inspection/source-module-usage.js";
import { rustTypeEquals } from "../inspection/type-equality.js";
import { mergeRustAdjacentConditionalBranches } from "./conditional-branches.js";
import { appendRustNamingAllowance, finalizeRustFunctionNames, finalizeRustItemNames,
  rustExpressionDeclaresNonSnakeName, rustStatementDeclaresNonSnakeName } from "./authored-names.js";

export function finalizeRustSourceStyle(
  model: RustSourceFileModel,
): RustSourceFileModel {
  const scope = finalizeRustItemScope(model.items);
  return { ...model, items: [...scope.aliases, ...scope.items] };
}

function finalizeRustItemScope(source: readonly RustItem[]): RustNamedSignatureScope {
  const named = nameRustSignatureTypes(source, (fn, nameType) => {
    const styler = createRustBodyStyler(nameType);
    const body = styler.block(fn.body);
    return { ...fn, body, ...(styler.requiresNamingAllowance()
      ? { attrs: appendRustNamingAllowance(fn.attrs, "snake") } : {}) };
  });
  const items = closePublicRustTypeVisibility([...named.aliases, ...named.items]);
  const publicTypes = publicDeclaredRustTypeNames(items);
  const styled = items.map(item => finalizeRustItemStyle(item, publicTypes));
  return { aliases: styled.slice(0, named.aliases.length), items: styled.slice(named.aliases.length) };
}


function finalizeRustItemStyle(
  item: RustItem,
  publicTypes: ReadonlySet<string>,
): RustItem {
  item = finalizeRustItemNames(item);
  if (item.kind === "mod-decl" && item.body !== undefined) return { ...item, body: finalizeRustSourceStyle(item.body) };
  if (item.kind === "function") {
    let attrs = item.params.length <= 7
      ? item.attrs
      : appendRustAttribute(item.attrs, rustLintAttributes.tooManyArguments);
    if (hasErasedGenericParameter(item)) attrs = appendRustAttribute(attrs, rustLintAttributes.unusedTypeParameters);
    if (hasUnusedParameter(item)) attrs = appendRustAttribute(attrs, rustLintAttributes.unusedVariables);
    if (hasOverwrittenParameter(item)) attrs = appendRustAttribute(attrs, rustLintAttributes.unusedAssignments);
    return { ...item, attrs };
  }
  if (item.kind === "trait") {
    return {
      ...item,
      members: item.members.map(member => member.kind === "function" ? finalizeRustTraitFunctionStyle(member) : member),
    };
  }
  if (item.kind === "impl") {
    const publicOwner = item.target.kind === "named" && publicTypes.has(item.target.path);
    return {
      ...item,
      members: item.members.map(member => member.kind === "function"
        ? finalizeRustImplFunctionStyle(member, item.trait === undefined, publicOwner) : member),
    };
  }
  if (item.kind === "const" || item.kind === "thread-local") {
    const styler = createRustBodyStyler();
    const value = styler.expression(item.value);
    return { ...item, value, ...(styler.requiresNamingAllowance()
      ? { attrs: appendRustNamingAllowance(item.attrs, "snake") } : {}) };
  }
  return item;
}

function finalizeRustTraitFunctionStyle(fn: RustTraitFunction): RustTraitFunction {
  fn = finalizeRustFunctionNames(fn);
  const argumentCount = fn.params.length + (fn.selfParam === undefined ? 0 : 1);
  let attrs = argumentCount <= 7
    ? fn.attrs
    : appendRustAttribute(fn.attrs, rustLintAttributes.tooManyArguments);
  const styler = createRustBodyStyler();
  const body = fn.body === undefined ? undefined : styler.block(fn.body);
  if (styler.requiresNamingAllowance()) attrs = appendRustNamingAllowance(attrs, "snake");
  if (body !== undefined && hasUnusedParameter({ ...fn, body })) {
    attrs = appendRustAttribute(attrs, rustLintAttributes.unusedVariables);
  }
  if (body !== undefined && hasOverwrittenParameter({ ...fn, body })) {
    attrs = appendRustAttribute(attrs, rustLintAttributes.unusedAssignments);
  }
  return {
    ...fn,
    ...(attrs === undefined ? {} : { attrs }),
    ...(body === undefined ? {} : { body }),
  };
}

function finalizeRustImplFunctionStyle(
  fn: RustImplFunction,
  inherent: boolean,
  publicOwner: boolean,
): RustImplFunction {
  fn = finalizeRustFunctionNames(fn, inherent);
  let attrs = fn.attrs;
  if (hasUnusedParameter(fn)) attrs = appendRustAttribute(attrs, rustLintAttributes.unusedVariables);
  if (hasOverwrittenParameter(fn)) attrs = appendRustAttribute(attrs, rustLintAttributes.unusedAssignments);
  if (inherent && hasErasedGenericParameter(fn)) attrs = appendRustAttribute(attrs, rustLintAttributes.unusedTypeParameters);
  const argumentCount = fn.params.length + (fn.selfParam === undefined ? 0 : 1);
  if (inherent && argumentCount > 7) {
    attrs = appendRustAttribute(attrs, rustLintAttributes.tooManyArguments);
  }
  if (inherent && fn.name === "to_string" && fn.selfParam !== undefined &&
    fn.params.length === 0 && fn.returnType?.kind === "string") {
    attrs = appendRustAttribute(attrs, rustLintAttributes.inherentToString);
  }
  if (inherent && publicOwner && fn.visibility === "public" && fn.name === "next" &&
    fn.selfParam?.kind === "reference" && fn.selfParam.mutable && fn.params.length === 0) {
    attrs = appendRustAttribute(attrs, rustLintAttributes.shouldImplementTrait);
  }
  return { ...fn, attrs };
}

function hasErasedGenericParameter(fn: RustImplFunction): boolean {
  const usage: RustItem = { ...fn, kind: "function" };
  return fn.generics.parameters.some(parameter => parameter.kind === "type" &&
    !rustItemsReferenceModuleAlias([usage], parameter.name));
}

function hasUnusedParameter(fn: Pick<RustImplFunction, "params" | "body">): boolean {
  return fn.params.some(parameter => !parameter.name.startsWith("_") &&
    !rustBlockReferencesPath(fn.body, parameter.name));
}

function hasOverwrittenParameter(fn: Pick<RustImplFunction, "params" | "body">): boolean {
  return fn.params.some(parameter => {
    if (!parameter.mutable || parameter.name.startsWith("_")) return false;
    const accesses = firstAccessesInStatements(fn.body.statements, parameter.name);
    return accesses.has("write") && !accesses.has("read");
  });
}

function createRustBodyStyler(nameType?: (type: RustType, role: string) => RustType): {
  readonly block: (block: RustBlock) => RustBlock;
  readonly expression: (expression: RustExpr) => RustExpr;
  readonly requiresNamingAllowance: () => boolean;
} {
  let requiresNamingAllowance = false;
  return { block: finalizeRustFunctionBodyStyle, expression: finalizeRustExpressionStyle,
    requiresNamingAllowance: () => requiresNamingAllowance };

function finalizeRustFunctionBodyStyle(block: RustBlock): RustBlock {
  return finalizeRustBlockLiveness(finalizeRustBlockStyle(block));
}

function finalizeRustBlockStyle(block: RustBlock): RustBlock {
  const localItems = block.statements.flatMap(statement => statement.kind === "item" ? [statement.item] : []);
  const scope = finalizeRustItemScope(localItems);
  let nextItem = 0;
  const retainsFieldAssignment = block.statements.some((statement, index) => {
      const previous = block.statements[index - 1];
      return previous?.kind === "let" && previous.init?.kind === "associated-call" &&
        previous.init.trait?.kind === "named" && previous.init.trait.path === "core::default::Default" &&
        previous.init.method === "default" && previous.init.args.length === 0 &&
        statement.kind === "assign" && statement.operator === "=" && statement.target.kind === "field" &&
        statement.target.receiver.kind === "path" && statement.target.receiver.path === previous.name &&
        !rustBlockReferencesPath({ statements: [{ kind: "expr", expr: statement.value }] }, previous.name);
  });
  return {
    ...block,
    ...(retainsFieldAssignment ? { innerAttrs: appendRustAttribute(block.innerAttrs, rustLintAttributes.fieldReassignWithDefault) } : {}),
    statements: [
      ...scope.aliases.map((item): RustStmt => ({ kind: "item", item })),
      ...block.statements.map(statement => statement.kind === "item"
        ? { ...statement, item: scope.items[nextItem++]! }
        : finalizeRustStatementStyle(statement)),
    ],
  };
}

function finalizeRustStatementStyle(statement: RustStmt): RustStmt {
  requiresNamingAllowance ||= rustStatementDeclaresNonSnakeName(statement);
  switch (statement.kind) {
    case "item":
      return statement;
    case "let":
      return { ...statement,
        ...(statement.type === undefined || nameType === undefined ? {} : { type: nameType(statement.type, statement.name) }),
        ...(statement.init === undefined ? {} : { init: finalizeRustExpressionStyle(statement.init) }),
      };
    case "expr":
    case "tail": {
      const expression = finalizeRustExpressionStyle(statement.expr);
      if (expression.kind === "match" && expression.arms.length === 2) {
        const [present, absent] = expression.arms;
        const binding = present!.pattern.kind === "tuple-variant" && present!.pattern.path === "Some" &&
          present!.pattern.elements.length === 1 ? present!.pattern.elements[0] : undefined;
        if (binding?.kind === "binding" && absent!.pattern.kind === "path" && absent!.pattern.path === "None" &&
          absent!.expression.kind === "tuple-literal" && absent!.expression.elements.length === 0) {
          return { kind: "if-let-some", binding: binding.name, expression: expression.expression,
            body: { statements: [{ kind: "expr", expr: present!.expression }] } };
        }
      }
      return { ...statement, expr: expression };
    }
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
    case "if": {
      const condition = finalizeRustExpressionStyle(statement.condition);
      const then = finalizeRustBlockStyle(statement.then);
      const otherwise = statement.else === undefined
        ? undefined
        : finalizeRustBlockStyle(statement.else);
      let attrs = statement.attrs;
      if (condition.kind === "binary" && (condition.operator === "==" || condition.operator === "!=") &&
        condition.left.kind === "path" && condition.right.kind === "path" && condition.left.path === condition.right.path) {
        attrs = appendRustAttribute(attrs, rustLintAttributes.reflexiveComparison);
      }
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
    case "option-try":
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
    case "item":
      return false;
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
  requiresNamingAllowance ||= rustExpressionDeclaresNonSnakeName(expression);
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
    case "binary": {
      const left = finalizeRustExpressionStyle(expression.left);
      const right = finalizeRustExpressionStyle(expression.right);
      if (left.kind === "bool-literal" && (expression.operator === "&&" || expression.operator === "||")) {
        return (expression.operator === "&&" ? left.value : !left.value) ? right : left;
      }
      result = {
        ...expression,
        left,
        right,
      };
      break;
    }
    case "range":
      result = {
        ...expression,
        start: finalizeRustExpressionStyle(expression.start),
        end: finalizeRustExpressionStyle(expression.end),
      };
      break;
    case "conditional": {
      const whenTrue = finalizeRustExpressionStyle(expression.whenTrue);
      const whenFalse = finalizeRustExpressionStyle(expression.whenFalse);
      const condition = finalizeRustExpressionStyle(expression.condition);
      if (whenTrue.kind === "none" && whenFalse.kind === "none" ||
        whenTrue.kind === "associated-value" && whenFalse.kind === "associated-value" &&
        whenTrue.name === whenFalse.name && rustTypeEquals(whenTrue.owner, whenFalse.owner) &&
        rustTypeEquals(whenTrue.trait, whenFalse.trait) ||
        whenTrue.kind === "tuple-literal" && whenTrue.elements.length === 0 &&
        whenFalse.kind === "tuple-literal" && whenFalse.elements.length === 0) {
        return { kind: "evaluate-then", effect: condition, discard: "value", value: whenTrue };
      }
      result = mergeRustAdjacentConditionalBranches(condition, whenTrue, whenFalse) ?? {
        ...expression,
        condition,
        whenTrue,
        whenFalse,
      };
      break;
    }
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
    case "option-presence":
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
          ...(binding.type === undefined || nameType === undefined ? {} : { type: nameType(binding.type, binding.name) }),
          ...(binding.value === undefined ? {} : { value: finalizeRustExpressionStyle(binding.value) }),
        })),
        value: finalizeRustExpressionStyle(expression.value),
      };
      break;
    case "unsafe":
      result = { ...expression, expression: finalizeRustExpressionStyle(expression.expression) };
      break;
    case "evaluate-then":
      if (expression.discard === "unit" &&
        expression.effect.kind === "tuple-literal" && expression.effect.elements.length === 0) {
        return finalizeRustExpressionStyle(expression.value);
      }
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
    case "array-repeat":
      result = { ...expression, element: finalizeRustExpressionStyle(expression.element) };
      break;
    case "closure":
      result = collapseRustForwardingClosure({ ...expression,
        params: expression.params.map(parameter => closureParameter(parameter,
          rustExpressionReferencesPath(expression.body, parameter.name))),
        body: finalizeRustExpressionStyle(expression.body) });
      break;
    case "closure-block":
      result = { ...expression,
        params: expression.params.map(parameter => closureParameter(parameter,
          rustBlockReferencesPath(expression.body, parameter.name))),
        body: finalizeRustFunctionBodyStyle(expression.body) };
      break;
    case "await":
    case "option-try":
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

}

function closureParameter<Parameter extends { readonly name: string; readonly attrs?: readonly RustAttribute[] }>(
  parameter: Parameter, used: boolean,
): Parameter {
  return used || parameter.name.startsWith("_") ? parameter : {
    ...parameter, attrs: appendRustAttribute(parameter.attrs, rustLintAttributes.unusedVariables),
  };
}


function appendRustAttribute(
  attrs: readonly RustAttribute[] | undefined,
  attribute: RustAttribute,
): readonly RustAttribute[] {
  return attrs?.includes(attribute) === true
    ? attrs
    : [...attrs ?? [], attribute];
}
