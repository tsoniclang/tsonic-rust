import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustRuntimeAliasUseItems } from "./plan-context.js";
import type { RustSourcePackageErrorDomainPlan } from "../../../target-model/records/errors/source-package-errors.js";

export function planRustDispatchContextRoots(
  context: RustTypeRenderingContext & {
    readonly input: import("../context.js").RustPlanningContext;
  },
  domain: RustSourcePackageErrorDomainPlan,
  programModuleName: string,
): readonly RustItem[] | undefined {
  const roots = context.input.program.records.dispatchRoots.get(domain.componentId);
  if (roots === undefined) failRustPlannerInvariant("An admitted component requires its complete sealed native dispatch root inventory.");
  const items: RustItem[] = [];
  const usedAliases = new Set<string>();
  for (const { name, carrier, construct } of roots) {
    const type = rustTypeFromCarrierInContext(carrier, { ...context, usedAliases });
    if (type === undefined) failRustPlannerInvariant("An admitted dispatch root requires its selected native carrier syntax.");
    items.push({
      kind: "thread-local", name, visibility: "public", type,
      value: { kind: "call", path: construct.path, args: [] }, constInitializer: construct.const,
    });
  }
  return [...rustRuntimeAliasUseItems(usedAliases, domain.errorDomain === "project" ? programModuleName : undefined), ...items];

}
