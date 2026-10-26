import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustObjectRepresentationKind, RustObjectNativeLifetimeContract } from "../../../target-model/records/object-representation.js";
import { rustStaticLifetime } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeOutlives } from "../../constraints/lifetime-outlives.js";

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

export function selectRustObjectNativeLifetimeContract(
  definition: RustProjectTypeDefinition,
  polymorphic: boolean,
): RustObjectNativeLifetimeContract {
  const lifetimes = definition.genericParameters.flatMap((parameter) =>
    parameter.kind === "lifetime" ? [parameter.lifetime] : []);
  const contract = Object.freeze({
    declaration: definition.declaration,
    parameters: definition.genericParameters,
  });
  const dispatchObjectLifetime = !polymorphic ? undefined : lifetimes.length === 0 ? rustStaticLifetime
    : lifetimes.find(candidate => lifetimes.every(source => rustLifetimeOutlives(source, candidate, contract)));
  return Object.freeze({ dispatchObjectLifetime, ownedCallableFieldLifetime: lifetimes.length === 0 ? rustStaticLifetime : undefined,
    typeOutlives: Object.freeze(dispatchObjectLifetime?.kind !== "static" ? [] : definition.genericParameters.flatMap(parameter =>
      parameter.kind !== "type" ? [] : [Object.freeze({ identity: parameter.identity, lifetime: dispatchObjectLifetime })])) });
}
