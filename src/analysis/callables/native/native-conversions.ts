import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";

import type { RustNativeCallablePhysicalSource } from "../../../target-model/records/callable-conversions.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

import { rustValueCarrierBeforeContextualConversion } from "../../conversions/value-carrier-queries.js";

import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native-producers.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import type { RustFrameCallablePlan } from "../../../target-model/records/frame-callables.js";
import { rustInfallibleTargetId } from "../../../target-model/types/carriers/source-types.js";

export function rustNativeCallableOperand(
  source: TargetTypeRef,
  node: Node,
  input: {
    readonly records: RustProgramRecords;
    readonly storage: Pick<RustNativeStoragePlan, "operandFor">;
    readonly producers: RustNativeCallableProducerPlan;
    readonly frames: Pick<RustFrameCallablePlan, "errorFor">;
  },
): RustNativeCallablePhysicalSource | undefined {
  const reference = input.records.directCallableReference.get(node);
  if (reference !== undefined) {
    if (!rustTargetTypeRefEquals(reference.carrier, source)) return undefined;
    const carrier = input.producers.physicalFor(reference.sourceDeclaration, source);
    return carrier === undefined ? undefined
      : rustNativeCallablePhysicalSource(source, { kind: "identity", carrier }, input.frames);
  }
  if (!rustTargetTypeRefEquals(rustValueCarrierBeforeContextualConversion(input.records, node), source)) return undefined;
  const lambda = input.records.lambdaBody.get(node);
  if (lambda?.construction === "native" && lambda.nativeClosure !== undefined) {
    if (!rustTargetTypeRefEquals(lambda.constructionCarrier, source)) return undefined;
    const error = lambda.resultFallible ? lambda.invocationError
      : Object.freeze({ kind: "target-named" as const, id: rustInfallibleTargetId });
    return error === undefined ? undefined : Object.freeze({ carrier: lambda.constructionCarrier,
      signature: Object.freeze({ parameters: lambda.nativeClosure.parameters, result: lambda.resultCarrier, error }) });
  }
  if (lambda?.construction === "native" && lambda.protocol !== undefined) {
    if (!rustTargetTypeRefEquals(lambda.constructionCarrier, source) || lambda.physicalCarrier === undefined) return undefined;
    return rustNativeCallablePhysicalSource(source, { kind: "identity", carrier: lambda.physicalCarrier }, input.frames);
  }
  return rustNativeCallablePhysicalSource(source, input.storage.operandFor(node), input.frames);
}

import { rustNativeCallablePhysicalSource } from "../../../policy/conversions/native-callables.js";
