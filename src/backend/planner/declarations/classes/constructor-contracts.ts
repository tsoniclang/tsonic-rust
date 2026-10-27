import type { RustNativeClassEmission } from "../../../../target-model/records/objects/class-emission.js";
import type { SourceCallableContract } from "../../../../target-model/records/callables/source-callable-contract.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function requireRustConstructorContract(emission: RustNativeClassEmission): SourceCallableContract {
  const contract = emission.constructorContracts[0];
  if (emission.constructorContracts.length !== 1 || contract === undefined) {
    failRustPlannerInvariant("An admitted native class requires its one selected emitted constructor contract.", emission.definition.declaration);
  }
  return contract;
}
