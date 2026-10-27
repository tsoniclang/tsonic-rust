import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import type { RustAwaitValueLeafFact } from "../../target-model/records/callables/await-values.js";

const sharedPromisePayload: readonly "clone"[] = Object.freeze(["clone"]);

export function rustAwaitValueRequirements(leaf: RustAwaitValueLeafFact): readonly "clone"[] {
  return leaf.future === undefined || leaf.carrier.kind !== "target-named" || leaf.carrier.id !== rustJsPromiseTargetId
    ? [] : sharedPromisePayload;
}
