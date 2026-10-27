import type { RustPhysicalCallableStorage } from "../../../../target-model/records/native/native-storage.js";

export function sealRustPhysicalCallableStorage(input: RustPhysicalCallableStorage): RustPhysicalCallableStorage {
  return Object.freeze({ issues: Object.freeze([...input.issues]),
    valueFor: input.valueFor, operandFor: input.operandFor, returnFor: input.returnFor,
    invocationCallableFor: input.invocationCallableFor, parameterFor: input.parameterFor,
    futureEnvironmentFor: input.futureEnvironmentFor, invocationWitnessFor: input.invocationWitnessFor,
    invocationArgumentWitnessFor: input.invocationArgumentWitnessFor, joinWriteFor: input.joinWriteFor,
  });
}
