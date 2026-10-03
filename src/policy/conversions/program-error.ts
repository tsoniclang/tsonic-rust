import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectTypePolicy } from "../types/project-types.js";
import { rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustRuntimeErrorBoundary, type RustProgramErrorConversion, type RustProgramErrorRoute } from "../../target-model/conversions/program-error.js";
import { rustUnionLeaves } from "../../target-model/types/union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier } from "../../target-model/types/carriers/source-error.js";

export function selectRustProgramErrorConversion(
  source: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  providerErrorCarriers: readonly TargetTypeRef[] = [],
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  target: TargetTypeRef = rustProgramErrorTargetType(),
): RustProgramErrorConversion | undefined {
  const sourceError = isRustSourceErrorCarrier(target);
  const selectRoute = (carrier: TargetTypeRef): RustProgramErrorRoute | undefined => {
    if (isRustSourceErrorCarrier(carrier) && (!sourceError || !isRustWritableSourceErrorCarrier(target) && isRustWritableSourceErrorCarrier(carrier))) return Object.freeze({ kind: "source-error" });
    if (isRustMutableJsErrorCarrier(carrier)) return Object.freeze({ kind: "source-created" });
    const boundary = selectRustRuntimeErrorBoundary(carrier, providerErrorCarriers);
    if (boundary !== undefined && !isRustWritableSourceErrorCarrier(target)) return Object.freeze({ kind: "runtime", boundary });
    const definition = projectTypes.definitionForCarrier(carrier);
    const variant = definition === undefined ? undefined : projectTypes.programErrorVariant(definition);
    if (definition !== undefined && variant !== undefined &&
      (!sourceError || projectTypes.sourceErrorDefinitions.includes(definition)) &&
      rustTargetTypeRefEquals(projectTypes.openCarrier(definition), carrier)) {
      return Object.freeze({ kind: "project", variant });
    }
    const leaves = rustUnionLeaves(carrier, definitions);
    if (leaves === undefined) return undefined;
    const arms: Extract<RustProgramErrorRoute, { readonly kind: "union" }>["arms"][number][] = [];
    for (const leaf of leaves) {
      const route = selectRoute(leaf.carrier);
      if (route === undefined) return undefined;
      arms.push(Object.freeze({ ...leaf, route }));
    }
    return Object.freeze({ kind: "union", arms: Object.freeze(arms) });
  };
  const route = selectRoute(source);
  return route === undefined ? undefined : Object.freeze({ kind: "program-error", source, target, route });
}
