import { type RustAttribute } from "../../target-ast/syntax/attributes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";

export function structAttributes(nonCamelCaseName: boolean): readonly RustAttribute[] | undefined {
  const attrs: RustAttribute[] = [];
  if (nonCamelCaseName) {
    attrs.push(rustLintAttributes.nonCamelCaseType);
  }
  return attrs.length === 0 ? undefined : attrs;
}
