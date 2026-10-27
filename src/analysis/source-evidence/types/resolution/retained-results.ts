import type { Node, Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { closeRustRetainedResult } from "../../../callables/ownership/retained-result.js";
import type { RustRetainedEnvironment } from "../../../../target-model/records/retained-environments.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { retainRustStructuralInstantiation } from "./structural-instantiations.js";
import { rustSourceStorageSubjectContext } from "./source-storage-projection.js";

export function resolveRustRetainedResult(
  declaration: Node,
  sourceType: Type | undefined,
  template: TargetTypeRef,
  parameters: readonly (TargetTypeRef | undefined)[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object> = new Set(),
): { readonly carrier: TargetTypeRef; readonly environment?: RustRetainedEnvironment } | undefined {
  const retained = closeRustRetainedResult(declaration, template, parameters, context);
  if (retained?.carrier === undefined) return undefined;
  if (!rustTargetTypeRefEquals(template, retained.carrier) && (sourceType === undefined ||
    !retainRustStructuralInstantiation(sourceType, template, retained.carrier,
      rustSourceStorageSubjectContext(context, undefined), options, resolving,
      context.ast.typeNode(declaration)))) return undefined;
  return Object.freeze({ ...retained, carrier: retained.carrier });
}
