import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustBinaryDispatchEmission, RustDispatchRootEmission, RustDispatchContextEmissionRecords } from "../../../target-model/records/dispatch-contexts.js";

export function createRustDispatchContextEmissionProducer(assertOpen: () => void) {
  const roots = new Map<string, readonly RustDispatchRootEmission[]>();
  const binary = new Map<string, RustBinaryDispatchEmission>();
  const records: RustDispatchContextEmissionRecords = Object.freeze({
    dispatchRoots: Object.freeze({ get: (component: string) => roots.get(component) }),
    binaryDispatch: Object.freeze({ get: (hook: string) => binary.get(hook) }),
  });
  return Object.freeze({ records,
    roots(component: string, value: readonly RustDispatchRootEmission[]): void {
      assertOpen();
      if (roots.has(component)) failTargetAnalysisInvariant("tsonic-rust", "Native dispatch roots have one exact component owner.");
      roots.set(component, Object.freeze(value));
    },
    binary(hook: string, value: RustBinaryDispatchEmission): void {
      assertOpen();
      if (binary.has(hook)) failTargetAnalysisInvariant("tsonic-rust", "A binary hook has one exact native dispatch owner.");
      binary.set(hook, Object.freeze(value));
    },
  });
}

export type RustDispatchContextEmissionProducer = ReturnType<typeof createRustDispatchContextEmissionProducer>;
