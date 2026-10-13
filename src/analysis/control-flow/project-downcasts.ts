import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { Node } from "@tsonic/tsts";
import type { RustProjectDowncastFact } from "../../target-model/records/value-projections.js";


export function rustSelectedProjectDowncast(
  records: RustProgramRecords,
  node: Node,
): RustProjectDowncastFact | undefined {
  const selected = records.projectDowncast.get(node);
  const flow = records.flowReadProjection.get(node);
  if (flow?.kind !== "project-downcast") return selected;
  const projection = Object.freeze({
    sourceCarrier: flow.sourceCarrier,
    dispatchCarrier: flow.dispatchCarrier,
    targetCarrier: flow.selectedCarrier,
    projection: flow.projection,
  });
  return selected === undefined ? projection
    : rustTargetTypeRefEquals(selected.sourceCarrier, projection.sourceCarrier) &&
      rustTargetTypeRefEquals(selected.dispatchCarrier, projection.dispatchCarrier) &&
      rustTargetTypeRefEquals(selected.targetCarrier, projection.targetCarrier) &&
      closedMetadataEquals(selected.projection, projection.projection)
      ? selected : undefined;
}
