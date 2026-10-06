import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustItem } from "../../target-ast/nodes.js";
import { isRustProgramErrorCarrier, rustNamedTargetType } from "../../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustDispatchContextRootName } from "../project/dispatch-contexts.js";
import { rustRuntimeAliasUseItems } from "./plan-context.js";
import type { RustSourcePackageErrorDomainPlan } from "./source-package-errors.js";

export function planRustDispatchContextRoots(
  context: RustTypeRenderingContext & {
    readonly input: import("../context.js").RustPlanningContext;
  },
  domain: RustSourcePackageErrorDomainPlan,
  programModuleName: string,
  diagnostics: TargetDiagnostic[],
): readonly RustItem[] | undefined {
  const program = context.input.program;
  const demand = program.dispatchContextDemand.forComponent(domain.componentId);
  if (demand === undefined) return invalid("A source-package component has no sealed dispatch demand.");
  const error = rustNamedTargetType(domain.errorTypeIdentity, domain.errorDomain === "runtime"
    ? "tsonic_rust_runtime::TsonicError" : `crate::${programModuleName}::TsonicError`);
  const items: RustItem[] = [];
  const usedAliases = new Set<string>();
  for (const [index, id] of demand.rootContextIds.entries()) {
    const declaration = program.dispatchContexts.declaration(id);
    if (declaration === undefined) return invalid("A demanded physical dispatch root has no exact declaration.");
    const carrier = mapRustTargetTypes(declaration.rootCarrier, type => isRustProgramErrorCarrier(type) ? error : type);
    const type = rustTypeFromCarrierInContext(carrier, { ...context, usedAliases });
    if (type === undefined) return invalid("A demanded native dispatch root has no exact renderable carrier.");
    items.push({
      kind: "thread-local", name: rustDispatchContextRootName(index), visibility: "public", type,
      value: { kind: "call", path: declaration.construct.path, args: [] }, constInitializer: declaration.construct.const,
    });
  }
  return [...rustRuntimeAliasUseItems(usedAliases, domain.errorDomain === "project" ? programModuleName : undefined), ...items];

  function invalid(message: string): undefined {
    diagnostics.push({ code: "RUST_DISPATCH_CONTEXT_ROOT_INVALID", category: "error", source: "tsonic-rust",
      message, evidence: ["rust.backend.dispatch-context-root"] });
    return undefined;
  }
}
