import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustBorrowedSequenceInput } from "../../../../target-model/records/storage/borrowed-sequences.js";
import type { RustBorrowedSequenceEmission, RustArrayLiteralRecords } from "../../../../target-model/records/operations/array-literals.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function createRustArrayLiteralProducer(assertOpen: () => void) {
  const borrowed = new Map<RustBorrowedSequenceInput, Map<string, RustBorrowedSequenceEmission>>();
  const records: RustArrayLiteralRecords = Object.freeze({ borrowedSequenceEmission: Object.freeze({
    get: (input: RustBorrowedSequenceInput, target: TargetTypeRef) => borrowed.get(input)?.get(closedMetadataKey(target)),
  }) });
  return Object.freeze({ records,
    borrowed(input: RustBorrowedSequenceInput, target: TargetTypeRef, value: RustBorrowedSequenceEmission): void {
      assertOpen();
      const values = borrowed.get(input) ?? new Map<string, RustBorrowedSequenceEmission>();
      const key = closedMetadataKey(target);
      if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A borrowed array input has one exact native consumption owner.", input.expression);
      values.set(key, Object.freeze(value)); borrowed.set(input, values);
    },
  });
}

export type RustArrayLiteralProducer = ReturnType<typeof createRustArrayLiteralProducer>;
