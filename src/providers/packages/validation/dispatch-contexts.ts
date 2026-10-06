import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { requireExactKeys, requireRustIdentifier, requireRustPath, validateCarrier } from "./carriers.js";
import type { RustProviderPackageDefinition } from "../model.js";
import type { Fail } from "./model.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import type { RustDispatchContextProjection, RustDispatchContextGroupInput } from "../../../target-model/operations/dispatch-contexts.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";

export function validateDispatchContexts(definition: RustProviderPackageDefinition, fail: Fail): void {
  if (definition.dispatchContexts !== undefined && !isDenseDataArray(definition.dispatchContexts)) {
    fail("dispatch contexts must be a dense metadata array");
  }
  const ids = new Set<string>();
  const crates = new Set(definition.crates.map(crate => crate.crateName));
  for (const context of definition.dispatchContexts ?? []) {
    requireExactKeys(context,
      ["id", "requiredCrate", "rootCarrier", "construct", "handleCarrier", "handle", "composedContexts"],
      "dispatch context", fail);
    if (typeof context.id !== "string" || context.id.length === 0 || ids.has(context.id)) {
      fail("dispatch contexts require distinct non-empty identities");
    }
    ids.add(context.id);
    requireRustIdentifier(context.requiredCrate, `dispatch context '${context.id}' required crate`, fail);
    if (!crates.has(context.requiredCrate)) fail(`dispatch context '${context.id}' requires an undeclared crate`);
    validateClosedDispatchCarrier(context.rootCarrier, definition, `dispatch context '${context.id}' root`, fail);
    const hasHandleCarrier = Object.prototype.hasOwnProperty.call(context, "handleCarrier");
    const hasHandleProjection = Object.prototype.hasOwnProperty.call(context, "handle");
    if (hasHandleCarrier !== hasHandleProjection) {
      fail(`dispatch context '${context.id}' requires both handle carrier and projection or neither`);
    }
    if (hasHandleCarrier) {
      validateClosedDispatchCarrier(context.handleCarrier!, definition, `dispatch context '${context.id}' handle`, fail);
      validateProjection(context.handle!, context.id, fail);
    }
    requireExactKeys(context.construct,
      ["form", "path", "const"], `dispatch context '${context.id}' construction`, fail);
    if (context.construct.form !== "call") fail(`dispatch context '${context.id}' requires a zero-input native factory call`);
    if (typeof context.construct.const !== "boolean") fail(`dispatch context '${context.id}' requires exact native const construction evidence`);
    requireRustPath(context.construct.path, `dispatch context '${context.id}' factory`, fail);
    if (!isDenseDataArray(context.composedContexts)) {
      fail(`dispatch context '${context.id}' composition must be a dense metadata array`);
    }
    const children = new Set<string>();
    for (const child of context.composedContexts) {
      requireExactKeys(child,
        ["contextId", "project"], `dispatch context '${context.id}' composition`, fail);
      if (typeof child.contextId !== "string" || child.contextId.length === 0 || child.contextId === context.id ||
        children.has(child.contextId)) fail(`dispatch context '${context.id}' has an invalid or repeated composition identity`);
      children.add(child.contextId);
      validateProjection(child.project, context.id, fail);
    }
  }
}

export function validateDispatchContextGroups(
  groups: readonly RustDispatchContextGroupInput[] | undefined,
  phase: "before-initialization" | "async-execution" | "after-entry",
  definition: RustProviderPackageDefinition,
  label: string,
  fail: Fail,
): void {
  if (groups === undefined) return;
  if (!isDenseDataArray(groups)) fail(`${label} dispatch groups must be a dense metadata array`);
  const positions = new Set<number>();
  const contexts = new Set<string>();
  const argumentCount = groups.length + (phase === "async-execution" ? 1 : 0);
  for (const group of groups) {
    requireExactKeys(group, ["contextIds", "targetArgumentIndex", "empty", "prepend"], `${label} dispatch group`, fail);
    if (!isDenseDataArray(group.contextIds) || group.contextIds.length === 0) {
      fail(`${label} dispatch groups require a non-empty dense context identity array`);
    }
    for (const contextId of group.contextIds) {
      if (typeof contextId !== "string" || contextId.length === 0 || contexts.has(contextId)) {
        fail(`${label} dispatch groups require distinct non-empty context identities`);
      }
      contexts.add(contextId);
    }
    if (!Number.isInteger(group.targetArgumentIndex) || group.targetArgumentIndex < 0 ||
      group.targetArgumentIndex >= argumentCount || positions.has(group.targetArgumentIndex)) {
      fail(`${label} dispatch groups require distinct valid target argument positions`);
    }
    positions.add(group.targetArgumentIndex);
    requireExactKeys(group.empty, ["form", "owner", "method"], `${label} dispatch group empty`, fail);
    if (group.empty.form !== "associated-call") fail(`${label} dispatch group requires an exact native empty constructor`);
    validateClosedDispatchCarrier(group.empty.owner, definition, `${label} dispatch group empty owner`, fail);
    requireRustIdentifier(group.empty.method, `${label} dispatch group empty method`, fail);
    requireExactKeys(group.prepend, ["form", "path"], `${label} dispatch group prepend`, fail);
    if (group.prepend.form !== "call") fail(`${label} dispatch group requires an exact native prepend call`);
    requireRustPath(group.prepend.path, `${label} dispatch group prepend path`, fail);
  }
}

function validateClosedDispatchCarrier(
  carrier: import("../../../target-model/types/model.js").TargetTypeRef,
  definition: RustProviderPackageDefinition,
  label: string,
  fail: Fail,
): void {
  if (!isRustTargetTypeRef(carrier) || carrier.kind !== "target-named") {
    fail(`${label} requires an exact owned native named carrier`);
  }
  validateCarrier(carrier, definition, label, fail);
  const references = rustTargetGenericReferences(carrier);
  if (references.typeIdentities.length > 0 || references.lifetimeIdentities.length > 0 ||
    references.constIdentities.length > 0 || references.hasUnnameableLifetime) {
    fail(`${label} requires a closed component-owned native carrier`);
  }
}

function validateProjection(
  projection: RustDispatchContextProjection,
  contextId: string,
  fail: Fail,
): void {
  requireExactKeys(projection, ["form", "name"], `dispatch context '${contextId}' projection`, fail);
  if (projection.form !== "receiver-method") fail(`dispatch context '${contextId}' requires a native method projection`);
  requireRustIdentifier(projection.name, `dispatch context '${contextId}' projection method`, fail);
}
