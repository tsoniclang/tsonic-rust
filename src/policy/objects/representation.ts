import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { RustObjectRepresentationKind } from "../../target-model/records/object-representation.js";
import { rustLifetimeOutlives, rustStaticLifetime, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";

export function selectRustObjectRepresentationKind(input: {
  readonly polymorphic: boolean;
  readonly hasLocalConstructions: boolean;
  readonly localValueEligible: boolean;
  readonly exported: boolean;
  readonly identityObserved: boolean;
  readonly escapes: boolean;
  readonly hasIncompleteFlow: boolean;
  readonly referenceRequired: boolean;
  readonly promotedStorage: boolean;
  readonly aliasedMutableValue: boolean;
  readonly mutable: boolean;
  readonly class: boolean;
}): RustObjectRepresentationKind {
  return input.polymorphic ? "open-hierarchy"
    : input.hasLocalConstructions && input.localValueEligible && !input.exported &&
      !input.identityObserved && !input.escapes && !input.hasIncompleteFlow &&
      !input.referenceRequired && !input.promotedStorage && !input.aliasedMutableValue
      ? "value" : input.mutable || !input.class ? "shared-mutable" : "shared-immutable";
}

export function selectRustMethodSelfMode(
  kind: RustObjectRepresentationKind | undefined, mutated: boolean,
): "ref" | "mut-ref" {
  return kind === "value" && mutated ? "mut-ref" : "ref";
}

export function selectRustDispatchObjectLifetime(
  definition: RustProjectTypeDefinition,
  kind: RustObjectRepresentationKind,
): RustLifetimeRef | undefined {
  if (kind !== "open-hierarchy") return undefined;
  const lifetimes = definition.genericParameters.flatMap((parameter) =>
    parameter.kind === "lifetime" ? [parameter.lifetime] : []);
  if (lifetimes.length === 0) return rustStaticLifetime;
  const contract = Object.freeze({
    declaration: definition.declaration,
    parameters: definition.genericParameters,
  });
  return lifetimes.find((candidate) =>
    lifetimes.every((source) => rustLifetimeOutlives(source, candidate, contract)));
}
