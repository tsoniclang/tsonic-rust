import type { RustBlock, RustExpr, RustPattern, RustStmt, RustType } from "../nodes.js";
import { mapRustExpressionChildren } from "../expression-children.js";
import { rustTypeEquals } from "../inspection/type-equality.js";
import { applyRustTailShape } from "./block-flow.js";
import { rustBlockBreaksToLabel, rustBlockReferencesPath } from "../inspection/source-usage.js";
import { closeRustCompletionBindings } from "./completion-bindings.js";

type CompletionScope = Extract<RustStmt, { readonly kind: "try-scope" | "resource-scope" }>;
const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });
const unit = (): RustExpr => ({ kind: "tuple-literal", elements: [] });

export function lowerRustCompletionScope(scope: CompletionScope): RustStmt {
  const normalBindings = scope.kind === "try-scope" ? scope.normalBindings ?? [] : [];
  const normalType: RustType = normalBindings.length === 0 ? { kind: "unit" }
    : { kind: "tuple", elements: normalBindings.map(declaration => declaration.type!) };
  const completionType: RustType = { kind: "named", path: "rt::Completion",
    genericArguments: [{ kind: "type", type: scope.returnType }, { kind: "type", type: normalType }] };
  const unitCompletionType: RustType = { ...completionType,
    genericArguments: [{ kind: "type", type: scope.returnType }, { kind: "type", type: { kind: "unit" } }] };
  const normal = (): RustExpr => call("rt::Completion::Normal", normalBindings.length === 0 ? unit()
    : { kind: "tuple-literal", elements: normalBindings.map(declaration => path(declaration.name)) });
  const resultType = (type: RustType): RustType => ({ kind: "named", path: "rt::TsonicResult",
    genericArguments: [{ kind: "type", type }] });
  const capture = (name: string, body: RustBlock, fallible: boolean, terminates: boolean, type: RustType = completionType,
    normal: RustExpr = call("rt::Completion::Normal", unit()),
    bindings: readonly Extract<RustStmt, { readonly kind: "let" }>[] = []): RustStmt => {
    const ownedBody = { ...body, statements: [
      ...bindings.filter(declaration => !terminates || rustBlockReferencesPath(body, declaration.name)),
      ...body.statements] };
    const region = { ...ownedBody, statements: [
      ...lowerRegion(ownedBody, scope.asynchronous ? undefined : name).statements,
      ...(terminates ? [] : [{ kind: "tail" as const, expr: fallible ? call("Ok", normal) : normal }])] };
    return { kind: "let", name, mutable: false, type: fallible ? resultType(type) : type,
      init: scope.asynchronous
        ? { kind: "await", expr: { kind: "async-block", move: false, body: applyRustTailShape(region, true) } }
        : { kind: "block", label: name, body: region } };
  };
  const statements: RustStmt[] = [];
  if (scope.kind === "try-scope") {
    statements.push(capture(scope.bodyName, scope.body, scope.bodyFallible, scope.bodyTerminates,
      completionType, normal(), normalBindings));
    let fallible = scope.bodyFallible;
    const caught = scope.catchClause;
    statements.push({ kind: "let", name: scope.flowName, mutable: false,
      type: (caught?.fallible ?? scope.bodyFallible) ? resultType(completionType) : completionType,
      init: caught === undefined ? path(scope.bodyName) : { kind: "match", expression: path(scope.bodyName), arms: [
        { pattern: variant("Ok", binding("completion")), expression: caught.fallible
          ? call("Ok", path("completion")) : path("completion") },
        { pattern: variant("Err", binding(caught.binding)), expression: {
          kind: "block", body: { statements: [capture(scope.flowName, caught.body, caught.fallible, caught.terminates,
            completionType, normal(), normalBindings),
            { kind: "tail", expr: path(scope.flowName) }] },
        } },
      ] } });
    if (caught !== undefined) fallible = caught.fallible;
    const finalized = scope.finallyClause;
    if (finalized !== undefined) {
      if (scope.finallyName === undefined) throw new Error("Finalized completion requires its exact hygienic capture identity.");
      statements.push(capture(scope.finallyName, finalized.body, finalized.fallible, finalized.terminates, unitCompletionType));
      statements.push({ kind: "let", name: scope.flowName, mutable: false,
        type: fallible || finalized.fallible ? resultType(completionType) : completionType,
        init: fallible || finalized.fallible
          ? call("rt::finish_finally", fallible ? path(scope.flowName) : call("Ok", path(scope.flowName)),
            finalized.fallible ? path(scope.finallyName) : call("Ok", path(scope.finallyName)))
          : { kind: "match", expression: path(scope.finallyName), arms: [
            { pattern: variant("rt::Completion::Normal", { kind: "wildcard" }), expression: path(scope.flowName) },
            ...abruptVariants(false),
          ] } });
      fallible ||= finalized.fallible;
    }
    if (fallible) statements.push(unwrap(scope.flowName));
  } else {
    statements.push(capture(scope.flowName, scope.body, scope.fallible, scope.terminates));
    if (scope.fallible) {
      statements.push(capture(scope.cleanupName, scope.cleanup, true, false, { kind: "unit" }, unit()),
        { kind: "let", name: scope.flowName, mutable: false,
          init: { kind: "try", expr: call("rt::finish_resource", path(scope.flowName), path(scope.cleanupName)),
            resultErrorType: runtimeError, operandErrorType: runtimeError } });
    } else if (scope.asynchronous) statements.push({ kind: "expr",
      expr: { kind: "await", expr: { kind: "async-block", move: false, body: scope.cleanup } } });
    else statements.push(...scope.cleanup.statements);
  }
  const dispatched = dispatch(scope);
  statements.push(normalBindings.length === 0 ? dispatched : { kind: "tail", expr: dispatched.expr });
  return normalBindings.length === 0 ? { kind: "scope", body: { statements } }
    : { kind: "let", name: scope.flowName, mutable: false, type: normalType, init: { kind: "block", body: { statements } } };
}

const runtimeError: RustType = { kind: "named", path: "rt::TsonicError" };

function unwrap(name: string): RustStmt {
  return { kind: "let", name, mutable: false, init: {
    kind: "try", expr: path(name), resultErrorType: runtimeError, operandErrorType: runtimeError,
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
  if (scope.propagate) arms.push(...abruptVariants(scope.fallible).map(arm => ({ ...arm, expression: exit(arm.expression) })));
  else {
    if (scope.dispatchReturn) arms.push({ pattern: variant("rt::Completion::Return", binding("value")),
      expression: exit(scope.fallible ? call("Ok", path("value")) : path("value")) });
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

function lowerRegion(body: RustBlock, label: string | undefined): RustBlock {
  const exit = (expr: RustExpr | undefined): RustExpr => {
    if (label === undefined) return { kind: "return-expression", ...(expr === undefined ? {} : { expr }) };
    if (expr !== undefined && rustBlockBreaksToLabel({ statements: [{ kind: "tail", expr }] }, label)) {
      return { kind: "block", body: { statements: [
        { kind: "let", name: label, mutable: false, init: expr },
        { kind: "tail", expr: { kind: "break-expression", label, expr: path(label) } },
      ] } };
    }
    return { kind: "break-expression", label, ...(expr === undefined ? {} : { expr }) };
  };
  const expression = (value: RustExpr): RustExpr => {
    if (value.kind === "closure" || value.kind === "closure-block" || value.kind === "async-block") return value;
    const mapped = mapRustExpressionChildren(value, expression, block);
    if (mapped.kind === "return-expression") return exit(mapped.expr);
    if (mapped.kind !== "try" || label === undefined) return mapped;
    const error = rustTypeEquals(mapped.operandErrorType, mapped.resultErrorType) ? path("error")
      : { kind: "associated-call" as const, owner: mapped.resultErrorType, method: "from", args: [path("error")] };
    const matched: RustExpr = { kind: "match", expression: mapped.expr.kind === "block" ? path(label) : mapped.expr, arms: [
      { pattern: variant("Ok", binding("value")), expression: path("value") },
      { pattern: variant("Err", binding("error")), expression: exit(call("Err", error)) },
    ] };
    return mapped.expr.kind === "block" ? { kind: "block", body: { statements: [
      { kind: "let", name: label, mutable: false, init: mapped.expr },
      { kind: "tail", expr: matched },
    ] } } : matched;
  };
  const statement = (value: RustStmt): RustStmt => {
    switch (value.kind) {
      case "completion-exit": {
        const completion = value.completion === "return"
          ? call("rt::Completion::Return", value.expr === undefined ? unit() : expression(value.expr))
          : call(value.completion === "break" ? "rt::Completion::Break" : "rt::Completion::Continue",
            { kind: "int-literal", text: String(value.loopId ?? 0) });
        const result = value.resultWrapped ? call("Ok", completion) : completion;
        return label === undefined ? { kind: value.tail ? "tail" : "return", expr: result }
          : { kind: value.tail ? "tail" : "expr", expr: exit(result) };
      }
      case "return": return label === undefined
        ? { ...value, ...(value.expr === undefined ? {} : { expr: expression(value.expr) }) }
        : { kind: "expr", expr: exit(value.expr === undefined ? undefined : expression(value.expr)) };
      case "throw": return label === undefined
        ? { kind: value.tail ? "tail" : "return", expr: call("Err", expression(value.error)) }
        : { kind: value.tail ? "tail" : "expr", expr: exit(call("Err", expression(value.error))) };
      case "let": return value.init === undefined ? value : { ...value, init: expression(value.init) };
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
  const block = (value: RustBlock): RustBlock => ({ ...value, statements: closeRustCompletionBindings(value).statements.map(statement) });
  return block(body);
}
