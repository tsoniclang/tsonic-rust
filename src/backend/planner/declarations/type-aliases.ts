import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import { planRustTypeFamilyDeclaration } from "./type-families.js";
import { rustProjectTypeHasPublicImplementationAbi } from "../program/plan-context.js";
import { rustAuthoredDeadCodeDisposition, rustAuthoredVariantDeadCodeDisposition } from "../program/reachability-directives.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustSourceDeclarationGenerics } from "./callables/generics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustSourceUnionPayloadTemplate } from "../types/source-union-payloads.js";

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const admitted = context.input.program.nativeDeclarations.get(node);
  if (admitted?.kind !== "alias") return failRustPlannerInvariant(
    "Type-alias emission requires its sealed native declaration admission.", node);
  const { fact, name: aliasName } = admitted;
  if (fact.kind === "family") return planRustTypeFamilyDeclaration(node, context);
  const { ast } = context.input.program.source;
  if (fact.kind === "erased") {
    return [];
  }
  if (fact.kind === "native-alias") {
    const contract = admitted.genericContract;
    const generics = contract === undefined
      ? undefined
      : rustSourceDeclarationGenerics(contract);
    if (generics === undefined || admitted.nativeCarrier === null) return failRustPlannerInvariant(
      "An admitted native alias lost its selected generic contract or native type.", node);
    const target = rustTypeFromSelectedNativeCarrierInContext(admitted.nativeCarrier, context);
    const visibility = ast.hasModifierKind(node, "export")
      ? "public" as const
      : "crate" as const;
    const deadCode = rustAuthoredDeadCodeDisposition(context, node);
    return [{
      kind: "type-alias",
      name: aliasName,
      ...(deadCode === undefined ? {} : { deadCode }),
      visibility,
      generics,
      target,
    }];
  }
  const visibility = ast.hasModifierKind(node, "export") ||
      rustProjectTypeHasPublicImplementationAbi(context, aliasName)
    ? "public" as const
    : "crate" as const;
  const deadCode = rustAuthoredDeadCodeDisposition(context, node);
  const sourceContract = admitted.genericContract;
  const unionGenerics = sourceContract === undefined
    ? emptyRustGenerics
    : rustSourceDeclarationGenerics(sourceContract);
  if (unionGenerics === undefined) return failRustPlannerInvariant(
    "An admitted runtime union lost its selected native generic contract.", node);
  const template = admitted.payloadTemplate;
  const payloadPlan = template === null ? undefined : planRustSourceUnionPayloadTemplate(template, unionGenerics,
    selected => rustTypeFromSelectedNativeCarrierInContext(selected, context));
  if (fact.kind === "runtime" && payloadPlan === undefined) {
    return failRustPlannerInvariant("An admitted runtime alias lost its selected native payload template.", node);
  }
  return [{
    kind: "enum",
    generics: payloadPlan?.generics ?? unionGenerics,
    name: aliasName,
    visibility,
    ...(deadCode === undefined ? {} : { deadCode }),
    attrs: rustDeriveAttributes(fact.kind === "string-literal"
      ? ["Clone", "Copy", "Debug", "PartialEq"]
      : ["Clone"]),
    variants: fact.variants.map((variant, index) => {
      const variantDeadCode = rustAuthoredVariantDeadCodeDisposition(
        context,
        node,
        variant.name,
        fact.kind === "runtime",
      );
      return {
        name: variant.name,
        ...(variantDeadCode === undefined ? {} : { deadCode: variantDeadCode }),
        ...(fact.kind === "runtime"
          ? { fields: payloadPlan!.variants[index]!.fields }
          : {}),
      };
    }),
  }];
}
