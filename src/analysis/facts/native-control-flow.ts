import { defineRustPlanKey } from "../../target-model/facts/keys.js";

export const rustNativeGuardResultFactKey = defineRustPlanKey<boolean>("nativeGuardResult", (left, right) => left === right);
export const rustNativeUnreachableFactKey = defineRustPlanKey<boolean>("nativeUnreachable", (left, right) => left === right);
