import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { readRustStoredObjectField, writeRustStoredObjectField, mutateRustStoredObjectField } from "../objects/project-storage.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, rustLocalBindingName } from "../program/plan-context.js";
import { rustUnionTypePathInContext } from "../types/render.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export type RustSourceUnionFieldFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "source-union-field" }
>;

export type RustSelectedSourceUnionField = NonNullable<
  RustSourceUnionFieldFact["variants"][number]["field"]
>;

function unionFieldDispatch(field: RustSelectedSourceUnionField, carrier: TargetTypeRef, context: RustPlanContext) {
  const definition = field.declaration === undefined ? undefined : context.input.program.projectTypes.definitionContainingDeclaration(field.declaration);
  const relationship = definition === undefined ? undefined : context.input.program.projectTypes.relationship(carrier, definition);
  const plan = field.declaration === undefined ? undefined : context.input.program.projectFieldDispatch.planFor(field.declaration);
  return field.dispatch === undefined || relationship?.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, field.dispatch.ownerCarrier) || plan === undefined
    ? undefined : planRustProjectFieldDispatchRoles(plan, context);
}

export function readRustUnionField(field: RustSelectedSourceUnionField, carrier: TargetTypeRef,
  receiver: RustExpr, resultCarrier: TargetTypeRef, context: RustPlanContext): RustExpr | undefined {
  if (field.dispatch === undefined) return readRustStoredObjectField(field.storage, carrier, receiver, field.storageIndex, resultCarrier, context);
  const roles = unionFieldDispatch(field, carrier, context);
  return roles === undefined ? undefined : readRustProjectDispatchedField(receiver, field.dispatch.read, roles.read);
}

export function writeRustUnionField(field: RustSelectedSourceUnionField, carrier: TargetTypeRef,
  receiver: RustExpr, operator: RustAssignmentOperator, value: RustExpr, context: RustPlanContext): RustExpr | undefined {
  if (field.dispatch === undefined) return writeRustStoredObjectField(field.storage, carrier, receiver, field.storageIndex, operator, value, context);
  const roles = unionFieldDispatch(field, carrier, context);
  if (roles?.write === undefined || context.syntheticNames === undefined) return undefined;
  return writeRustProjectDispatchedField(receiver, allocateRustSyntheticName(context.syntheticNames, "union_receiver"),
    field.dispatch.read, field.dispatch.write, operator, value, { read: roles.read, write: roles.write });
}

export function mutateRustUnionField(field: RustSelectedSourceUnionField, carrier: TargetTypeRef,
  receiver: RustExpr, resultCarrier: TargetTypeRef, mutate: (value: RustExpr) => RustExpr | undefined,
  context: RustPlanContext): RustExpr | undefined {
  if (field.dispatch === undefined) return mutateRustStoredObjectField(field.storage, carrier, receiver, field.storageIndex, mutate, context);
  if (context.syntheticNames === undefined) return undefined;
  const currentName = allocateRustSyntheticName(context.syntheticNames, "union_current");
  const resultName = allocateRustSyntheticName(context.syntheticNames, "union_result");
  const current: RustExpr = { kind: "path", path: currentName };
  const read = readRustUnionField(field, carrier, receiver, resultCarrier, context);
  const operation = mutate(current);
  const write = writeRustUnionField(field, carrier, receiver, "=", current, context);
  return read === undefined || operation === undefined || write === undefined ? undefined : {
    kind: "block", bindings: [{ name: currentName, mutable: true, value: read }, { name: resultName, value: operation }],
    value: { kind: "evaluate-then", effect: write, discard: "unit", value: { kind: "path", path: resultName } },
  };
}

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
  const variants = context.input.program.typeDefinitions.sourceUnionVariants(fact.unionCarrier);
  const typePath = rustUnionTypePathInContext(fact.unionCarrier, context);
  if (variants === undefined || typePath === undefined || context.syntheticNames === undefined ||
    variants.length !== fact.variants.length) {
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
    const declaredVariant = variants[variantIndex];
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
