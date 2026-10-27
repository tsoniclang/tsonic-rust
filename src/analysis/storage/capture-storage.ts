import type { AstReader, Node } from "@tsonic/tsts";
import { sourceBindingScope, sourceBindingIterationScope } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustCaptureStorageProducer } from "../program/records/callables/capture-storage.js";

export function analyzeRustCaptureStorage(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly producer: RustCaptureStorageProducer;
}): void {
  const scopes = new Map<Node, Node[]>();
  const iterations = new Map<Node, Node[]>();
  const visit = (node: Node): void => {
    const fact = input.records.bindingStorage.get(node);
    if (fact?.initialization === "deferred") {
      const scope = sourceBindingScope(node, input.ast);
      if (scope === undefined) failTargetAnalysisInvariant("tsonic-rust", "Deferred capture storage requires an exact activation scope.", node);
      const declarations = scopes.get(scope) ?? [];
      declarations.push(node);
      scopes.set(scope, declarations);
    }
    if (fact?.iterationScope !== undefined) {
      if (fact.storage !== "location" || sourceBindingIterationScope(node, input.ast) !== fact.iterationScope ||
        sourceBindingScope(node, input.ast) !== fact.iterationScope) {
        failTargetAnalysisInvariant("tsonic-rust", "Iteration capture storage requires its exact lexical activation scope.", node);
      }
      const declarations = iterations.get(fact.iterationScope) ?? [];
      declarations.push(node);
      iterations.set(fact.iterationScope, declarations);
    }
  };
  input.nativeNodes.forEach(visit);
  const empty: readonly Node[] = Object.freeze([]);
  for (const scope of new Set([...scopes.keys(), ...iterations.keys()])) input.producer.scope(scope, {
    deferred: Object.freeze(scopes.get(scope) ?? empty), iterations: Object.freeze(iterations.get(scope) ?? empty),
  });
}
