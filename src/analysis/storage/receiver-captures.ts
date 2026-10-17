import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustCapturedFieldStorageFact } from "../../target-model/records/receiver-captures.js";

export function validatedRustCapturedFieldStorageFact(
  declaration: Node,
  program: { readonly records: Pick<RustProgramRecords, "capturedFieldStorage"> },
): RustCapturedFieldStorageFact | undefined {
  return program.records.capturedFieldStorage.get(declaration);
}
