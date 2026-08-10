import type { RustBlock, RustStmt } from "../rust-ast/nodes.js";

export function rustBlockTerminates(block: RustBlock): boolean {
  const last = block.statements[block.statements.length - 1];
  if (last === undefined) {
    return false;
  }
  if (last.kind === "return" || last.kind === "tail" || last.kind === "throw") {
    return true;
  }
  if (last.kind === "scope") {
    return rustBlockTerminates(last.body);
  }
  if (last.kind === "resource-scope") {
    return last.terminates;
  }
  if (last.kind === "try-scope") {
    return last.terminates;
  }
  return last.kind === "if" && last.else !== undefined &&
    rustBlockTerminates(last.then) && rustBlockTerminates(last.else);
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
  let tail: RustStmt = last;
  if (hasReturnValue && last.kind === "return" && last.expr !== undefined) {
    tail = { kind: "tail", expr: last.expr };
  } else if (last.kind === "throw") {
    tail = { ...last, tail: true };
  } else if (last.kind === "scope") {
    tail = { ...last, body: applyRustTailShape(last.body, hasReturnValue) };
  } else if (last.kind === "try-scope") {
    tail = last;
  } else if (last.kind === "if" && last.else !== undefined &&
    rustBlockTerminates(last.then) && rustBlockTerminates(last.else)) {
    tail = {
      ...last,
      then: applyRustTailShape(last.then, hasReturnValue),
      else: applyRustTailShape(last.else, hasReturnValue),
    };
  }
  return tail === last
    ? body
    : { statements: [...body.statements.slice(0, lastIndex), tail] };
}
