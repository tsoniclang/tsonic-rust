import { rustDeriveAttributes, rustListAttribute, rustWordAttribute } from "../../../target-ast/syntax/attributes.js";
import { isUpperSnakeName, rustProjectTypeHasPublicImplementationAbi } from "../../program/plan-context.js";
import { rustAuthoredDeadCodeDisposition, rustAuthoredVariantDeadCodeDisposition, rustGeneratedEnumDiscriminantDeadCodeDisposition } from "../../program/reachability-directives.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const admitted = context.input.program.nativeDeclarations.get(node);
  if (admitted?.kind !== "enum") return failRustPlannerInvariant(
    "Enum emission requires its sealed native declaration admission.", node);
  const enumName = admitted.name;
  const variants = admitted.variants;
  const visibility = ast.hasModifierKind(node, "export") ||
      rustProjectTypeHasPublicImplementationAbi(context, enumName)
    ? "public" as const
    : "crate" as const;
  const deadCode = rustAuthoredDeadCodeDisposition(context, node);
  if (admitted.representation === "constants") {
    const enumType = { kind: "named" as const, path: enumName };
    const discriminantDeadCode = rustGeneratedEnumDiscriminantDeadCodeDisposition(
      context,
      node,
    );
    return [{
      kind: "struct",
      name: enumName,
      visibility,
      attrs: [rustListAttribute("repr", [rustWordAttribute("transparent")]), ...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq", "Eq", "Hash"])],
      ...(deadCode === undefined ? {} : { deadCode }),
      generics: emptyRustGenerics,
      fields: [{
        name: "value",
        type: { kind: "primitive", name: "i64" },
        visibility: "private",
        ...(discriminantDeadCode === undefined
          ? {}
          : { deadCode: discriminantDeadCode }),
      }],
    }, {
      kind: "impl",
      generics: emptyRustGenerics,
      target: enumType,
      members: variants.map((variant) => {
        const variantDeadCode = rustAuthoredVariantDeadCodeDisposition(
          context,
          node,
          variant.name,
        );
        const constantAttrs = isUpperSnakeName(variant.name)
            ? []
            : [rustLintAttributes.nonUpperCaseGlobal];
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
            fields: [{
              name: "value",
              value: { kind: "int-literal" as const, text: variant.discriminant },
            }],
          },
        };
      }),
    }];
  }
  return [{
    kind: "enum",
    generics: emptyRustGenerics,
    name: enumName,
    visibility,
    ...(deadCode === undefined ? {} : { deadCode }),
    attrs: [...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq"])],
    variants: variants.map((variant) => {
      const variantDeadCode = rustAuthoredVariantDeadCodeDisposition(
        context,
        node,
        variant.name,
      );
      return {
        name: variant.name,
        discriminant: variant.discriminant,
        ...(variantDeadCode === undefined ? {} : { deadCode: variantDeadCode }),
      };
    }),
  }];
}
