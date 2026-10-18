import { rustDeriveAttributes, rustListAttribute, rustWordAttribute } from "../../../target-ast/syntax/attributes.js";
import { isUpperSnakeName, rustProjectTypeHasPublicImplementationAbi } from "../../program/plan-context.js";
import { rustAuthoredDeadCodeDisposition, rustAuthoredVariantDeadCodeDisposition } from "../../program/reachability-directives.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const admitted = context.input.program.nativeDeclarations.get(node);
  if (admitted?.kind !== "enum") return failRustPlannerInvariant(
    "Enum emission requires its sealed native declaration admission.", node);
  const enumName = admitted.name;
  const variants = admitted.variants;
  const integerType = admitted.integerWidth === 32 ? "i32" : "i64";
  const visibility = ast.hasModifierKind(node, "export") ||
      rustProjectTypeHasPublicImplementationAbi(context, enumName)
    ? "public" as const
    : "crate" as const;
  const deadCode = rustAuthoredDeadCodeDisposition(context, node);
  const enumType: RustType = { kind: "named", path: enumName };
  return [{
    kind: "struct",
    name: enumName,
    visibility,
    attrs: [rustListAttribute("repr", [rustWordAttribute("transparent")]),
      ...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq", "Eq", "Hash"])],
    ...(deadCode === undefined ? {} : { deadCode }),
    generics: emptyRustGenerics,
    fields: [{ name: "value", type: { kind: "primitive", name: integerType }, visibility: "private" }],
  }, {
    kind: "impl",
    generics: emptyRustGenerics,
    target: enumType,
    members: variants.map(variant => {
      const variantDeadCode = rustAuthoredVariantDeadCodeDisposition(context, node, variant.name);
      const constantAttrs = isUpperSnakeName(variant.name) ? [] : [rustLintAttributes.nonUpperCaseGlobal];
      return {
        kind: "const",
        name: variant.name,
        visibility: "public",
        ...(constantAttrs.length === 0 ? {} : { attrs: constantAttrs }),
        ...(variantDeadCode === undefined ? {} : { deadCode: variantDeadCode }),
        type: { kind: "named" as const, path: "Self" },
        value: {
          kind: "struct-literal" as const,
          path: "Self",
          fields: [{ name: "value", value: { kind: "int-literal" as const, text: variant.discriminant } }],
        },
      };
    }),
  }, ...([
    ["BitOr", "bitor", "|"],
    ["BitAnd", "bitand", "&"],
    ["BitXor", "bitxor", "^"],
    ["Not", "not", "!"],
  ] as const).map(([trait, method, operator]) => enumBitwiseImplementation(enumType, trait, method, operator)),
  ...([
    ["BitOrAssign", "bitor_assign", "|="],
    ["BitAndAssign", "bitand_assign", "&="],
    ["BitXorAssign", "bitxor_assign", "^="],
  ] as const).map(([trait, method, operator]) => enumBitwiseAssignmentImplementation(enumType, trait, method, operator))];
}

function enumBitwiseAssignmentImplementation(
  enumType: RustType,
  trait: string,
  method: string,
  operator: "|=" | "&=" | "^=",
): RustItem {
  return {
    kind: "impl", generics: emptyRustGenerics, target: enumType,
    trait: { kind: "named", path: `core::ops::${trait}` },
    members: [{ kind: "function", name: method, visibility: "private", attrs: [rustWordAttribute("inline")],
      generics: emptyRustGenerics, selfParam: { kind: "reference", mutable: true },
      params: [{ name: "rhs", type: { kind: "named", path: "Self" } }],
      body: { statements: [{ kind: "expr", expr: { kind: "assignment", operator,
        target: { kind: "field", receiver: { kind: "path", path: "self" }, name: "value" },
        value: { kind: "field", receiver: { kind: "path", path: "rhs" }, name: "value" } } }] },
    }],
  };
}

function enumBitwiseImplementation(
  enumType: RustType,
  trait: string,
  method: string,
  operator: "|" | "&" | "^" | "!",
): RustItem {
  const selfType: RustType = { kind: "named", path: "Self" };
  const value: RustExpr = { kind: "field", receiver: { kind: "path", path: "self" }, name: "value" };
  const result: RustExpr = operator === "!"
    ? { kind: "unary", operator, operand: value }
    : { kind: "binary", operator, left: value,
      right: { kind: "field", receiver: { kind: "path", path: "rhs" }, name: "value" } };
  return {
    kind: "impl", generics: emptyRustGenerics, target: enumType,
    trait: { kind: "named", path: `core::ops::${trait}` },
    members: [
      { kind: "type", name: "Output", generics: emptyRustGenerics, type: selfType },
      { kind: "function", name: method, visibility: "private", attrs: [rustWordAttribute("inline")],
        generics: emptyRustGenerics, selfParam: { kind: "value" },
        params: operator === "!" ? [] : [{ name: "rhs", type: selfType }],
        returnType: selfType,
        body: { statements: [{ kind: "tail", expr: { kind: "struct-literal", path: "Self",
          fields: [{ name: "value", value: result }] } }] },
      },
    ],
  };
}
