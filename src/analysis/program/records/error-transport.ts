import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustBoundaryErrorVariants, RustErrorTransportEmissionRecords, RustPlannedErrorVariant } from "../../../target-model/records/error-transport.js";
import type { RustProgramErrorModuleEmission } from "../../../target-model/records/error-transport.js";

export function createRustErrorTransportEmissionProducer(assertOpen: () => void) {
  const variants = new Map<string, readonly RustPlannedErrorVariant[]>();
  const modules = new Map<string, RustProgramErrorModuleEmission>();
  const boundaries = new Map<string, Map<string, RustBoundaryErrorVariants>>();
  const records: RustErrorTransportEmissionRecords = Object.freeze({
    programErrorModule: Object.freeze({ get: (component: string) => modules.get(component) }),
    programErrorVariants: Object.freeze({ get: (component: string) => variants.get(component) }),
    boundaryErrorVariants: Object.freeze({ get: (component: string, identity: string) => boundaries.get(component)?.get(identity) }),
  });
  return Object.freeze({ records,
    module(component: string, value: RustProgramErrorModuleEmission): void {
      assertOpen();
      if (modules.has(component)) failTargetAnalysisInvariant("tsonic-rust", "A program error module has one exact native transport owner.");
      modules.set(component, Object.freeze(value));
    },
    variants(component: string, value: readonly RustPlannedErrorVariant[]): void {
      assertOpen();
      if (variants.has(component)) failTargetAnalysisInvariant("tsonic-rust", "A native error domain has one exact variant inventory.");
      variants.set(component, Object.freeze(value));
    },
    boundary(component: string, identity: string, value: RustBoundaryErrorVariants): void {
      assertOpen();
      const selected = boundaries.get(component) ?? new Map<string, RustBoundaryErrorVariants>();
      if (selected.has(identity)) failTargetAnalysisInvariant("tsonic-rust", "A native error boundary has one exact closed payload inventory.");
      selected.set(identity, Object.freeze(value));
      boundaries.set(component, selected);
    },
  });
}

export type RustErrorTransportEmissionProducer = ReturnType<typeof createRustErrorTransportEmissionProducer>;
