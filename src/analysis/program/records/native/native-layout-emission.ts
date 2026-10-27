import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeMemoryLayout } from "../../../../target-model/operations/native-memory.js";
import type { RustNativeLayoutEmission, RustNativeLayoutRecords } from "../../../../target-model/records/native/native-layout-emission.js";

export function createRustNativeLayoutProducer(assertOpen: () => void) {
  const values = new WeakMap<RustNativeMemoryLayout, RustNativeLayoutEmission>();
  const records: RustNativeLayoutRecords = Object.freeze({ nativeLayoutEmission: Object.freeze({ get: (layout: RustNativeMemoryLayout) => values.get(layout) }) });
  return Object.freeze({ records, publish(layout: RustNativeMemoryLayout, value: RustNativeLayoutEmission): void {
    assertOpen();
    if (values.has(layout)) failTargetAnalysisInvariant("tsonic-rust", "A native layout has one exact emission owner.");
    values.set(layout, Object.freeze(value));
  } });
}

export type RustNativeLayoutProducer = ReturnType<typeof createRustNativeLayoutProducer>;
