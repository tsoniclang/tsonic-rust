import type { RustTargetOperationFact } from "./operations.js";
import type { RustBinaryOperator } from "../../syntax/tokens.js";
import type { RustValueConversion } from "../../operations/model.js";
import type { RustValueReadOwnership } from "../storage/ownership.js";

export type RustAssignmentOperationFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "operator-token" | "operator-call" }
>;

export type RustAssignmentOperationPlan =
  | Omit<Extract<RustAssignmentOperationFact, { readonly kind: "operator-token" }>, "operationId">
  | Extract<RustAssignmentOperationFact, { readonly kind: "operator-call" }>;

export type RustAssignmentValueSelection = { readonly previous: RustValueReadOwnership } & (
  | { readonly kind: "plain" }
  | { readonly kind: "string-concat" }
  | { readonly kind: "binary"; readonly operator: RustBinaryOperator;
      readonly leftConversion: RustValueConversion | undefined; readonly rightConversion: RustValueConversion | undefined }
  | { readonly kind: "call"; readonly operation: Extract<RustAssignmentOperationFact, { readonly kind: "operator-call" }> }
);
