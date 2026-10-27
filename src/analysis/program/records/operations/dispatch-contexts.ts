import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustBinaryDispatchEmission, RustDispatchInputEmission, RustDispatchRootEmission, RustDispatchContextEmissionRecords } from "../../../../target-model/records/operations/dispatch-contexts.js";
import type { RustFinalizedDispatchContextInput } from "../../../../target-model/records/operations/finalized-operation.js";

export function createRustDispatchContextEmissionProducer(assertOpen: () => void) {
  const roots = new Map<string, readonly RustDispatchRootEmission[]>();
  const binary = new Map<string, RustBinaryDispatchEmission>();
  const inputs = new Map<string, Map<RustFinalizedDispatchContextInput, RustDispatchInputEmission>>();
  const records: RustDispatchContextEmissionRecords = Object.freeze({
    dispatchRoots: Object.freeze({ get: (component: string) => roots.get(component) }),
    binaryDispatch: Object.freeze({ get: (hook: string) => binary.get(hook) }),
    dispatchInput: Object.freeze({ get: (component: string, input: RustFinalizedDispatchContextInput) => inputs.get(component)?.get(input) }),
  });
  return Object.freeze({ records,
    input(component: string, subject: RustFinalizedDispatchContextInput, value: RustDispatchInputEmission): void {
      assertOpen();
      const selected = inputs.get(component) ?? new Map<RustFinalizedDispatchContextInput, RustDispatchInputEmission>();
      if (selected.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native dispatch input has one exact component-owned projection.");
      selected.set(subject, Object.freeze(value));
      inputs.set(component, selected);
    },
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
