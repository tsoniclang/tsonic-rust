import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustFieldWriteProducer } from "../program/records/storage/field-writes.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustFieldWrites(input: {
  readonly program: Pick<RustAnalysisProgram, "source" | "records" | "ownership" | "projectFieldDispatch" | "projectTypes" | "objectRepresentations" | "frozenDataWrites">;
  readonly nodes: readonly Node[];
  readonly producer: RustFieldWriteProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const { program } = input;
  for (const node of new Set(input.nodes)) {
    const frozen = program.frozenDataWrites.receiverForDeclaration(node);
    if (frozen !== undefined) input.producer.frozen(node, frozen);
    const borrowed = program.ownership.writes.get(node);
    if (borrowed !== undefined) input.producer.borrowed(node, borrowed);
    const dispatch = program.projectFieldDispatch.planFor(node);
    if (dispatch !== undefined) input.producer.dispatch(node, dispatch);
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-accessor" && operation.receiver.kind === "instance") {
      const receiver = Node_Expression(program.source.ast, node);
      const carrier = receiver === undefined ? undefined : rustEffectiveValueCarrier(program.records, receiver);
      if (receiver === undefined || carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted instance accessor requires its exact checked receiver and carrier.", node);
      const representation = program.objectRepresentations.representationFor(program.projectTypes.definitionForCarrier(carrier));
      input.producer.accessor(node, { receiver, value: representation?.kind === "value" });
    }
    if (program.records.methodWriteDispatch.get(node) === undefined) continue;
    if (operation?.kind !== "source-method-property")
      failTargetAnalysisInvariant("tsonic-rust", "An admitted method replacement requires its source property operation.", node);
    const definition = program.projectTypes.definitionForCarrier(operation.receiverCarrier);
    const representation = program.objectRepresentations.representationFor(definition);
    if (representation === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted method replacement requires its native receiver representation.", node);
    input.producer.receiver(node, { representation, check: program.frozenDataWrites.receiverForDeclaration(operation.declaration) });
    requireRustRecord(input.required, "methodWriteReceiver", node, "native method replacement", "analyzeRustFieldWrites");
  }
  // Field writes through a project contract resolve their dispatch by the contract field declaration, which may lie
  // outside the native nodes (an inherited interface member or a declaration-file property).
  const nodes = new Set(input.nodes);
  for (const definition of program.projectTypes.definitions) {
    const fields = [...program.projectTypes.externalBaseForDefinition(definition)?.fields ?? [],
      ...program.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []];
    for (const { declaration } of fields) {
      if (nodes.has(declaration) || program.records.projectFieldDispatch.get(declaration) !== undefined) continue;
      const dispatch = program.projectFieldDispatch.planFor(declaration);
      if (dispatch !== undefined) input.producer.dispatch(declaration, dispatch);
    }
  }
}
