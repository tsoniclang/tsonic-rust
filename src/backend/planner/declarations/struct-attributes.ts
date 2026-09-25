import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";

export function structAttributes(typeName: string): readonly string[] | undefined {
  const attrs: string[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(typeName)) {
    attrs.push(rustLintAttributes.nonCamelCaseType);
  }
  return attrs.length === 0 ? undefined : attrs;
}
