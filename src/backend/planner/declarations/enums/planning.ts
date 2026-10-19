import { rustDeriveAttributes, rustListAttribute, rustWordAttribute } from "../../../target-ast/syntax/attributes.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] {
  const admitted = context.input.program.records.nativeDeclaration.get(node);
  if (admitted?.kind !== "enum") return failRustPlannerInvariant(
    "Enum emission requires its sealed native declaration admission.", node);
  const enumName = admitted.name;
  const variants = admitted.variants;
  const integerType = admitted.integerWidth === 32 ? "i32" : "i64";
  const emission = context.input.program.records.declarationLiveness.get(node);
  if (emission === undefined) failRustPlannerInvariant("An admitted enum requires its native visibility and liveness decisions.", node);
  const { visibility, deadCode } = emission;
  if (admitted.representation === "constants") {
    const enumType = { kind: "named" as const, path: enumName };
    const discriminantDeadCode = emission.enumDiscriminant;
    return [{
      kind: "struct",
      name: enumName,
      visibility,
      attrs: [rustListAttribute("repr", [rustWordAttribute("transparent")]), ...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq", "Eq", "Hash"])],
      ...(deadCode === undefined ? {} : { deadCode }),
      generics: emptyRustGenerics,
      fields: [{
        name: "value",
        type: { kind: "primitive", name: integerType },
        visibility: "private",
        ...(discriminantDeadCode === undefined
          ? {}
          : { deadCode: discriminantDeadCode }),
      }],
    }, {
      kind: "impl",
      generics: emptyRustGenerics,
      target: enumType,
      members: variants.map((variant, index) => {
        const selected = emission.variants[index];
        if (selected === undefined) failRustPlannerInvariant("An admitted enum member requires its native liveness selection.", variant.declaration);
        const variantDeadCode = selected.deadCode;
        const constantAttrs = !selected.nonUpperCaseConstant
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
    attrs: [rustListAttribute("repr", [rustWordAttribute(integerType)]),
      ...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq"])],
    variants: variants.map((variant, index) => {
      const selected = emission.variants[index];
      if (selected === undefined) failRustPlannerInvariant("An admitted enum member requires its native liveness selection.", variant.declaration);
      const variantDeadCode = selected.deadCode;
      return {
        name: variant.name,
        discriminant: variant.discriminant,
        ...(variantDeadCode === undefined ? {} : { deadCode: variantDeadCode }),
      };
    }),
  }];
}
