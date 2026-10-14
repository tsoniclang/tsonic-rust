import type { Node } from "@tsonic/tsts";
import type { RustPlanningContext } from "./context.js";
import type { RustDeadCodeDisposition } from "../target-ast/syntax/nodes.js";
import type {
  RustDispatchMemberRole,
  RustGeneratedProjectFieldRole,
} from "../../analysis/reachability/generated-item-usage-model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

interface RustLivenessPlanningContext {
  readonly input: RustPlanningContext;
}

export function rustAuthoredDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
): RustDeadCodeDisposition | undefined {
  return context.input.program.reachability.suppressedDeclarations.has(declaration)
    ? "authored-declaration"
    : undefined;
}

export function rustAuthoredFieldDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  owner: Node,
  field: Node,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  const liveness = context.input.program.reachability;
  return publiclyReachable || liveness.externallyReachable.has(owner) ||
      liveness.readAuthoredFields.has(field)
    ? undefined
    : "authored-unread-field";
}

export function rustProjectInterfaceDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  if (publiclyReachable) return undefined;
  const liveness = context.input.program.reachability;
  if (liveness.suppressedDeclarations.has(declaration)) return "authored-declaration";
  return liveness.constructedProjectTypes.has(declaration) || liveness.reifiedProjectTypes.has(declaration)
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
  const liveness = context.input.program.reachability;
  if (constructor !== owner) {
    return liveness.suppressedDeclarations.has(constructor)
      ? "authored-declaration"
      : undefined;
  }
  return liveness.invokedProjectConstructors.has(owner)
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
  const liveness = context.input.program.reachability;
  return liveness.usedProjectFields.get(declaration)?.has(role) === true
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
  return publiclyReachable || context.input.program.reachability.suppressedDeclarations.has(owner) ||
      context.input.program.reachability.usedDispatchMembers.get(declaration)?.has(role) === true
    ? undefined
    : "generated-unused-dispatch";
}

export function rustGeneratedDowncastDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  source: Node,
  target: Node,
  publiclyReachable = false,
): RustDeadCodeDisposition | undefined {
  return publiclyReachable || context.input.program.reachability.suppressedDeclarations.has(source) ||
      context.input.program.reachability.usedDowncasts.get(source)?.has(target) === true
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
  hasPayload = false,
): RustDeadCodeDisposition | undefined {
  const liveness = context.input.program.reachability;
  if (liveness.externallyReachable.has(declaration) || liveness.suppressedDeclarations.has(declaration)) return undefined;
  if (!(liveness.declarationVariants.get(declaration)?.used.has(variantName) === true)) return "authored-unused-variant";
  return hasPayload && !liveness.declarationVariants.get(declaration)?.read.has(variantName)
    ? "authored-unread-field" : undefined;
}

export function rustGeneratedEnumDiscriminantDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  declaration: Node,
): RustDeadCodeDisposition | undefined {
  const liveness = context.input.program.reachability;
  return liveness.externallyReachable.has(declaration) ||
      liveness.suppressedDeclarations.has(declaration)
    ? undefined
    : "generated-enum-discriminant";
}

export function rustGeneratedUnionVariantDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  carriers: readonly TargetTypeRef[],
  variantName: string,
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  if (publiclyReachable || !carriers.some(carrier => context.input.program.reachability.structuralCarriers.get(carrier)?.used === true)) return undefined;
  if (!carriers.some(carrier => context.input.program.reachability.structuralCarriers.get(carrier)?.variants.constructed.has(variantName) === true)) {
    return "generated-unconstructed-variant";
  }
  return carriers.some(carrier => context.input.program.reachability.structuralCarriers.get(carrier)?.variants.read.has(variantName) === true)
    ? undefined : "authored-unread-field";
}

export function rustStructuralShapeDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  carriers: readonly TargetTypeRef[],
  publiclyReachable: boolean,
): RustDeadCodeDisposition | undefined {
  return publiclyReachable || carriers.some(carrier => context.input.program.reachability.structuralCarriers.get(carrier)?.used === true)
    ? undefined
    : "generated-unconstructed-shape";
}

export function rustStructuralFieldDeadCodeDisposition(
  context: RustLivenessPlanningContext,
  carriers: readonly TargetTypeRef[],
  storageIndex: number,
  publiclyReachable: boolean,
  role: "value" | "getter" | "setter",
): RustDeadCodeDisposition | undefined {
  if (publiclyReachable || !carriers.some(carrier => context.input.program.reachability.structuralCarriers.get(carrier)?.used === true)) {
    return undefined;
  }
  const used = carriers.some(carrier => role === "setter"
    ? context.input.program.reachability.structuralCarriers.get(carrier)?.fieldsWritten.has(storageIndex) === true
    : context.input.program.reachability.structuralCarriers.get(carrier)?.fieldsRead.has(storageIndex) === true);
  return used ? undefined : "authored-unread-field";
}
