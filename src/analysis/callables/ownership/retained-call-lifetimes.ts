import type { RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";

export function rustRetainedCallSubstitutions(records: RustProgramRecords, call: Node): ReadonlyMap<string, RustLifetimeRef> {
  return new Map((records.retainedCallLifetimes.get(call) ?? []).map(entry => [entry.identity, entry.lifetime]));
}
