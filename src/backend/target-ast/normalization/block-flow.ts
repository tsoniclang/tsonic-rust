import type { RustBlock, RustExpr, RustStmt } from "../syntax/nodes.js";

function rustTailPlaceHasNoTemporary(expression: RustExpr): boolean {
  return expression.kind === "path" || expression.kind === "field" && rustTailPlaceHasNoTemporary(expression.receiver);
}

function rustTailOperandHasNoTemporary(expression: RustExpr): boolean {
  if (rustTailPlaceHasNoTemporary(expression)) return true;
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "char-literal":
    case "str-literal":
    case "none": return true;
    case "reference": return rustTailPlaceHasNoTemporary(expression.expr);
    default: return false;
  }
}

function rustTailInitializerHasNoIntermediateTemporary(expression: RustExpr): boolean {
  if (rustTailOperandHasNoTemporary(expression)) return true;
  switch (expression.kind) {
    case "call": return expression.args.every(rustTailOperandHasNoTemporary);
    case "invoke": return rustTailOperandHasNoTemporary(expression.callee) &&
      expression.args.every(rustTailOperandHasNoTemporary);
    case "method-call": return rustTailPlaceHasNoTemporary(expression.receiver) &&
      expression.args.every(rustTailOperandHasNoTemporary);
    case "tuple-literal": return expression.elements.every(rustTailInitializerHasNoIntermediateTemporary);
    case "struct-literal": return (expression.base === undefined || rustTailOperandHasNoTemporary(expression.base)) &&
      expression.fields.every(field => rustTailInitializerHasNoIntermediateTemporary(field.value));
    case "match": return rustTailPlaceHasNoTemporary(expression.expression) &&
      expression.arms.every(arm => rustTailInitializerHasNoIntermediateTemporary(arm.expression));
    case "conditional": return rustTailInitializerHasNoIntermediateTemporary(expression.condition) &&
      rustTailInitializerHasNoIntermediateTemporary(expression.whenTrue) &&
      rustTailInitializerHasNoIntermediateTemporary(expression.whenFalse);
    case "block": {
      const tail = expression.body.statements[expression.body.statements.length - 1];
      return tail?.kind === "tail" && rustTailInitializerHasNoIntermediateTemporary(tail.expr);
    }
    case "unary": return rustTailOperandHasNoTemporary(expression.operand);
    case "binary": return rustTailOperandHasNoTemporary(expression.left) &&
      rustTailOperandHasNoTemporary(expression.right);
    case "numeric-cast": return rustTailOperandHasNoTemporary(expression.expression);
    default: return false;
  }
}

export function applyRustTailShape(body: RustBlock, hasReturnValue: boolean): RustBlock {
  if (body.statements.length === 0) {
    return body;
  }
  const lastIndex = body.statements.length - 1;
  const last = body.statements[lastIndex];
  if (last === undefined) {
    return body;
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
    tail = { ...last, body: applyRustTailShape(last.body, hasReturnValue) };
  } else if (last.kind === "try-scope" || last.kind === "resource-scope") {
    tail = { ...last, tail: true };
  } else if (last.kind === "if" && last.else !== undefined && last.tailEligible === true) {
    tail = {
      ...last,
      then: applyRustTailShape(last.then, hasReturnValue),
      else: applyRustTailShape(last.else, hasReturnValue),
    };
  }
  let bindingIndex = lastIndex - 1;
  while (tail.kind === "tail" && (tail.attrs?.length ?? 0) === 0 && tail.expr.kind === "path" &&
    (tail.expr.genericArguments?.length ?? 0) === 0) {
    const binding = body.statements[bindingIndex];
    if (binding?.kind !== "let" || binding.mutable || binding.type !== undefined ||
      (binding.attrs?.length ?? 0) !== 0 || binding.name !== tail.expr.path || binding.init === undefined ||
      !rustTailInitializerHasNoIntermediateTemporary(binding.init)) break;
    tail = { kind: "tail", expr: binding.init };
    bindingIndex--;
  }
  return tail === last ? body : { ...body, statements: [...body.statements.slice(0, bindingIndex + 1), tail] };
}
