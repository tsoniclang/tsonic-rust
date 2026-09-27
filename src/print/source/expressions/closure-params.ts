import type { RustClosureParam } from "../../../backend/target-ast/nodes.js";
import { printRustPattern } from "../patterns.js";
import { printRustType } from "../types.js";

export function printRustClosureParams(
  params: readonly RustClosureParam[],
): string {
  return params
    .map((param) => `${printRustPattern(param.pattern, false)}${param.type === undefined ? "" : `: ${printRustType(param.type)}`}`)
    .join(", ");
}
