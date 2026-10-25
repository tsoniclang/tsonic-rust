import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { RustNativeCallablePhysicalSource } from "../../target-model/records/callable-conversions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";

import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";

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
  return rustNativeCallablePhysicalSource(source, input.storage.operandFor(node), input.frames);
}

import { rustNativeCallablePhysicalSource } from "../../policy/conversions/native-callables.js";
