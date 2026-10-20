import type { RustOptionalDefaultPolicyInput } from "../model/optional-storage.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function selectRustOptionalDefaultStorage(input: RustOptionalDefaultPolicyInput): boolean {
  return rustTargetTypeRefEquals(input.result, input.storage) && !rustTargetTypeRefEquals(rustOptionalStorageValue(input.storage), input.storage);
}
