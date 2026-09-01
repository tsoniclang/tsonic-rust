import type { Node } from "@tsonic/tsts";
import type { RustPlanningContext } from "../context.js";
import type { RustDeadCodeDisposition } from "../../target-ast/nodes.js";
import type {
  RustDispatchMemberRole,
  RustGeneratedProjectFieldRole,
} from "./generated-item-usage.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

interface RustLivenessPlanningContext {
  readonly input: RustPlanningContext;
}

export function rustAuthoredDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
): RustDeadCodeDisposition | undefined {
  return context.input.liveness.requiresSuppression(declaration)
    ? "authored-declaration"
    : undefined;
}

export function rustAuthoredFieldDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  owner: Node,
  field: Node,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  const liveness = context.input.liveness;
  return publiclyReachable || liveness.isExternallyReachable(owner) ||
      liveness.isRead(field)
    ? undefined
    : "authored-unread-field";
}

export function rustProjectInterfaceDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  if (publiclyReachable) return undefined;
  const liveness = context.input.liveness;
  if (liveness.requiresSuppression(declaration)) return "authored-declaration";
  return liveness.isProjectTypeConstructed(declaration)
    ? undefined
    : "generated-unconstructed-instance";
}

export function rustProjectConstructorDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  owner: Node,
  constructor: Node,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  if (publiclyReachable) return undefined;
  const liveness = context.input.liveness;
  if (constructor !== owner) {
    return liveness.requiresSuppression(constructor)
      ? "authored-declaration"
      : undefined;
  }
  return liveness.isProjectConstructorInvoked(owner)
    ? undefined
    : "generated-retained-constructor";
}

export function rustGeneratedProjectInternalFieldDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
  role: RustGeneratedProjectFieldRole,
  publiclyVisible: boolean,
  ownerSuppressesWarnings = false,
): RustDeadCodeDisposition | undefined {
  if (publiclyVisible || ownerSuppressesWarnings) {
    return undefined;
  }
  const liveness = context.input.liveness;
  return liveness.isProjectGeneratedFieldUsed(declaration, role)
    ? undefined
    : "generated-unused-storage";
}

export function rustGeneratedProjectInterfaceFieldDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
  role: RustGeneratedProjectFieldRole,
  ownerPubliclyVisible: boolean,
  fieldPubliclyVisible: boolean,
): RustDeadCodeDisposition | undefined {
  return rustProjectInterfaceDeadCodeDisposition(
    context,
    declaration,
    ownerPubliclyVisible,
  ) !== undefined
    ? undefined
    : rustGeneratedProjectInternalFieldDeadCodeDisposition(
        context,
        declaration,
        role,
        fieldPubliclyVisible,
      );
}

export function rustGeneratedDispatchDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  owner: Node,
  declaration: Node,
  role: RustDispatchMemberRole,
  publiclyReachable = false,
): RustDeadCodeDisposition | undefined {
  return publiclyReachable || context.input.liveness.requiresSuppression(owner) ||
      context.input.liveness.isDispatchMemberUsed(declaration, role)
    ? undefined
    : "generated-unused-dispatch";
}

export function rustGeneratedDowncastDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  source: Node,
  target: Node,
  publiclyReachable = false,
): RustDeadCodeDisposition | undefined {
  return publiclyReachable || context.input.liveness.requiresSuppression(source) ||
      context.input.liveness.isDowncastUsed(source, target)
    ? undefined
    : "generated-unused-dispatch";
}

export function rustGeneratedExactStorageDeadCodeDisposition(
  used: boolean,
): RustDeadCodeDisposition | undefined {
  return used ? undefined : "generated-unused-storage";
}

export function rustAuthoredVariantDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
  variantName: string,
): RustDeadCodeDisposition | undefined {
  const liveness = context.input.liveness;
  return liveness.isExternallyReachable(declaration) ||
      liveness.requiresSuppression(declaration) ||
      liveness.isVariantConstructed(declaration, variantName)
    ? undefined
    : "authored-unused-variant";
}

export function rustGeneratedEnumDiscriminantDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
): RustDeadCodeDisposition | undefined {
  const liveness = context.input.liveness;
  return liveness.isExternallyReachable(declaration) ||
      liveness.requiresSuppression(declaration)
    ? undefined
    : "generated-enum-discriminant";
}

export function rustStructuralShapeDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  carrier: TargetTypeRef,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  return publiclyReachable || context.input.liveness.isStructuralShapeConstructed(carrier)
    ? undefined
    : "generated-unconstructed-shape";
}

export function rustStructuralFieldDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  carrier: TargetTypeRef,
  storageIndex: number,
  publiclyReachable: boolean,
  role: "value" | "getter" | "setter",
): RustDeadCodeDisposition | undefined {
  if (publiclyReachable || !context.input.liveness.isStructuralShapeConstructed(carrier)) {
    return undefined;
  }
  const used = role === "setter"
    ? context.input.liveness.isStructuralFieldWritten(carrier, storageIndex)
    : context.input.liveness.isStructuralFieldRead(carrier, storageIndex);
  return used ? undefined : "authored-unread-field";
}
