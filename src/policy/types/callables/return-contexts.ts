import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import type { RustSuspendedCallableStorage } from "../../../target-model/records/callables/callables-and-resources.js";

export function rustRetainedCallableStorage(
  records: RustProgramRecords, declaration: Node,
): RustSuspendedCallableStorage | undefined {
  const generator = records.generator.get(declaration);
  if (generator !== undefined) return generator.storage;
  const asynchronous = records.asyncFunction.get(declaration);
  return asynchronous?.kind === "js-promise" && asynchronous.lowering.kind === "factory" ? asynchronous.lowering.storage : undefined;
}

export function rustCallableInvocationResult(
  records: RustProgramRecords, declaration: Node | undefined,
): TargetTypeRef | undefined {
  if (declaration === undefined) return undefined;
  return rustSuspendedCallableInvocationResult(records, declaration) ??
    records.sourceCallableReturn.get(declaration)?.returnCarrier;
}

export function rustSuspendedCallableInvocationResult(
  records: RustProgramRecords, declaration: Node | undefined,
): TargetTypeRef | undefined {
  return declaration === undefined ? undefined
    : records.generator.get(declaration)?.resultCarrier ??
      records.asyncFunction.get(declaration)?.futureCarrier;
}
