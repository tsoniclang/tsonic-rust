import type { RustGenericRequirement } from "../../../analysis/declarations/generic-requirements.js";
import type { RustLifetimeRef, RustSourceGenericParameterContract } from "../../../target-model/lifetimes/index.js";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";
import type { RustTypeBound } from "../../target-ast/nodes.js";
import { rustLifetimeToAst } from "./lifetime-syntax.js";

export function rustGenericRequirementBounds(requirements: readonly RustGenericRequirement[]): readonly RustTypeBound[] {
  return Object.freeze(requirements.map((requirement): RustTypeBound => requirement === "static"
    ? { kind: "lifetime", lifetime: { kind: "static" } }
    : { kind: "trait", path: requirement === "clone" ? "Clone" : requirement === "default" ? "Default" : "js_abi::SourceNumeric" }));
}

export function rustTypeParameterBounds(
  parameter: Extract<RustSourceGenericParameterContract, { readonly kind: "type" }>,
  requirements: readonly RustGenericRequirement[],
  requiredOutlives: readonly RustLifetimeRef[] = [],
): readonly RustTypeBound[] {
  const outlives = [...parameter.outlives,
    ...requiredOutlives.filter(required => !parameter.outlives.some(existing => rustLifetimesEqual(existing, required)))];
  return Object.freeze([
    ...outlives.map((lifetime): RustTypeBound => ({ kind: "lifetime", lifetime: rustLifetimeToAst(lifetime) })),
    ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
    ...rustGenericRequirementBounds(requirements.filter(requirement => requirement !== "static" ||
      !outlives.some(lifetime => lifetime.kind === "static"))),
  ]);
}
