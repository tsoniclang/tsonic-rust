import type { Node, Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { closeRustRetainedResult } from "../callables/retained-result.js";
import { closeRustSuspendedStorage } from "../storage/suspended-storage.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/retained-environments.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { retainRustStructuralInstantiation } from "./structural-instantiations.js";

export function resolveRustRetainedResult(
  declaration: Node | undefined,
  sourceType: Type | undefined,
  template: TargetTypeRef,
  parameters: readonly (TargetTypeRef | undefined)[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set(),
): { readonly carrier: TargetTypeRef; readonly environment?: RustRetainedEnvironment } | undefined {
  const retained = declaration === undefined
    ? { carrier: closeRustSuspendedStorage(template, parameters,
        context.sourceLifetimes.contractFor(declaration), "callable-result") }
    : closeRustRetainedResult(declaration, template, parameters, context);
  if (retained?.carrier === undefined) return undefined;
  if (!rustTargetTypeRefEquals(template, retained.carrier) && (sourceType === undefined ||
    !retainRustStructuralInstantiation(sourceType, template, retained.carrier, context, options, resolving,
      declaration === undefined ? undefined : context.ast.typeNode(declaration)))) return undefined;
  return Object.freeze({ ...retained, carrier: retained.carrier });
}
