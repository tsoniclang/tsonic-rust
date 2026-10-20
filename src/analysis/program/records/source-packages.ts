import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustSourcePackageFacadePlan, RustSourcePackageEmissionRecords } from "../../../target-model/records/source-packages.js";

export function createRustSourcePackageEmissionProducer(assertOpen: () => void) {
  let facades: RustSourcePackageFacadePlan | undefined;
  const records: RustSourcePackageEmissionRecords = Object.freeze({
    sourcePackageFacades: Object.freeze({ get: () => facades }),
  });
  return Object.freeze({ records,
    facades(value: RustSourcePackageFacadePlan): void {
      assertOpen();
      if (facades !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package facade paths have one owner.");
      facades = Object.freeze(value);
    },
  });
}

export type RustSourcePackageEmissionProducer = ReturnType<typeof createRustSourcePackageEmissionProducer>;
