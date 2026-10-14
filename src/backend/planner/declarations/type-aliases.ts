import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import { planRustTypeFamilyDeclaration } from "./type-families.js";
import { diagnosticInput, isValidRustIdentifier, rustProjectTypeHasPublicImplementationAbi } from "../program/plan-context.js";
import { rustAuthoredDeadCodeDisposition, rustAuthoredVariantDeadCodeDisposition } from "../reachability-directives.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";

import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustSourceDeclarationGenerics } from "./callables/generics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustSourceUnionPayloadTemplate } from "../types/source-union-payloads.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const fact = context.input.program.records.runtimeCarrier.get(node) === undefined
    ? undefined : context.input.program.records.typeAliasDeclaration.get(node);
  if (fact?.kind === "family") return planRustTypeFamilyDeclaration(node, context);
  const { ast } = context.input.program.source;
  const carrier = context.input.program.records.runtimeCarrier.get(node)?.carrier;
  const aliasName = context.input.program.names.nameForDeclaration(node) ?? "";
  if (carrier === undefined || fact === undefined || !isValidRustIdentifier(aliasName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.type-alias",
      "Type aliases require one finalized Rust alias representation.",
    ));
    return undefined;
  }
  if (fact.kind === "erased") {
    return [];
  }
  if (fact.kind === "native-alias") {
    const contract = context.input.program.sourceLifetimes.contractFor(node);
    const generics = contract === undefined
      ? undefined
      : rustSourceDeclarationGenerics(contract);
    const target = rustTypeFromCarrierInContext(fact.target, context);
    if (generics === undefined || target === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.native-type-alias",
        "A lifetime-bearing type alias has no exact generic contract or renderable target type.",
      ));
      return undefined;
    }
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
  const sourceContract = context.input.program.sourceLifetimes.contractFor(node);
  const unionGenerics = sourceContract === undefined
    ? emptyRustGenerics
    : rustSourceDeclarationGenerics(sourceContract);
  if (unionGenerics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.union-generics", "Runtime union has no exact renderable generic contract."));
    return undefined;
  }
  const template = fact.kind === "runtime" ? context.input.program.typeDefinitions
    .sourceUnionPayloadTemplate(rustOptionElementCarrier(carrier) ?? carrier) : undefined;
  const payloadPlan = template === undefined ? undefined : planRustSourceUnionPayloadTemplate(template, unionGenerics,
    selected => rustTypeFromCarrierInContext(selected, context));
  if (fact.kind === "runtime" && (payloadPlan === undefined || payloadPlan.variants.length !== fact.variants.length ||
    payloadPlan.variants.some((variant, index) => variant.name !== fact.variants[index]!.name))) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.union-variant-carrier",
      "Runtime union variants require one exact renderable physical payload template."));
    return undefined;
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
