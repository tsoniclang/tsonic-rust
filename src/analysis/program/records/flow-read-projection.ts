import type { ExtensionFactSubject } from "@tsonic/tsts";
import { rustFlowReadProjectionEquals } from "../../../target-model/records/equality.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/records/value-projections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { createRustRecordFamily } from "./family.js";

export type RustFlowReadProjectionInput = {
  [Kind in RustFlowReadProjectionFact["kind"]]: Omit<Extract<RustFlowReadProjectionFact, { readonly kind: Kind }>, "sourceCarrier" | "selectedCarrier">
}[RustFlowReadProjectionFact["kind"]];

export interface RustFlowReadProjectionProducer {
  readonly records: RustRecordFamily<RustFlowReadProjectionFact>;
  project(subject: ExtensionFactSubject, source: TargetTypeRef, selected: TargetTypeRef, projection: RustFlowReadProjectionInput): void;
}

export function createRustFlowReadProjectionProducer(
  assertOpen: () => void, inherited?: RustFlowReadProjectionProducer["records"],
): RustFlowReadProjectionProducer {
  const family = createRustRecordFamily<RustFlowReadProjectionFact>({ id: "tsonic.rust.flowReadProjection", equals: rustFlowReadProjectionEquals },
    assertOpen, inherited);
  return Object.freeze({ records: family.reader,
    project(subject: ExtensionFactSubject, source: TargetTypeRef, selected: TargetTypeRef, projection: RustFlowReadProjectionInput): void {
      assertOpen();
      family.writer.set(subject, Object.freeze(projectionFact(source, selected, projection)));
    },
  });
}

function projectionFact(source: TargetTypeRef, selected: TargetTypeRef, projection: RustFlowReadProjectionInput): RustFlowReadProjectionFact {
  const common = { sourceCarrier: source, selectedCarrier: selected };
  switch (projection.kind) {
    case "union-map":
      return { kind: projection.kind, ...common, dispatchCarrier: projection.dispatchCarrier, arms: Object.freeze([...projection.arms]) };
    case "source-union":
    case "runtime-union":
      return { kind: projection.kind, ...common, dispatchCarrier: projection.dispatchCarrier, variant: projection.variant,
        ...(Object.prototype.hasOwnProperty.call(projection, "project") ? { project: projection.project } : {}) };
    case "builtin-error":
    case "option-value":
    case "option-reference":
    case "closed-native":
      return { kind: projection.kind, ...common };
    case "project-downcast":
      return { kind: projection.kind, ...common, dispatchCarrier: projection.dispatchCarrier, projection: projection.projection };
    case "program-error-variant":
      return { kind: projection.kind, ...common, variant: projection.variant };
  }
}
