import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustDispatchRootEmission, RustDispatchContextEmissionRecords } from "../../../target-model/records/dispatch-contexts.js";

export function createRustDispatchContextEmissionProducer(assertOpen: () => void) {
  const roots = new Map<string, readonly RustDispatchRootEmission[]>();
  const records: RustDispatchContextEmissionRecords = Object.freeze({
    dispatchRoots: Object.freeze({ get: (component: string) => roots.get(component) }),
  });
  return Object.freeze({ records,
    roots(component: string, value: readonly RustDispatchRootEmission[]): void {
      assertOpen();
      if (roots.has(component)) failTargetAnalysisInvariant("tsonic-rust", "Native dispatch roots have one exact component owner.");
      roots.set(component, Object.freeze(value));
    },
  });
}

export type RustDispatchContextEmissionProducer = ReturnType<typeof createRustDispatchContextEmissionProducer>;
