import type { RustTypedLocationPlan } from "../operations/operations.js";

type RustTypedLocationOperandsFor<Plan> = Plan extends RustTypedLocationPlan
  ? Omit<Plan, "call" | "pointeeCarrier" | "locationCarrier"> : never;

export type RustTypedLocationOperands = RustTypedLocationOperandsFor<RustTypedLocationPlan>;
