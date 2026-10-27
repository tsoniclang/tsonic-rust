import type { RustErrorPayloadVariant, RustErrorTransportQueries } from "../../../../target-model/records/errors/error-transport.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustBoundaryErrorVariants, RustErrorTransportEmissionRecords, RustPlannedErrorVariant } from "../../../../target-model/records/errors/error-transport.js";
import type { RustProgramErrorModuleEmission } from "../../../../target-model/records/errors/error-transport.js";
import type { RustClosedErrorValueSelection } from "../../../../target-model/records/errors/error-transport.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustErrorTransportEmissionProducer(assertOpen: () => void) {
  const variants = new Map<string, readonly RustPlannedErrorVariant[]>();
  const modules = new Map<string, RustProgramErrorModuleEmission>();
  const boundaries = new Map<string, Map<string, RustBoundaryErrorVariants>>();
  const closed = new Map<string, Map<string, Map<string, RustClosedErrorValueSelection>>>();
  const records: RustErrorTransportEmissionRecords = Object.freeze({
    programErrorClosedValue: Object.freeze({ get: (component: string, identity: string, target: TargetTypeRef) => closed.get(component)?.get(identity)?.get(closedMetadataKey(target)) }),
    programErrorModule: Object.freeze({ get: (component: string) => modules.get(component) }),
    programErrorVariants: Object.freeze({ get: (component: string) => variants.get(component) }),
    boundaryErrorVariants: Object.freeze({ get: (component: string, identity: string) => boundaries.get(component)?.get(identity) }),
  });
  return Object.freeze({ records,
    closedValue(component: string, identity: string, target: TargetTypeRef, value: RustClosedErrorValueSelection): void {
      assertOpen();
      const domains = closed.get(component) ?? new Map<string, Map<string, RustClosedErrorValueSelection>>();
      const targets = domains.get(identity) ?? new Map<string, RustClosedErrorValueSelection>();
      const key = closedMetadataKey(target);
      if (targets.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A closed error value has one exact component, identity and destination owner.");
      targets.set(key, Object.freeze(value));
      domains.set(identity, targets);
      closed.set(component, domains);
    },
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


export function sealRustErrorTransportQueries(components: ReadonlyMap<string, readonly RustErrorPayloadVariant[]>): RustErrorTransportQueries {
  return Object.freeze({ forComponent: (componentId: string) => components.get(componentId) });
}
