import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/index.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, rustLocalBindingName, sourceTypePath } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export type RustSourceUnionFieldFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "source-union-field" }
>;

export type RustSelectedSourceUnionField = NonNullable<
  RustSourceUnionFieldFact["variants"][number]["field"]
>;

export function planRustSourceUnionFieldProjection(
  node: Node,
  receiver: RustExpr,
  fact: RustSourceUnionFieldFact,
  context: RustPlanContext,
  project: (
    payload: RustExpr,
    field: RustSelectedSourceUnionField,
    variantIndex: number,
  ) => RustExpr | undefined,
): RustExpr | undefined {
  const union = rustSourceUnionCarrierValue(fact.unionCarrier);
  const typePath = union === undefined ? undefined : sourceTypePath(context, union);
  if (union === undefined || typePath === undefined || context.syntheticNames === undefined ||
    union.variants.length !== fact.variants.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-union-field-shape",
      "Source-union field access has no exact emitted union shape or hygienic binding scope.",
    ));
    return undefined;
  }
  const selectedVariantIndexes = new Set(fact.selectedVariantIndexes);
  if (selectedVariantIndexes.size !== fact.selectedVariantIndexes.length ||
    fact.selectedVariantIndexes.some((index) =>
      !Number.isInteger(index) || index < 0 || index >= fact.variants.length)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-union-field-shape",
      "Source-union field fact contains an invalid selected-variant set.",
    ));
    return undefined;
  }
  const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
  for (const [variantIndex, variant] of fact.variants.entries()) {
    const declaredVariant = union.variants[variantIndex];
    if (declaredVariant === undefined || declaredVariant.name !== variant.name ||
      !rustTargetTypeRefEquals(declaredVariant.carrier, variant.carrier) ||
      selectedVariantIndexes.has(variantIndex) !== (variant.field !== undefined)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-union-field-shape",
        "Source-union field fact conflicts with the finalized union variant contract.",
      ));
      return undefined;
    }
    const binding = variant.field === undefined
      ? undefined
      : allocateRustSyntheticName(
          context.syntheticNames,
          `union_${rustLocalBindingName(variant.name)}`,
        );
    const value = variant.field === undefined
      ? {
          kind: "unreachable" as const,
          message: "TSTS-selected source refinement excluded this union variant",
        }
      : project({ kind: "path", path: binding! }, variant.field, variantIndex);
    if (value === undefined) {
      return undefined;
    }
    arms.push({
      pattern: {
        kind: "tuple-variant",
        path: `${typePath}::${variant.name}`,
        elements: [binding === undefined
          ? { kind: "wildcard" }
          : { kind: "binding", name: binding }],
      },
      expression: value,
    });
  }
  return {
    kind: "match",
    expression: { kind: "reference", expr: receiver },
    arms,
  };
}
