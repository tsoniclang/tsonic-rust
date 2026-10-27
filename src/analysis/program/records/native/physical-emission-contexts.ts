import type { Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionContext, RustPhysicalEmissionOperand,
  RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins, RustEmissionProviderOperation }
  from "../../../../target-model/records/native/physical-emission-contexts.js";

export function sealRustCallableEmissionContexts(input: {
  readonly contexts: readonly RustPhysicalEmissionContext[];
  readonly operands: readonly RustPhysicalEmissionOperand[];
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly contextIndex: ReadonlyMap<TargetUseSiteRef, RustPhysicalEmissionContext>;
  readonly operandIndex: ReadonlyMap<TargetUseSiteRef, RustPhysicalEmissionOperand>;
  readonly applications: ReadonlyMap<TargetUseSiteRef, ReadonlyMap<TargetTypeRef, TargetTypeRef>>;
  readonly sourceOrigins: ReadonlyMap<TargetUseSiteRef, ReadonlyMap<RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins>>;
  readonly sourceIndex: ReadonlyMap<Node, ReadonlyMap<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>>;
}): RustCallableEmissionContexts {
  return Object.freeze({ contexts: Object.freeze([...input.contexts]), operands: Object.freeze([...input.operands]),
    sourceOccurrences: Object.freeze([...input.sourceOccurrences]),
    contextFor: (use: TargetUseSiteRef) => input.contextIndex.get(use),
    operandFor: (use: TargetUseSiteRef) => input.operandIndex.get(use),
    carrierFor: (use: TargetUseSiteRef, source: TargetTypeRef) => input.applications.get(use)?.get(source),
    sourceOriginFor: (use: TargetUseSiteRef, occurrence: RustPhysicalEmissionSourceOccurrence) => input.sourceOrigins.get(use)?.get(occurrence),
    sourceFor: (node: Node, operation: RustEmissionProviderOperation) => input.sourceIndex.get(node)?.get(operation),
  });
}
