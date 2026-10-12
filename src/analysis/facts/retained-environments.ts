import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import type { RustRetainedEnvironment } from "../../policy/ownership/retained-environments.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";

export const rustRetainedEnvironmentFactKey = defineRustPlanKey<RustRetainedEnvironment>(
  "retainedEnvironment", (left, right) => rustLifetimesEqual(left.lifetime, right.lifetime) &&
    left.parameters.length === right.parameters.length &&
    left.parameters.every((parameter, index) => parameter === right.parameters[index]));

export const rustRetainedCallLifetimesFactKey = defineRustPlanKey<readonly {
  readonly identity: string; readonly lifetime: RustLifetimeRef;
}[]>("retainedCallLifetimes", (left, right) => left.length === right.length && left.every((entry, index) =>
  entry.identity === right[index]?.identity && rustLifetimesEqual(entry.lifetime, right[index]?.lifetime)));

export function rustRetainedCallSubstitutions(facts: RustPlanQueries, call: Node): ReadonlyMap<string, RustLifetimeRef> {
  return new Map((facts.getFact(call, rustRetainedCallLifetimesFactKey) ?? []).map(entry => [entry.identity, entry.lifetime]));
}
