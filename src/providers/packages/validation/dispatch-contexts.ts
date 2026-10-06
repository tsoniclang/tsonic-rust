import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { requireExactKeys, requireRustIdentifier, requireRustPath, validateCarrier } from "./carriers.js";
import type { RustProviderPackageDefinition } from "../model.js";
import type { Fail } from "./model.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import type { RustDispatchContextProjection } from "../../../target-model/operations/dispatch-contexts.js";

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
    for (const [label, carrier] of [["root", context.rootCarrier], ["handle", context.handleCarrier]] as const) {
      if (!isRustTargetTypeRef(carrier) || carrier.kind !== "target-named") {
        fail(`dispatch context '${context.id}' ${label} requires an exact owned native named carrier`);
      }
      validateCarrier(carrier, definition, `dispatch context '${context.id}' ${label}`, fail);
    }
    requireExactKeys(context.construct,
      ["form", "path"], `dispatch context '${context.id}' construction`, fail);
    if (context.construct.form !== "call") fail(`dispatch context '${context.id}' requires a zero-input native factory call`);
    requireRustPath(context.construct.path, `dispatch context '${context.id}' factory`, fail);
    if (!isDenseDataArray(context.composedContexts)) {
      fail(`dispatch context '${context.id}' composition must be a dense metadata array`);
    }
    validateProjection(context.handle, context.id, fail);
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

function validateProjection(
  projection: RustDispatchContextProjection,
  contextId: string,
  fail: Fail,
): void {
  requireExactKeys(projection, ["form", "name"], `dispatch context '${contextId}' projection`, fail);
  if (projection.form !== "receiver-method") fail(`dispatch context '${contextId}' requires a native method projection`);
  requireRustIdentifier(projection.name, `dispatch context '${contextId}' projection method`, fail);
}
