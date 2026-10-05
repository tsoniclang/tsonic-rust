import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals, hasExactObjectKeys } from "../../target-model/metadata/closed-data.js";

import type { RustCapturedFieldStorage } from "../../target-model/types/field-storage.js";
import { isRustCapturedFieldStorage } from "../../target-model/types/field-storage.js";
import type { RustTargetProgram } from "../program/model.js";
import { selectRustCapturedFieldStorage } from "../../policy/ownership/captured-field-storage.js";

export interface RustCapturedFieldStorageFact {
  readonly storage: RustCapturedFieldStorage;
  readonly valueCarrier: TargetTypeRef;
}

export const rustCapturedFieldStorageFactKey = defineRustPlanKey<RustCapturedFieldStorageFact>(
  "capturedFieldStorage", (left, right) => hasExactObjectKeys(left, ["storage", "valueCarrier"]) &&
    hasExactObjectKeys(right, ["storage", "valueCarrier"]) && isRustCapturedFieldStorage(left.storage) &&
    isRustCapturedFieldStorage(right.storage) && left.valueCarrier !== undefined && right.valueCarrier !== undefined &&
    closedMetadataEquals(left.storage, right.storage) &&
    rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier),
);

export function validatedRustCapturedFieldStorageFact(
  declaration: Node,
  program: Pick<RustTargetProgram, "facts" | "objectRepresentations">,
): RustCapturedFieldStorageFact | undefined {
  const fact = program.facts.getFact(declaration, rustCapturedFieldStorageFactKey);
  const captures = program.objectRepresentations.receiverCaptures;
  const carrier = program.facts.getRuntimeCarrierFact(declaration)?.carrier;
  const storageCarrier = program.facts.getRuntimeCarrierFact(captures.storageDeclaration(declaration))?.carrier;
  return captures.isCaptured(declaration) && fact !== undefined &&
    hasExactObjectKeys(fact, ["storage", "valueCarrier"]) && isRustCapturedFieldStorage(fact.storage) &&
    carrier !== undefined && storageCarrier !== undefined && rustTargetTypeRefEquals(fact.valueCarrier, carrier) &&
    closedMetadataEquals(selectRustCapturedFieldStorage(storageCarrier,
      captures.storageReadonly(declaration), captures.isDeferred(declaration), captures.storageImmutable(declaration)), fact.storage) ? fact : undefined;
}
