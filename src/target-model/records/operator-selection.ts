import type { RustTargetOperationFact } from "./operations.js";

export type RustAssignmentOperationFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "operator-token" | "operator-call" }
>;

export type RustAssignmentOperationPlan =
  | Omit<Extract<RustAssignmentOperationFact, { readonly kind: "operator-token" }>, "operationId">
  | Extract<RustAssignmentOperationFact, { readonly kind: "operator-call" }>;
