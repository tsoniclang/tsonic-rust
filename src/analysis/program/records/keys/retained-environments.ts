import { defineRustPlanKey } from "../key.js";
import { rustLifetimesEqual } from "../../../../target-model/lifetimes/index.js";
import type { RustRetainedEnvironment } from "../../../../target-model/records/retained-environments.js";

export const rustRetainedEnvironmentFactKey = defineRustPlanKey<RustRetainedEnvironment>(
  "retainedEnvironment", (left, right) => rustLifetimesEqual(left.lifetime, right.lifetime) &&
    left.parameters.length === right.parameters.length &&
    left.parameters.every((parameter, index) => parameter === right.parameters[index]));
