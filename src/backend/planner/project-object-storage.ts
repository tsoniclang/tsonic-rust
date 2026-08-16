import type { TargetTypeRef } from "../../policy/types.js";
import type { RustAssignmentOperator } from "../../common/rust-syntax.js";
import { rustProjectObjectLayout } from "../../source/rust-target-semantics/project-object-layout.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import type { RustPlanContext } from "./plan-context.js";
import {
  createRustStructuralObject,
  mutateRustProjectObjectField,
  mutateRustStructuralObjectField,
  readRustProjectObjectField,
  readRustStructuralObjectField,
  writeRustProjectObjectField,
  writeRustStructuralObjectField,
} from "./project-objects.js";

export function createRustStructuralObjectFromCarrier(
  carrier: TargetTypeRef,
  values: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  const definition = context.input.structuralShapes.definitionForCarrier(carrier);
  if (definition === undefined || definition.fields.length !== values.length) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  return createRustStructuralObject(
    `crate::${context.structuralShapesModuleName}::${definition.targetName}`,
    definition.fields.map((field, index) => ({
      name: field.targetName,
      value: values[index]!,
    })),
  );
}

export function rustDirectProjectFieldStoragePath(
  receiverCarrier: TargetTypeRef,
  storageIndex: number,
  context: RustPlanContext,
): readonly string[] | undefined {
  const definition = context.input.projectTypes.definitionForCarrier(receiverCarrier);
  if (definition === undefined || context.input.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const external = context.input.projectTypes.externalBaseForDefinition(definition)?.fields ?? [];
  const layout = rustProjectObjectLayout(definition.declaration, context.input.ast);
  const declaration = storageIndex < external.length
    ? external.find((field) => field.storageIndex === storageIndex)?.declaration
    : layout?.fields.find((field) =>
        external.length + field.storageIndex === storageIndex)?.declaration;
  const name = declaration === undefined
    ? undefined
    : context.input.projectTypes.fieldStorageName(definition, declaration);
  return name === undefined ? undefined : [name];
}

export function readRustStoredObjectField(
  storage: "project-object" | "object-handle",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  if (storage === "object-handle") {
    const name = context.input.structuralShapes.fieldName(receiverCarrier, storageIndex);
    return name === undefined
      ? undefined
      : readRustStructuralObjectField(receiver, name, resultCarrier);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  return path === undefined
    ? undefined
    : readRustProjectObjectField(receiver, path, resultCarrier);
}

export function writeRustStoredObjectField(
  storage: "project-object" | "object-handle",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  operator: RustAssignmentOperator,
  value: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  if (storage === "object-handle") {
    const name = context.input.structuralShapes.fieldName(receiverCarrier, storageIndex);
    return name === undefined
      ? undefined
      : writeRustStructuralObjectField(receiver, name, operator, value);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  return path === undefined
    ? undefined
    : writeRustProjectObjectField(receiver, path, operator, value);
}

export function mutateRustStoredObjectField(
  storage: "project-object" | "object-handle",
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  storageIndex: number,
  mutation: (field: RustExpr) => RustExpr | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (storage === "object-handle") {
    const name = context.input.structuralShapes.fieldName(receiverCarrier, storageIndex);
    return name === undefined
      ? undefined
      : mutateRustStructuralObjectField(receiver, name, mutation);
  }
  const path = rustDirectProjectFieldStoragePath(receiverCarrier, storageIndex, context);
  return path === undefined
    ? undefined
    : mutateRustProjectObjectField(receiver, path, mutation);
}
