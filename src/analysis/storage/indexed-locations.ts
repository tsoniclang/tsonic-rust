import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustIndexedLocationProducer } from "../program/records/storage/indexed-locations.js";
import { rustProgramErrorTargetType } from "../../target-model/types/index.js";

export function analyzeRustIndexedLocations(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustIndexedLocationProducer): void {
  for (const node of nodes) {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "source-indexed-field") continue;
    const receiver = Node_Expression(program.source.ast, node);
    if (receiver === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted indexed field requires its exact native owner expression.", node);
    const binding = program.records.sourceBinding.get(receiver);
    const read = program.ownership.reads.get(receiver);
    const module = binding === undefined ? undefined : program.records.moduleBinding.get(binding.sourceDeclaration);
    const stableReceiver = program.source.ast.is.IsIdentifier(receiver) && binding !== undefined &&
      read?.stablePlace === true && read.value.kind !== "clone" &&
      program.records.mutatedBinding.get(binding.sourceDeclaration) === undefined &&
      program.records.bindingStorage.get(binding.sourceDeclaration) === undefined &&
      module?.storage !== "module-cell" && module?.storage !== "native-callable";
    producer.publish(node, { receiver, key: ElementAccessExpression_ArgumentExpression(program.source.ast, node),
      stableReceiver, errorCarrier: rustProgramErrorTargetType() });
  }
}
