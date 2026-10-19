import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustFieldWriteProducer } from "../program/records/field-writes.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

export function analyzeRustFieldWrites(input: {
  readonly program: Pick<RustTargetProgram, "records" | "ownership" | "projectFieldDispatch" | "projectTypes" | "objectRepresentations" | "frozenDataWrites">;
  readonly nodes: readonly Node[];
  readonly producer: RustFieldWriteProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const { program } = input;
  for (const node of input.nodes) {
    const borrowed = program.ownership.writes.get(node);
    if (borrowed !== undefined) input.producer.borrowed(node, borrowed);
    const dispatch = program.projectFieldDispatch.planFor(node);
    if (dispatch !== undefined) input.producer.dispatch(node, dispatch);
    if (program.records.methodWriteDispatch.get(node) === undefined) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "source-method-property")
      failTargetAnalysisInvariant("tsonic-rust", "An admitted method replacement requires its source property operation.", node);
    const definition = program.projectTypes.definitionForCarrier(operation.receiverCarrier);
    const representation = program.objectRepresentations.representationFor(definition);
    if (representation === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted method replacement requires its native receiver representation.", node);
    input.producer.receiver(node, { representation, check: program.frozenDataWrites.receiverForDeclaration(operation.declaration) });
    requireRustRecord(input.required, "methodWriteReceiver", node, "native method replacement", "analyzeRustFieldWrites");
  }
}
