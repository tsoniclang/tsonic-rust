import type { Node } from "@tsonic/tsts";
import type { RustTypedLocationPlan } from "../../../../target-model/records/operations/operations.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

import type { RustTypedLocationOperands } from "../../../../target-model/records/storage/typed-location-operands.js";

export interface RustTypedLocationProducer {
  readonly records: RustRecordFamily<RustTypedLocationPlan>;
  finalize(call: Node, pointeeCarrier: TargetTypeRef, locationCarrier: TargetTypeRef,
    operands: RustTypedLocationOperands): void;
}

export function createRustTypedLocationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustTypedLocationPlan>,
): RustTypedLocationProducer {
  const family = createRustRecordFamily({
    id: "tsonic.rust.typedLocationPlan", equals: rustTypedLocationPlanEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(call: Node, pointeeCarrier: TargetTypeRef, locationCarrier: TargetTypeRef,
      operands: RustTypedLocationOperands): void {
      family.writer.set(call, Object.freeze({ ...operands, call, pointeeCarrier, locationCarrier }));
    },
  });
}

function rustTypedLocationPlanEquals(left: RustTypedLocationPlan, right: RustTypedLocationPlan): boolean {
  if (left.operation !== right.operation || left.call !== right.call ||
    !rustTargetTypeRefEquals(left.pointeeCarrier, right.pointeeCarrier) ||
    !rustTargetTypeRefEquals(left.locationCarrier, right.locationCarrier)) return false;
  switch (left.operation) {
    case "address-of":
      return right.operation === "address-of" &&
        left.storageExpression === right.storageExpression &&
        left.storageDeclaration === right.storageDeclaration &&
        left.rootExpression === right.rootExpression &&
        left.rootDeclaration === right.rootDeclaration && left.locationIdentity === right.locationIdentity;
    case "allocate":
      return right.operation === "allocate" && left.initialExpression === right.initialExpression &&
        left.locationIdentity === right.locationIdentity;
    case "load":
      return right.operation === "load" && left.pointerExpression === right.pointerExpression;
    case "store":
      return right.operation === "store" && left.pointerExpression === right.pointerExpression &&
        left.valueExpression === right.valueExpression;
    case "equal-pointer":
      return right.operation === "equal-pointer" && left.leftExpression === right.leftExpression &&
        left.rightExpression === right.rightExpression;
    case "hash-pointer":
      return right.operation === "hash-pointer" && left.pointerExpression === right.pointerExpression;
    case "bind-pointer":
      return right.operation === "bind-pointer" && left.identityExpression === right.identityExpression &&
        left.readExpression === right.readExpression && left.writeExpression === right.writeExpression;
    case "project-pointer":
      return right.operation === "project-pointer" && left.pointerExpression === right.pointerExpression &&
        left.optional === right.optional && left.fromSourceExpression === right.fromSourceExpression &&
        left.toSourceExpression === right.toSourceExpression &&
        rustTargetTypeRefEquals(left.sourcePointeeCarrier, right.sourcePointeeCarrier);
    case "view-pointer":
      return right.operation === "view-pointer" && left.pointerExpression === right.pointerExpression &&
        left.optional === right.optional && left.readExpression === right.readExpression &&
        left.writeExpression === right.writeExpression &&
        rustTargetTypeRefEquals(left.sourcePointeeCarrier, right.sourcePointeeCarrier);
  }
}
