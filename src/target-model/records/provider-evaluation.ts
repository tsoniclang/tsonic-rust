import type { Node } from "@tsonic/tsts";
import type { RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence } from "./physical-emission-contexts.js";

export interface RustProviderEvaluationRecords {
  readonly providerSourceOccurrence: {
    readonly get: (node: Node, operation: RustEmissionProviderOperation) => RustPhysicalEmissionSourceOccurrence | undefined;
  };
}
