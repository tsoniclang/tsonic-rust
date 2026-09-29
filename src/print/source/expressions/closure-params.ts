import type { RustAttribute } from "../../../backend/target-ast/attributes.js";
import { printRustAttribute } from "../attributes.js";

export function printRustClosureParams(
  params: readonly { readonly name: string; readonly mutable?: boolean; readonly byRefCopy?: boolean; readonly attrs?: readonly RustAttribute[] }[],
): string {
  return params
    .map((param) => `${param.attrs?.map(attribute => `${printRustAttribute(attribute)} `).join("") ?? ""}${param.byRefCopy === true
      ? param.mutable === true ? `&(mut ${param.name})` : `&${param.name}`
      : `${param.mutable === true ? "mut " : ""}${param.name}`}`)
    .join(", ");
}
