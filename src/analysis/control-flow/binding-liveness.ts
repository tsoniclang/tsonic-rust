import type { Node } from "@tsonic/tsts";
import { analyzeSourceWrites } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustOwnershipFlow } from "../../target-model/records/ownership-flow.js";
import type { RustBindingLivenessProducer } from "../program/records/binding-liveness.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNamePlan } from "../../target-model/names/model.js";

export function analyzeRustBindingLiveness(
  source: TargetSourceProgram, flow: RustOwnershipFlow, records: RustProgramRecords, names: RustNamePlan,
  producer: RustBindingLivenessProducer,
): readonly TargetDiagnostic[] {
  const writesBySource = new Map<Node, boolean>();
  const bindings = new Map<Node, { unused: boolean; unusedInitializer: boolean; multipleWrites: boolean }>();
  for (const { graph, liveness } of flow.regions) {
    const writes = analyzeSourceWrites(graph);
    if (writes.kind === "unresolved") return [{ code: "RUST_LIVENESS_FLOW_UNRESOLVED", source: "tsonic-rust",
      category: "error", message: writes.reason, sourceNode: writes.source ?? graph.declaration,
      evidence: ["target.capability=rust.analysis.liveness"] }];
    const reads = new Set<Node>();
    const initialWrites = new Map<Node, boolean>();
    for (const point of graph.points) {
      if (!liveness.reachable.has(point.id)) continue;
      const operation = point.operation;
      if (operation.kind === "read" || operation.kind === "capture") reads.add(operation.binding);
      if (operation.kind !== "write") continue;
      const observed = liveness.after.get(point.id)?.has(operation.binding) === true;
      if (operation.initialization) initialWrites.set(operation.binding,
        (initialWrites.get(operation.binding) ?? true) && !observed);
      else if (records.bindingStorage.get(operation.binding) === undefined) {
        writesBySource.set(operation.reference, (writesBySource.get(operation.reference) ?? true) && !observed);
      }
    }
    for (const binding of graph.bindings) {
      if (sourceEnclosingCallable(binding, source.ast) !== graph.declaration) continue;
      const previous = bindings.get(binding);
      bindings.set(binding, { unused: (previous?.unused ?? true) && !reads.has(binding) &&
          names.nameForDeclaration(binding)?.startsWith("_") !== true,
        unusedInitializer: (previous?.unusedInitializer ?? true) && initialWrites.get(binding) === true &&
          names.nameForDeclaration(binding)?.startsWith("_") !== true,
        multipleWrites: previous?.multipleWrites === true || (writes.maximum.get(binding) ?? 0) > 1 });
    }
  }
  for (const [binding, value] of bindings) producer.binding(binding, value);
  for (const [reference, unobserved] of writesBySource) producer.write(reference, unobserved);
  return [];
}

