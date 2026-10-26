import type { RustBlock, RustExpr, RustPattern, RustStmt, RustType } from "../syntax/nodes.js";
import { mapRustExpressionChildren } from "../syntax/expression-children.js";
import { failRustSyntaxInvariant } from "../syntax/invariants.js";
import { applyRustTailShape } from "./block-flow.js";
import { rustLintAttributes } from "./lint-policy.js";
import { rustTypeEquals } from "../syntax/type-equality.js";

type CompletionScope = Extract<RustStmt, { readonly kind: "try-scope" | "resource-scope" }>;
const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });
const unit = (): RustExpr => ({ kind: "tuple-literal", elements: [] });

export function lowerRustCompletionScope(scope: CompletionScope): RustStmt {
  if (typeof scope.dispatchResultWrapped !== "boolean")
    failRustSyntaxInvariant("Completion dispatch requires its exact nearest return-result shape.");
  if (!("errorType" in scope) || scope.kind === "try-scope" &&
    (!("bodyErrorType" in scope) || scope.catchClause !== undefined && !("errorType" in scope.catchClause) ||
      scope.finallyClause !== undefined && !("errorType" in scope.finallyClause))) {
    failRustSyntaxInvariant("Completion regions require explicit exact error types or explicit pure contracts.");
  }
  const normalBindings = scope.kind === "try-scope" ? scope.normalBindings ?? [] : [];
  const normalType: RustType = normalBindings.length === 0 ? { kind: "unit" }
    : { kind: "tuple", elements: normalBindings.map(declaration => declaration.type!) };
  const completionType: RustType = { kind: "named", path: "rt::Completion",
    genericArguments: [{ kind: "type", type: scope.returnType }, { kind: "type", type: normalType }] };
  const unitCompletionType: RustType = { ...completionType,
    genericArguments: [{ kind: "type", type: scope.returnType }, { kind: "type", type: { kind: "unit" } }] };
  const normal = (): RustExpr => call("rt::Completion::Normal", normalBindings.length === 0 ? unit()
    : { kind: "tuple-literal", elements: normalBindings.map(declaration => path(declaration.name)) });
  const resultType = (type: RustType, errorType: RustType | undefined): RustType => errorType === undefined ? type
    : { kind: "named", path: "core::result::Result",
      genericArguments: [{ kind: "type", type }, { kind: "type", type: errorType }] };
  const capture = (name: string, body: RustBlock, errorType: RustType | undefined, terminates: boolean, type: RustType = completionType,
    normal: RustExpr = call("rt::Completion::Normal", unit()),
    bindings: readonly Extract<RustStmt, { readonly kind: "let" }>[] = []): RustStmt => {
    const ownedBody = { ...body, statements: [
      ...bindings,
      ...body.statements] };
    const lowered = lowerRegion(ownedBody, scope.asynchronous ? undefined : name);
    const region = { ...ownedBody, statements: [
      ...lowered.body.statements,
      ...(terminates ? [] : [{ kind: "tail" as const, expr: errorType === undefined ? normal : call("Ok", normal) }])] };
    // A region that is exactly its exit value (a lone tail, or one break to its own label with a value) is that
    // value: `'l: { break 'l v; }` is clippy::diverging_sub_expression (syntax only).
    const [only] = region.statements;
    const direct = scope.asynchronous || region.statements.length !== 1 ? undefined
      : only?.kind === "tail" && !lowered.breaksToLabel ? only.expr
      : only?.kind === "expr" && only.expr.kind === "break-expression" && only.expr.label === name ? only.expr.expr : undefined;
    return { kind: "let", name, mutable: false, type: resultType(type, errorType),
      init: direct ?? (scope.asynchronous
        ? { kind: "await", expr: { kind: "async-block", move: false, body: applyRustTailShape(region, true, new Set()) } }
        : { kind: "block", ...(lowered.breaksToLabel ? { label: name } : {}), body: region }) };
  };
  const statements: RustStmt[] = [];
  if (scope.kind === "try-scope") {
    statements.push(capture(scope.bodyName, scope.body, scope.bodyErrorType, scope.bodyTerminates,
      completionType, normal(), scope.bodyBindings ?? []));
    const caught = scope.catchClause;
    if (caught !== undefined && scope.bodyErrorType === undefined) {
      failRustSyntaxInvariant("A catch completion requires an exact body error type.");
    }
    let errorType = caught === undefined ? scope.bodyErrorType : caught.errorType;
    statements.push({ kind: "let", name: scope.flowName, mutable: false,
      // A catch without a variable matches `Err(_)`, and an authored `_name` binding is exempt: neither triggers
      // unused_variables.
      ...(caught?.bindingUsed === false && !caught.binding.startsWith("_") ? { attrs: [rustLintAttributes.unusedVariables] } : {}),
      type: resultType(completionType, errorType),
      init: caught === undefined ? path(scope.bodyName) : { kind: "match", expression: path(scope.bodyName), arms: [
        { pattern: variant("Ok", binding("completion")), expression: caught.errorType === undefined
          ? path("completion") : call("Ok", path("completion")) },
        { pattern: variant("Err", binding(caught.binding)), expression: {
          kind: "block", body: { statements: [capture(scope.flowName, caught.body, caught.errorType, caught.terminates,
            completionType, normal(), caught.bindings ?? []),
            { kind: "tail", expr: path(scope.flowName) }] },
        } },
      ] } });
    const finalized = scope.finallyClause;
    if (finalized !== undefined) {
      if (scope.finallyName === undefined) failRustSyntaxInvariant("Finalized completion requires its exact hygienic capture identity.");
      if (errorType !== undefined && finalized.errorType !== undefined && !rustTypeEquals(errorType, finalized.errorType)) {
        failRustSyntaxInvariant("Finally completion requires one exact joined error type.");
      }
      const joinedErrorType = errorType ?? finalized.errorType;
      statements.push(capture(scope.finallyName, finalized.body, finalized.errorType, finalized.terminates, unitCompletionType));
      statements.push({ kind: "let", name: scope.flowName, mutable: false,
        type: resultType(completionType, joinedErrorType),
        init: joinedErrorType !== undefined
          ? call("rt::finish_finally", errorType === undefined ? call("Ok", path(scope.flowName)) : path(scope.flowName),
            finalized.errorType === undefined ? call("Ok", path(scope.finallyName)) : path(scope.finallyName))
          : { kind: "match", expression: path(scope.finallyName), arms: [
            { pattern: variant("rt::Completion::Normal", { kind: "wildcard" }), expression: path(scope.flowName) },
            ...abruptVariants(false),
          ] } });
      errorType = joinedErrorType;
    }
    if (errorType !== undefined) {
      if (!rustTypeEquals(errorType, scope.errorType)) {
        failRustSyntaxInvariant("Completion propagation requires the exact enclosing error type.");
      }
      statements.push(unwrap(scope.flowName, errorType));
    }
  } else {
    statements.push(capture(scope.flowName, scope.body, scope.errorType, scope.terminates));
    if (scope.errorType !== undefined) {
      statements.push(capture(scope.cleanupName, scope.cleanup, scope.errorType, false, { kind: "unit" }, unit()),
        { kind: "let", name: scope.flowName, mutable: false,
          init: { kind: "try", expr: call("rt::finish_resource", path(scope.flowName), path(scope.cleanupName)),
            resultErrorType: scope.errorType, operandErrorType: scope.errorType } });
    } else if (scope.asynchronous) statements.push({ kind: "expr",
      expr: { kind: "await", expr: { kind: "async-block", move: false, body: scope.cleanup } } });
    else statements.push(...scope.cleanup.statements);
  }
  const dispatched = dispatch(scope);
  statements.push(normalBindings.length === 0 ? dispatched : { kind: "tail", expr: dispatched.expr });
  return normalBindings.length === 0 ? { kind: "scope", body: { statements } }
    : { kind: "let", name: scope.flowName, mutable: false, type: normalType, init: { kind: "block", body: { statements } } };
}

function unwrap(name: string, errorType: RustType): RustStmt {
  return { kind: "let", name, mutable: false, init: {
    kind: "try", expr: path(name), resultErrorType: errorType, operandErrorType: errorType,
  } };
}

function dispatch(scope: CompletionScope): Extract<RustStmt, { readonly kind: "expr" | "tail" }> {
  const exit = (value: RustExpr): RustExpr => scope.tail && scope.terminates ? value
    : { kind: "return-expression", expr: value };
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [{
    pattern: variant("rt::Completion::Normal", scope.kind === "try-scope" && (scope.normalBindings?.length ?? 0) > 0
      ? binding("normal") : { kind: "wildcard" }), expression: scope.terminates
      ? { kind: "unreachable", message: "terminating Tsonic completion scope completed normally" }
      : scope.kind === "try-scope" && (scope.normalBindings?.length ?? 0) > 0 ? path("normal") : unit(),
  }];
  if (scope.propagate) arms.push(...abruptVariants(scope.dispatchResultWrapped).map(arm => ({ ...arm, expression: exit(arm.expression) })));
  else {
    if (scope.dispatchReturn) arms.push({ pattern: variant("rt::Completion::Return", binding("value")),
      expression: exit(scope.dispatchResultWrapped ? call("Ok", path("value")) : path("value")) });
    for (const target of scope.dispatchTargets) {
      const id: RustPattern = { kind: "path", path: String(target.id) };
      arms.push({ pattern: variant("rt::Completion::Break", id),
        expression: { kind: "break-expression", label: target.label } });
      if (target.kind === "loop") arms.push({ pattern: variant("rt::Completion::Continue", id),
        expression: { kind: "block", body: { statements: [...target.continuePrelude ?? [],
          { kind: "continue", label: target.label }] } } });
    }
    arms.push({ pattern: { kind: "or", alternatives: [
      ...(scope.dispatchReturn ? [] : [variant("rt::Completion::Return", { kind: "wildcard" })]),
      variant("rt::Completion::Break", { kind: "wildcard" }),
      variant("rt::Completion::Continue", { kind: "wildcard" }),
    ] }, expression: { kind: "unreachable", message: "invalid finalized Tsonic completion target" } });
  }
  return { kind: scope.tail && scope.terminates ? "tail" : "expr",
    expr: { kind: "match", expression: path(scope.flowName), arms } };
}

function abruptVariants(fallible: boolean): Extract<RustExpr, { readonly kind: "match" }>["arms"] {
  return ["Return", "Break", "Continue"].map(name => {
    const value = call(`rt::Completion::${name}`, path("value"));
    return { pattern: variant(`rt::Completion::${name}`, binding("value")),
      expression: fallible ? call("Ok", value) : value };
  });
}

// Lowers the region's exits into breaks to its label. `breaksToLabel` records whether this lowering produced any
// such break, so an unused label is not printed. An exit value is bound to a local before the break only when its own
// lowering broke to the same label (`break 'label { ... break 'label ... }` would not type as one value).
function lowerRegion(body: RustBlock, label: string | undefined): { readonly body: RustBlock; readonly breaksToLabel: boolean } {
  let breaks = 0;
  const exit = (expr: RustExpr | undefined, valueBreaks: boolean): RustExpr => {
    if (label === undefined) return { kind: "return-expression", ...(expr === undefined ? {} : { expr }) };
    breaks++;
    if (expr !== undefined && valueBreaks) {
      return { kind: "block", body: { statements: [
        { kind: "let", name: label, mutable: false, init: expr },
        { kind: "tail", expr: { kind: "break-expression", label, expr: path(label) } },
      ] } };
    }
    return { kind: "break-expression", label, ...(expr === undefined ? {} : { expr }) };
  };
  const exitLowered = (lower: () => RustExpr | undefined): RustExpr => {
    const before = breaks;
    const expr = lower();
    return exit(expr, breaks !== before);
  };
  const expression = (value: RustExpr): RustExpr => {
    if (value.kind === "closure" || value.kind === "closure-block" || value.kind === "async-block") return value;
    const before = breaks;
    const mapped = mapRustExpressionChildren(value, expression, block);
    if (mapped.kind === "return-expression") return exit(mapped.expr, breaks !== before);
    if (mapped.kind !== "try" || label === undefined) return mapped;
    const error: RustExpr = rustTypeEquals(mapped.operandErrorType, mapped.resultErrorType) ? path("error")
      : { kind: "associated-call", owner: mapped.resultErrorType, method: "from", args: [path("error")] };
    // A block operand is bound first, so the match scrutinee is a path rather than a block expression.
    const boundOperand = mapped.expr.kind === "block";
    const matched: RustExpr = { kind: "match", expression: boundOperand ? path(label) : mapped.expr, arms: [
      { pattern: variant("Ok", binding("value")), expression: path("value") },
      { pattern: variant("Err", binding("error")), expression: exit(call("Err", error), false) },
    ] };
    return boundOperand ? { kind: "block", body: { statements: [
      { kind: "let", name: label, mutable: false, init: mapped.expr },
      { kind: "tail", expr: matched },
    ] } } : matched;
  };
  // The region tail is the labelled block value itself: a tail exit there is the value, not a break to the label.
  const statement = (value: RustStmt, regionTail = false): RustStmt => {
    switch (value.kind) {
      case "completion-exit": {
        const lowerResult = (): RustExpr => {
          const completion = value.completion === "return"
            ? call("rt::Completion::Return", value.expr === undefined ? unit() : expression(value.expr))
            : call(value.completion === "break" ? "rt::Completion::Break" : "rt::Completion::Continue",
              { kind: "int-literal", text: String(value.loopId ?? 0) });
          return value.resultWrapped ? call("Ok", completion) : completion;
        };
        return label === undefined ? { kind: value.tail ? "tail" : "return", expr: lowerResult() }
          : regionTail && value.tail ? { kind: "tail", expr: lowerResult() }
          : { kind: value.tail ? "tail" : "expr", expr: exitLowered(lowerResult) };
      }
      case "return": return label === undefined
        ? { ...value, ...(value.expr === undefined ? {} : { expr: expression(value.expr) }) }
        : { kind: "expr", expr: exitLowered(() => value.expr === undefined ? undefined : expression(value.expr)) };
      case "throw": return label === undefined
        ? { kind: value.tail ? "tail" : "return", expr: call("Err", expression(value.error)) }
        : regionTail && value.tail ? { kind: "tail", expr: call("Err", expression(value.error)) }
        : { kind: value.tail ? "tail" : "expr", expr: exitLowered(() => call("Err", expression(value.error))) };
      case "let": return value.init === undefined ? value : { ...value, init: expression(value.init) };
      case "let-pattern": return { ...value, init: expression(value.init) };
      case "expr":
      case "tail": return { ...value, expr: expression(value.expr) };
      case "assign": return { ...value, target: expression(value.target), value: expression(value.value) };
      case "index-assign": return { ...value, receiver: expression(value.receiver), index: expression(value.index), value: expression(value.value) };
      case "if": return { ...value, condition: expression(value.condition), then: block(value.then),
        ...(value.else === undefined ? {} : { else: block(value.else) }) };
      case "while": return { ...value, condition: expression(value.condition), body: block(value.body) };
      case "while-let-some": return { ...value, expression: expression(value.expression), body: block(value.body) };
      case "for": return { ...value, iterable: expression(value.iterable), body: block(value.body) };
      case "loop":
      case "scope":
      case "unsafe-scope": return { ...value, body: block(value.body) };
      case "try-scope":
      case "resource-scope": return statement(lowerRustCompletionScope(value));
      case "item":
      case "break":
      case "continue": return value;
    }
  };
  const block = (value: RustBlock): RustBlock => ({ ...value, statements: value.statements.map(nested => statement(nested)) });
  const lowered = { ...body, statements: body.statements.map((value, index) => statement(value, index === body.statements.length - 1)) };
  return { body: lowered, breaksToLabel: breaks !== 0 };
}
