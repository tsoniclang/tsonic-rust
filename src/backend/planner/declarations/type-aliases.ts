import { rustDeriveAttributes } from "../../target-ast/syntax/attributes.js";
import { planRustTypeFamilyDeclaration } from "./type-families.js";
import { failRustPlannerInvariant } from "../../invariants.js";

import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustSourceDeclarationGenerics } from "./callables/generics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustSourceUnionPayloadTemplate } from "../types/source-union-payloads.js";

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const admitted = context.input.program.records.nativeDeclaration.get(node);
  if (admitted?.kind !== "alias") return failRustPlannerInvariant(
    "Type-alias emission requires its sealed native declaration admission.", node);
  const { fact, name: aliasName } = admitted;
  if (fact.kind === "family") return planRustTypeFamilyDeclaration(node, context);
  if (fact.kind === "erased") {
    return [];
  }
  if (fact.kind === "native-alias") {
    const contract = admitted.genericContract;
    const generics = contract === undefined
      ? undefined
      : rustSourceDeclarationGenerics(contract);
    const target = rustTypeFromCarrierInContext(fact.target, context);
    if (generics === undefined || target === undefined) {
      failRustPlannerInvariant("An admitted native alias requires its exact generic contract and renderable target type.", node);
    }
    const emission = context.input.program.records.declarationLiveness.get(node);
    if (emission === undefined) failRustPlannerInvariant("An admitted native alias requires its native declaration visibility and liveness.", node);
    const { visibility, deadCode } = emission;
    return [{
      kind: "type-alias",
      name: aliasName,
      ...(deadCode === undefined ? {} : { deadCode }),
      visibility,
      generics,
      target,
    }];
  }
  const emission = context.input.program.records.declarationLiveness.get(node);
  if (emission === undefined) failRustPlannerInvariant("An admitted union alias requires its native declaration visibility and liveness.", node);
  const { visibility, deadCode } = emission;
  const sourceContract = admitted.genericContract;
  const unionGenerics = sourceContract === undefined
    ? emptyRustGenerics
    : rustSourceDeclarationGenerics(sourceContract);
  if (unionGenerics === undefined) return failRustPlannerInvariant(
    "An admitted runtime union lost its selected native generic contract.", node);
  const template = admitted.payloadTemplate;
  const payloadPlan = template === undefined ? undefined : planRustSourceUnionPayloadTemplate(template, unionGenerics,
    selected => rustTypeFromCarrierInContext(selected, context));
  if (fact.kind === "runtime" && payloadPlan === undefined) {
    failRustPlannerInvariant("An admitted runtime union requires its renderable native payload template.", node);
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
      const selected = emission.variants[index];
      if (selected === undefined) failRustPlannerInvariant("An admitted union variant requires its native liveness selection.", node);
      const variantDeadCode = selected.deadCode;
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
