import type { RustSuspendedCallableImplementation } from "../../../analysis/callables/suspended-values.js";
import type { RustType } from "../../target-ast/nodes.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";

export function rustSuspendedCallableStateType(
  implementation: RustSuspendedCallableImplementation, context: RustTypeRenderingContext,
): Extract<RustType, { kind: "named" }> | undefined {
  const module = context.moduleNameByFileName.get(implementation.sourceFileName);
  if (module === undefined) return undefined;
  const external = context.externalCrateNameByFileName.get(implementation.sourceFileName);
  const crate = external !== undefined && external !== context.crateName ? external : "crate";
  return { kind: "named", path: `${crate}::${module}::${implementation.stateName}`, genericArguments: [
    ...implementation.environment.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime: rustLifetimeToAst(lifetime) })),
    ...implementation.environment.typeNames.map(path => ({ kind: "type" as const, type: { kind: "named" as const, path } })),
  ] };
}
