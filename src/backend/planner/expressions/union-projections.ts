import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustLocalBindingName, type RustPlanContext } from "../program/plan-context.js";
import { rustUnionTypePathInContext } from "../types/render.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustNativeUnionProjection<Variant extends { readonly name: string; readonly carrier: TargetTypeRef }, Selection>(
  node: Node, receiver: RustExpr,
  fact: { readonly unionCarrier: TargetTypeRef; readonly selectedVariantIndexes: readonly number[]; readonly variants: readonly Variant[] },
  context: RustPlanContext, selectionFor: (variant: Variant) => Selection | undefined,
  project: (payload: RustExpr, selection: Selection, variantIndex: number) => RustExpr | undefined): RustExpr {
  const typePath = rustUnionTypePathInContext(fact.unionCarrier, context)
    ?? failRustPlannerInvariant("An admitted union projection requires its native type identity.", node);
  const names = context.syntheticNames
    ?? failRustPlannerInvariant("An admitted union projection requires its hygienic binding scope.", node);
  const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
  for (const [index, variant] of fact.variants.entries()) {
    const selection = selectionFor(variant);
    const name = selection === undefined ? undefined : allocateRustSyntheticName(names, `union_${rustLocalBindingName(variant.name)}`);
    const value = selection === undefined
      ? { kind: "unreachable" as const, message: "Checked native refinement excluded this union variant" }
      : project({ kind: "path", path: name! }, selection, index)
        ?? failRustPlannerInvariant("An admitted union arm requires its native projection.", node);
    arms.push({ pattern: { kind: "tuple-variant", path: `${typePath}::${variant.name}`,
      elements: [name === undefined ? { kind: "wildcard" } : { kind: "binding", name }] }, expression: value });
  }
  return { kind: "match", expression: { kind: "reference", expr: receiver }, arms };
}
