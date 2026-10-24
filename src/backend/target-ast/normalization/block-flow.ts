import type { RustBlock, RustExpr, RustStmt } from "../syntax/nodes.js";

function rustTailPlaceHasNoTemporary(expression: RustExpr, nativeBindings: ReadonlySet<string>): boolean {
  return expression.kind === "path" && nativeBindings.has(expression.path) ||
    expression.kind === "field" && rustTailPlaceHasNoTemporary(expression.receiver, nativeBindings);
}

function rustTailLiteralHasNoDrop(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "char-literal":
    case "str-literal":
    case "none": return true;
    case "unary": return rustTailLiteralHasNoDrop(expression.operand);
    case "numeric-cast": return rustTailLiteralHasNoDrop(expression.expression);
    case "slice-literal":
    case "tuple-literal": return expression.elements.every(rustTailLiteralHasNoDrop);
    default: return false;
  }
}

function rustTailOperandHasNoTemporary(expression: RustExpr, nativeBindings: ReadonlySet<string>): boolean {
  return rustTailPlaceHasNoTemporary(expression, nativeBindings) || rustTailLiteralHasNoDrop(expression) ||
    expression.kind === "reference" && (rustTailPlaceHasNoTemporary(expression.expr, nativeBindings) ||
      rustTailLiteralHasNoDrop(expression.expr));
}

function rustTailInitializerHasNoIntermediateTemporary(expression: RustExpr, nativeBindings: ReadonlySet<string>): boolean {
  if (rustTailOperandHasNoTemporary(expression, nativeBindings)) return true;
  const operand = (value: RustExpr): boolean => rustTailOperandHasNoTemporary(value, nativeBindings);
  const result = (value: RustExpr): boolean => rustTailInitializerHasNoIntermediateTemporary(value, nativeBindings);
  switch (expression.kind) {
    case "path": return true;
    case "string-literal": return true;
    case "call":
    case "associated-call": return expression.args.every(operand);
    case "invoke": return rustTailPlaceHasNoTemporary(expression.callee, nativeBindings) && expression.args.every(operand);
    case "method-call": return rustTailPlaceHasNoTemporary(expression.receiver, nativeBindings) && expression.args.every(operand);
    case "tuple-literal": return expression.elements.every(result);
    case "struct-literal": return (expression.base === undefined || operand(expression.base)) &&
      expression.fields.every(field => result(field.value));
    case "match": return rustTailPlaceHasNoTemporary(expression.expression, nativeBindings) &&
      expression.arms.every(arm => result(arm.expression));
    case "conditional": return result(expression.condition) && result(expression.whenTrue) && result(expression.whenFalse);
    case "block": {
      const tail = expression.body.statements[expression.body.statements.length - 1];
      const bindings = new Set([...nativeBindings, ...expression.body.statements.flatMap(statement =>
        statement.kind === "let" ? [statement.name] : [])]);
      return tail?.kind === "tail" && rustTailInitializerHasNoIntermediateTemporary(tail.expr, bindings);
    }
    case "unary": return operand(expression.operand);
    case "binary": return operand(expression.left) && operand(expression.right);
    case "numeric-cast": return operand(expression.expression);
    default: return false;
  }
}

export function applyRustTailShape(body: RustBlock, hasReturnValue: boolean, nativeBindings: ReadonlySet<string>): RustBlock {
  const bindings = new Set([...nativeBindings]);
  if (body.statements.length === 0) {
    return body;
  }
  const lastIndex = body.statements.length - 1;
  const last = body.statements[lastIndex];
  if (last === undefined) {
    return body;
  }
  const localBindings = new Map<string, number>();
  for (let statementIndex = 0; statementIndex < lastIndex; statementIndex++) {
    const statement = body.statements[statementIndex];
    if (statement?.kind !== "let") continue;
    localBindings.set(statement.name, (localBindings.get(statement.name) ?? 0) + 1);
    bindings.add(statement.name);
  }
  if (!hasReturnValue && (last.kind === "return" || last.kind === "tail") &&
    last.expr?.kind === "tuple-literal" && last.expr.elements.length === 0) {
    return { ...body, statements: body.statements.slice(0, lastIndex) };
  }
  let tail: RustStmt = last;
  if (last.kind === "return" && last.expr !== undefined) {
    tail = { kind: "tail", expr: last.expr };
  } else if (!hasReturnValue && last.kind === "return" && last.expr === undefined) {
    return { ...body, statements: body.statements.slice(0, lastIndex) };
  } else if (last.kind === "throw") {
    tail = { ...last, tail: true };
  } else if (last.kind === "scope" || last.kind === "unsafe-scope") {
    tail = { ...last, body: applyRustTailShape(last.body, hasReturnValue, bindings) };
  } else if (last.kind === "try-scope" || last.kind === "resource-scope") {
    tail = { ...last, tail: true };
  } else if (last.kind === "if" && last.else !== undefined && last.tailEligible === true) {
    tail = {
      ...last,
      then: applyRustTailShape(last.then, hasReturnValue, bindings),
      else: applyRustTailShape(last.else, hasReturnValue, bindings),
    };
  }
  let bindingIndex = lastIndex - 1;
  while (tail.kind === "tail" && (tail.attrs?.length ?? 0) === 0 && tail.expr.kind === "path" &&
    (tail.expr.genericArguments?.length ?? 0) === 0) {
    const binding = body.statements[bindingIndex];
    if (binding?.kind !== "let" || binding.mutable || binding.type !== undefined ||
      (binding.attrs?.length ?? 0) !== 0 || binding.name !== tail.expr.path || binding.init === undefined) break;
    const remainingBindings = (localBindings.get(binding.name) ?? 0) - 1;
    if (remainingBindings > 0) {
      localBindings.set(binding.name, remainingBindings);
    } else {
      localBindings.delete(binding.name);
      if (!nativeBindings.has(binding.name)) bindings.delete(binding.name);
    }
    if (!rustTailInitializerHasNoIntermediateTemporary(binding.init, bindings)) break;
    tail = { kind: "tail", expr: binding.init };
    bindingIndex--;
  }
  return tail === last ? body : { ...body, statements: [...body.statements.slice(0, bindingIndex + 1), tail] };
}
