import type { RustTypedLocationPlan } from "../operations/typed-location-plans.js";

type RustTypedLocationOperandsFor<Plan> = Plan extends RustTypedLocationPlan
  ? Omit<Plan, "call" | "pointeeCarrier" | "locationCarrier"> : never;

export type RustTypedLocationOperands = RustTypedLocationOperandsFor<RustTypedLocationPlan>;
