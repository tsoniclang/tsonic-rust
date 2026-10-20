import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustSourcePackageFacadePlan, RustSourcePackageEmissionRecords } from "../../../target-model/records/source-packages.js";
import type { RustSourcePackageComponentPlan } from "../../../target-model/records/source-packages.js";

export function createRustSourcePackageEmissionProducer(assertOpen: () => void) {
  let facades: RustSourcePackageFacadePlan | undefined;
  let components: readonly RustSourcePackageComponentPlan[] | undefined;
  const records: RustSourcePackageEmissionRecords = Object.freeze({
    sourcePackageComponents: Object.freeze({ get: () => components }),
    sourcePackageFacades: Object.freeze({ get: () => facades }),
  });
  return Object.freeze({ records,
    components(value: readonly RustSourcePackageComponentPlan[]): void {
      assertOpen();
      if (components !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package components have one owner.");
      components = Object.freeze(value);
    },
    facades(value: RustSourcePackageFacadePlan): void {
      assertOpen();
      if (facades !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package facade paths have one owner.");
      facades = Object.freeze(value);
    },
  });
}

export type RustSourcePackageEmissionProducer = ReturnType<typeof createRustSourcePackageEmissionProducer>;
