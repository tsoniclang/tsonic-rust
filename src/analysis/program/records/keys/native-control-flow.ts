import { defineRustPlanKey } from "../key.js";

export const rustNativeGuardResultFactKey = defineRustPlanKey<boolean>("nativeGuardResult", (left, right) => left === right);

export const rustNativeUnreachableFactKey = defineRustPlanKey<boolean>("nativeUnreachable", (left, right) => left === right);
