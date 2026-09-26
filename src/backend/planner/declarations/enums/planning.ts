import { rustDeriveAttributes, rustListAttribute, rustWordAttribute } from "../../../target-ast/attributes.js";
import { planRustAttributes } from "../attributes/planning.js";
import { diagnosticInput, isUpperSnakeName, isValidRustIdentifier, rustProjectTypeHasPublicImplementationAbi } from "../../program/plan-context.js";
import { rustAuthoredDeadCodeDisposition, rustAuthoredVariantDeadCodeDisposition, rustGeneratedEnumDiscriminantDeadCodeDisposition } from "../../liveness/directives.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../../diagnostics.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const enumName = context.input.program.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(enumName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.enum",
      "Enum names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  const variants: { declaration: Node; name: string; discriminant?: string }[] = [];
  const discriminants = new Map<number, string>();
  let hasDuplicateDiscriminant = false;
  for (const member of ast.members(node)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum-member",
        "Enum declaration contains an undefined member slot.",
      ));
      return undefined;
    }
    const memberName = context.input.program.names.nameForDeclaration(member) ?? "";
    if (!isValidRustIdentifier(memberName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum member names must be valid Rust identifiers.",
      ));
      return undefined;
    }
    const constant = context.input.program.enumMemberConstants.forMember(member);
    const value = constant?.value;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum members require integer constants evaluated by TSTS.",
      ));
      return undefined;
    }
    const previousMember = discriminants.get(value);
    if (previousMember !== undefined) {
      hasDuplicateDiscriminant = true;
    } else {
      discriminants.set(value, memberName);
    }
    variants.push({ declaration: member, name: memberName, discriminant: String(value) });
  }
  const visibility = ast.hasModifierKind(node, "export") ||
      rustProjectTypeHasPublicImplementationAbi(context, enumName)
    ? "public" as const
    : "crate" as const;
  const deadCode = rustAuthoredDeadCodeDisposition(context, node);
  if (hasDuplicateDiscriminant) {
    const enumType = { kind: "named" as const, path: enumName };
    const discriminantDeadCode = rustGeneratedEnumDiscriminantDeadCodeDisposition(
      context,
      node,
    );
    return [{
      kind: "struct",
      name: enumName,
      visibility,
      attrs: [...planRustAttributes(node, context), rustListAttribute("repr", [rustWordAttribute("transparent")]), ...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq", "Eq", "Hash"])],
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
              value: { kind: "int-literal" as const, text: variant.discriminant! },
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
    attrs: [...planRustAttributes(node, context), ...rustDeriveAttributes(["Clone", "Copy", "Debug", "PartialEq"])],
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
