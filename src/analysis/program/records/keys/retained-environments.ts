import { defineRustPlanKey } from "../key.js";
import { rustLifetimesEqual } from "../../../../target-model/lifetimes/index.js";
import type { RustRetainedEnvironment } from "../../../../target-model/records/retained-environments.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";

export const rustRetainedEnvironmentFactKey = defineRustPlanKey<RustRetainedEnvironment>(
  "retainedEnvironment", (left, right) => rustLifetimesEqual(left.lifetime, right.lifetime) &&
    left.parameters.length === right.parameters.length &&
    left.parameters.every((parameter, index) => parameter === right.parameters[index]));

export const rustRetainedCallLifetimesFactKey = defineRustPlanKey<readonly {
  readonly identity: string; readonly lifetime: RustLifetimeRef;
}[]>("retainedCallLifetimes", (left, right) => left.length === right.length && left.every((entry, index) =>
  entry.identity === right[index]?.identity && rustLifetimesEqual(entry.lifetime, right[index]?.lifetime)));
