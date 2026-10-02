import type { RustClosureParameter } from "../../../backend/target-ast/nodes.js";
import { printRustAttribute } from "../attributes.js";
import { printRustType } from "../types.js";

export function printRustClosureParams(
  params: readonly RustClosureParameter[],
): string {
  return params
    .map((param) => `${param.attrs?.map(attribute => `${printRustAttribute(attribute)} `).join("") ?? ""}${param.byRefCopy === true
      ? param.mutable === true ? `&(mut ${param.name})` : `&${param.name}`
      : `${param.mutable === true ? "mut " : ""}${param.name}`}${param.type === undefined ? "" : `: ${printRustType(param.type)}`}`)
    .join(", ");
}
