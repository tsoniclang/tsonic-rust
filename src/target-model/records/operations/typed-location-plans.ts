import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export type RustTypedLocationOperationKind =
  | "address-of"
  | "allocate"
  | "bind-pointer"
  | "hash-pointer"
  | "project-pointer"
  | "view-pointer"
  | "load"
  | "store"
  | "equal-pointer";

interface RustTypedLocationPlanBase {
  readonly call: Node;
  readonly operation: RustTypedLocationOperationKind;
  readonly pointeeCarrier: TargetTypeRef;
  readonly locationCarrier: TargetTypeRef;
}

export type RustTypedLocationPlan = RustTypedLocationPlanBase & (
  | {
      readonly operation: "address-of";
      readonly storageExpression: Node;
      readonly storageDeclaration: Node;
      readonly rootExpression: Node;
      readonly rootDeclaration: Node;
      readonly locationIdentity: Node;
    }
  | {
      readonly operation: "allocate";
      readonly initialExpression: Node;
      readonly locationIdentity: Node;
    }
  | {
      readonly operation: "load";
      readonly pointerExpression: Node;
    }
  | {
      readonly operation: "store";
      readonly pointerExpression: Node;
      readonly valueExpression: Node;
    }
  | {
      readonly operation: "equal-pointer";
      readonly leftExpression: Node;
      readonly rightExpression: Node;
    }
  | {
      readonly operation: "hash-pointer";
      readonly pointerExpression: Node;
    }
  | {
      readonly operation: "bind-pointer";
      readonly identityExpression: Node;
      readonly readExpression: Node;
      readonly writeExpression: Node;
    }
  | {
      readonly operation: "view-pointer";
      readonly pointerExpression: Node;
      readonly sourcePointeeCarrier: TargetTypeRef;
      readonly optional: boolean;
      readonly readExpression: Node;
      readonly writeExpression: Node;
    }
  | {
      readonly operation: "project-pointer";
      readonly pointerExpression: Node;
      readonly sourcePointeeCarrier: TargetTypeRef;
      readonly optional: boolean;
      readonly fromSourceExpression: Node;
      readonly toSourceExpression: Node;
    }
);
