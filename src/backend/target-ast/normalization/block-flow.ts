import type { RustBlock, RustStmt } from "../syntax/nodes.js";

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
  return tail === last
    ? body
    : { ...body, statements: [...body.statements.slice(0, lastIndex), tail] };
}
