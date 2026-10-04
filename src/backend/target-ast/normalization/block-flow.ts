import type { RustBlock, RustStmt } from "../nodes.js";
import { rustExpressionAlwaysExits } from "../inspection/source-dataflow.js";

export function retainRustCheckedCompletion(body: RustBlock, canFallThrough: boolean | undefined): RustBlock {
  return canFallThrough !== false || rustBlockTerminates(body) ? body : {
    statements: [...body.statements, { kind: "expr", expr: { kind: "bottom", expression: {
      kind: "unreachable", message: "checked source cannot complete normally",
    } } }],
  };
}

export function rustBlockTerminates(block: RustBlock): boolean {
  return rustBlockExits(block, false);
}

export function rustBlockDefinitelyExits(block: RustBlock): boolean {
  return rustBlockExits(block, true);
}

function rustBlockExits(block: RustBlock, includeRegionExits: boolean): boolean {
  let index = block.statements.length - 1;
  while (index >= 0 && block.statements[index]?.kind === "item") index -= 1;
  const last = block.statements[index];
  if (last === undefined) {
    return false;
  }
  if (last.kind === "return" || last.kind === "tail" || last.kind === "throw") {
    return true;
  }
  if (includeRegionExits && (last.kind === "break" || last.kind === "continue" || last.kind === "completion-exit")) {
    return true;
  }
  if (last.kind === "expr" && rustExpressionAlwaysExits(last.expr)) {
    return true;
  }
  if (last.kind === "scope" || last.kind === "unsafe-scope") {
    return rustBlockExits(last.body, includeRegionExits);
  }
  if (last.kind === "resource-scope") {
    return last.terminates;
  }
  if (last.kind === "try-scope") {
    return last.terminates;
  }
  if (last.kind === "loop" && last.neverFallsThrough === true) {
    return true;
  }
  return last.kind === "if" && last.else !== undefined &&
    rustBlockExits(last.then, includeRegionExits) && rustBlockExits(last.else, includeRegionExits);
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
    : { ...body, statements: [...body.statements.slice(0, lastIndex), tail] };
}
