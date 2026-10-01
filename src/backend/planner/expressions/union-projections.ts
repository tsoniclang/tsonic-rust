import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, rustLocalBindingName, type RustPlanContext } from "../program/plan-context.js";
import { rustUnionTypePathInContext } from "../types/render.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function planRustNativeUnionProjection<Variant extends {
  readonly name: string; readonly carrier: TargetTypeRef;
}, Selection>(
  node: Node,
  receiver: RustExpr,
  fact: { readonly unionCarrier: TargetTypeRef; readonly selectedVariantIndexes: readonly number[];
    readonly variants: readonly Variant[] },
  context: RustPlanContext,
  selectionFor: (variant: Variant) => Selection | undefined,
  project: (payload: RustExpr, selection: Selection, variantIndex: number) => RustExpr | undefined,
): RustExpr | undefined {
  const reject = (message: string): undefined => {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.union-projection", message));
    return undefined;
  };
  if (!Array.isArray(fact.variants) || !Array.isArray(fact.selectedVariantIndexes)) {
    return reject("Native union projection requires dense variant and selection rows.");
  }
  const variants = context.input.program.typeDefinitions.sourceUnionVariants(fact.unionCarrier);
  const typePath = rustUnionTypePathInContext(fact.unionCarrier, context);
  if (variants === undefined || typePath === undefined || context.syntheticNames === undefined ||
    variants.length !== fact.variants.length) {
    return reject("Native union projection has no exact emitted shape or hygienic binding scope.");
  }
  const selected = new Set(fact.selectedVariantIndexes);
  if (selected.size === 0 || selected.size !== fact.selectedVariantIndexes.length ||
    [...fact.selectedVariantIndexes].some(index => !Number.isInteger(index) || index < 0 || index >= fact.variants.length)) {
    return reject("Native union projection contains an invalid selected-variant set.");
  }
  const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
  for (const [index, variant] of fact.variants.entries()) {
    if (variant === undefined || variant === null || variant.carrier === undefined) {
      return reject("Native union projection contains an absent variant carrier.");
    }
    const declaration = variants[index];
    const selection = selectionFor(variant);
    if (declaration === undefined || declaration.name !== variant.name ||
      !rustTargetTypeRefEquals(declaration.carrier, variant.carrier) || selected.has(index) !== (selection !== undefined)) {
      return reject("Native union projection conflicts with its finalized variant contract.");
    }
    const name = selection === undefined ? undefined
      : allocateRustSyntheticName(context.syntheticNames, `union_${rustLocalBindingName(variant.name)}`);
    const value = selection === undefined
      ? { kind: "unreachable" as const, message: "Checked native refinement excluded this union variant" }
      : project({ kind: "path", path: name! }, selection, index);
    if (value === undefined) return undefined;
    arms.push({ pattern: { kind: "tuple-variant", path: `${typePath}::${variant.name}`,
      elements: [name === undefined ? { kind: "wildcard" } : { kind: "binding", name }] }, expression: value });
  }
  return { kind: "match", expression: { kind: "reference", expr: receiver }, arms };
}
