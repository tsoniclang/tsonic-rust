import { type RustAttribute } from "../../target-ast/attributes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";

export function structAttributes(typeName: string): readonly RustAttribute[] | undefined {
  const attrs: RustAttribute[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(typeName)) {
    attrs.push(rustLintAttributes.nonCamelCaseType);
  }
  return attrs.length === 0 ? undefined : attrs;
}
