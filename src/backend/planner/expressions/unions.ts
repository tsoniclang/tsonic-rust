import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { readRustStoredObjectField, writeRustStoredObjectField, mutateRustStoredObjectField } from "../objects/project-storage.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRole, planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustNativeUnionProjection } from "./union-projections.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export type RustSourceUnionFieldFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "source-union-field" }
>;

export type RustSelectedSourceUnionField = NonNullable<
  RustSourceUnionFieldFact["variants"][number]["field"]
>;

function unionFieldDispatch(field: RustSelectedSourceUnionField, context: RustPlanContext) {
  return (field.declaration === undefined ? undefined : context.input.program.records.projectFieldDispatch.get(field.declaration))
    ?? failRustPlannerInvariant("An admitted union field requires its native dispatch plan.", field.declaration ?? context.callableDeclaration ?? context.sourceFile);
}

export function readRustUnionField(field: RustSelectedSourceUnionField, carrier: TargetTypeRef,
  receiver: RustExpr, resultCarrier: TargetTypeRef, context: RustPlanContext): RustExpr | undefined {
  if (field.dispatch === undefined) return readRustStoredObjectField(field.storage, carrier, receiver, field.storageIndex, resultCarrier, context);
  const plan = unionFieldDispatch(field, context);
  const read = planRustProjectFieldDispatchRole(plan, "read", context)
    ?? failRustPlannerInvariant("An admitted union field requires its native read role.", field.declaration ?? context.sourceFile);
  return readRustProjectDispatchedField(receiver, field.dispatch.read, read);
}

export function writeRustUnionField(field: RustSelectedSourceUnionField, carrier: TargetTypeRef,
  receiver: RustExpr, operator: RustAssignmentOperator, value: RustExpr, context: RustPlanContext): RustExpr | undefined {
  if (field.dispatch === undefined) return writeRustStoredObjectField(field.storage, carrier, receiver, field.storageIndex, operator, value, context);
  const plan = unionFieldDispatch(field, context);
  const roles = planRustProjectFieldDispatchRoles(plan, context);
  if (roles?.write === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted union field write requires its native roles and hygienic binding scope.", field.declaration ?? context.sourceFile);
  return writeRustProjectDispatchedField(receiver, allocateRustSyntheticName(context.syntheticNames, "union_receiver"),
    field.dispatch.read, field.dispatch.write, operator, value, { read: roles.read, write: roles.write });
}

export function mutateRustUnionField(field: RustSelectedSourceUnionField, carrier: TargetTypeRef,
  receiver: RustExpr, resultCarrier: TargetTypeRef, mutate: (value: RustExpr) => RustExpr | undefined,
  context: RustPlanContext): RustExpr | undefined {
  if (field.dispatch === undefined) return mutateRustStoredObjectField(field.storage, carrier, receiver, field.storageIndex, mutate, context);
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted union field mutation requires its native binding scope.", field.declaration ?? context.sourceFile);
  const currentName = allocateRustSyntheticName(context.syntheticNames, "union_current");
  const resultName = allocateRustSyntheticName(context.syntheticNames, "union_result");
  const current: RustExpr = { kind: "path", path: currentName };
  const read = readRustUnionField(field, carrier, receiver, resultCarrier, context);
  const operation = mutate(current);
  const write = writeRustUnionField(field, carrier, receiver, "=", current, context);
  return read === undefined || operation === undefined || write === undefined ? undefined : rustValueBlock([{ name: currentName, mutable: true, value: read }, { name: resultName, value: operation }], { kind: "evaluate-then", effect: write, discard: "unit", value: { kind: "path", path: resultName } });
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
  return planRustNativeUnionProjection(node, receiver, fact, context, variant => variant.field, project);
}
