import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals, hasExactObjectKeys } from "../../target-model/metadata/closed-data.js";
import { isRustCapturedFieldStorage } from "../../target-model/types/field-storage.js";
import type { RustTargetProgram } from "../program/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { selectRustCapturedFieldStorage } from "../../policy/ownership/captured-field-storage.js";
import type { RustCapturedFieldStorageFact } from "../../target-model/records/receiver-captures.js";

export function validatedRustCapturedFieldStorageFact(
  declaration: Node,
  program: Pick<RustTargetProgram, "objectRepresentations"> & { readonly records: RustProgramRecords },
): RustCapturedFieldStorageFact | undefined {
  const fact = program.records.capturedFieldStorage.get(declaration);
  const captures = program.objectRepresentations.receiverCaptures;
  const carrier = program.records.runtimeCarrier.get(declaration)?.carrier;
  const storageCarrier = program.records.runtimeCarrier.get(captures.storageDeclaration(declaration))?.carrier;
  return captures.isCaptured(declaration) && fact !== undefined &&
    hasExactObjectKeys(fact, ["storage", "valueCarrier"]) && isRustCapturedFieldStorage(fact.storage) &&
    carrier !== undefined && storageCarrier !== undefined && rustTargetTypeRefEquals(fact.valueCarrier, carrier) &&
    closedMetadataEquals(selectRustCapturedFieldStorage(storageCarrier,
      captures.storageReadonly(declaration), captures.isDeferred(declaration), captures.storageImmutable(declaration)), fact.storage) ? fact : undefined;
}
