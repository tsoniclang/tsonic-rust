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
import { firstAccessesInStatements, hasUnobservedFinalPathWrite, maxWritesInStatements } from "../inspection/source-dataflow.js";
import { rustLintAttributes } from "./lint-policy.js";
import { rustBlockReferencesPath, rustBlockBreaksToLabel, rustExpressionReferencesPath, rustExpressionChildren, rustStatementExpressions } from "../inspection/source-usage.js";
import { collapseRustForwardingClosure } from "./forwarding-closures.js";
import { nameRustSignatureTypes } from "./signature-aliases.js";
import type { RustNamedSignatureScope } from "./signature-aliases.js";
import { closePublicRustTypeVisibility, publicDeclaredRustTypeNames } from "./signature-visibility.js";
import { rustItemsReferenceModuleAlias } from "../inspection/source-module-usage.js";
import { rustTypeEquals } from "../inspection/type-equality.js";
import { mergeRustAdjacentConditionalBranches, simplifyRustBooleanConditional } from "./conditional-branches.js";
import { normalizeRustOptionalUnitMatch } from "./option-conditionals.js";
import { mapRustExpressionChildren } from "../expression-children.js";
import { lowerRustCompletionScope } from "./completion-regions.js";
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
    item = finalizeRustParameterMutability(item);
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
  if (body !== undefined) fn = finalizeRustParameterMutability({ ...fn, body });
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
  fn = finalizeRustParameterMutability(fn);
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

function finalizeRustParameterMutability<Function extends Pick<RustImplFunction, "params" | "body">>(fn: Function): Function {
  return { ...fn, params: fn.params.map(parameter => parameter.mutable &&
    maxWritesInStatements(fn.body.statements, parameter.name) === 0
      ? { ...parameter, mutable: false } : parameter) };
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
    return accesses.has("write") && !accesses.has("read") || hasUnobservedFinalPathWrite(fn.body.statements, parameter.name);
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
      const consequent = then.statements.length === 1 ? then.statements[0] : undefined;
      const alternative = otherwise?.statements.length === 1 ? otherwise.statements[0] : undefined;
      if ((consequent?.kind === "return" || consequent?.kind === "tail") && alternative?.kind === consequent.kind &&
        consequent.expr !== undefined && alternative.expr !== undefined &&
        (then.innerAttrs?.length ?? 0) === 0 && (otherwise?.innerAttrs?.length ?? 0) === 0 &&
        (statement.attrs?.length ?? 0) === 0) {
        const returned = simplifyRustBooleanConditional(condition, consequent.expr, alternative.expr);
        if (returned !== undefined) return { kind: consequent.kind, expr: returned };
      }
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

    case "break":
    case "continue":
      return statement;
    case "completion-exit":
      return statement.expr === undefined
        ? statement
        : { ...statement, expr: finalizeRustExpressionStyle(statement.expr) };
    case "resource-scope":
      return finalizeRustStatementStyle(lowerRustCompletionScope(statement));
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
      return finalizeRustStatementStyle(lowerRustCompletionScope(statement));
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
      return rustStatementExpressions(statement).some(expression => rustExpressionMayContinueLoop(expression, label));
  }
}

function rustExpressionMayContinueLoop(expression: RustExpr, label: string | undefined): boolean {
  if (expression.kind === "closure" || expression.kind === "closure-block" || expression.kind === "async-block") return false;
  if (expression.kind === "block") return rustBlockMayContinueLoop(expression.body, label);
  return rustExpressionChildren(expression).some(child => rustExpressionMayContinueLoop(child, label));
}

function finalizeRustExpressionStyle(expression: RustExpr): RustExpr {
  requiresNamingAllowance ||= rustExpressionDeclaresNonSnakeName(expression);
  const result = mapRustExpressionChildren(expression, finalizeRustExpressionStyle, finalizeRustFunctionBodyStyle);
  switch (result.kind) {
    case "block":
      if (result.label !== undefined) {
        const statements = result.body.statements;
        const last = statements[statements.length - 1];
        if ((last?.kind === "tail" || last?.kind === "expr") && last.expr.kind === "break-expression" &&
          last.expr.label === result.label &&
          (last.expr.expr === undefined || !rustBlockBreaksToLabel({ statements: [{ kind: "expr", expr: last.expr.expr }] }, result.label)) &&
          !rustBlockBreaksToLabel({ statements: statements.slice(0, -1) }, result.label)) {
          const value = last.expr.expr ?? { kind: "tuple-literal" as const, elements: [] };
          return statements.length === 1 && (result.body.innerAttrs?.length ?? 0) === 0 ? value
            : { kind: "block", body: { ...result.body, statements: [...statements.slice(0, -1), { kind: "tail", expr: value }] } };
        }
      }
      if (result.label === undefined || rustBlockBreaksToLabel(result.body, result.label)) return result;
      return { kind: "block", body: result.body };
    case "binary":
      if (result.left.kind === "bool-literal" && (result.operator === "&&" || result.operator === "||")) {
        return (result.operator === "&&" ? result.left.value : !result.left.value) ? result.right : result.left;
      }
      return result;
    case "conditional": {
      const { condition, whenTrue, whenFalse } = result;
      if (whenTrue.kind === "none" && whenFalse.kind === "none" ||
        whenTrue.kind === "associated-value" && whenFalse.kind === "associated-value" &&
        whenTrue.name === whenFalse.name && rustTypeEquals(whenTrue.owner, whenFalse.owner) &&
        rustTypeEquals(whenTrue.trait, whenFalse.trait) ||
        whenTrue.kind === "tuple-literal" && whenTrue.elements.length === 0 &&
        whenFalse.kind === "tuple-literal" && whenFalse.elements.length === 0) {
        return { kind: "evaluate-then", effect: condition, discard: "value", value: whenTrue };
      }
      return simplifyRustBooleanConditional(condition, whenTrue, whenFalse) ??
        mergeRustAdjacentConditionalBranches(condition, whenTrue, whenFalse) ?? result;
    }
    case "match": return normalizeRustOptionalUnitMatch(result);
    case "evaluate-then": return result.effect.kind === "tuple-literal" && result.effect.elements.length === 0
      ? result.value : result;
    case "closure": return collapseRustForwardingClosure({ ...result,
      params: result.params.map(parameter => closureParameter(parameter,
        rustExpressionReferencesPath(result.body, parameter.name))) });
    case "closure-block": return { ...result,
      params: result.params.map(parameter => closureParameter(parameter,
        rustBlockReferencesPath(result.body, parameter.name))) };
    default: return result;
  }
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
