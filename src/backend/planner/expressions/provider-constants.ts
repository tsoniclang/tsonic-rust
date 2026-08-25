import type { RustProviderConstantArgument } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";

export function providerConstantExpression(argument: RustProviderConstantArgument): RustExpr {
  switch (argument.kind) {
    case "integer":
      return { kind: "int-literal", text: String(argument.value) };
    case "float64":
      return { kind: "float-literal", text: rustFloat64ConstantText(argument.value) };
    case "string":
      return { kind: "str-literal", value: argument.value };
    case "boolean":
      return { kind: "bool-literal", value: argument.value };
    case "none":
      return { kind: "none" };
  }
}

function rustFloat64ConstantText(value: number): string {
  if (Object.is(value, -0)) {
    return "-0.0";
  }
  const text = String(value);
  return /[.eE]/u.test(text) ? text : `${text}.0`;
}
