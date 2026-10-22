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
  // A write inside a try region nested in a loop of the binding's own callable is dispatched through a native
  // completion scope whose loop-continue arm the Rust compiler cannot rule out, so it may observe a second write.
  const loopKinds = new Set(["KindForStatement", "KindForInStatement", "KindForOfStatement", "KindWhileStatement", "KindDoStatement"]);
  const repeatedByCompletionScope = new Set<Node>();
  const writeRepeatsThroughCompletion = (reference: Node, binding: Node): boolean => {
    const owner = sourceEnclosingCallable(binding, source.ast);
    let insideTry = false;
    for (let node = source.ast.parent(reference); node !== undefined && node !== owner; node = source.ast.parent(node)) {
      if (node === binding) return false;
      const kind = source.ast.kindName(node);
      if (kind === "KindTryStatement") insideTry = true;
      else if (insideTry && loopKinds.has(kind)) return true;
    }
    return false;
  };
  // The native completion scope of a try statement keeps every arm reachable for the Rust compiler: its catch block
  // may be skipped, and a try statement that awaits runs inside a native async block that captures the binding. An
  // initial value is then observable to the Rust compiler through such a write or reference even when no source path
  // reads it, so its unused-initializer expectation would be unfulfilled.
  const initializerObservedByCompletion = new Set<Node>();
  const awaitingTry = new Map<Node, boolean>();
  const tryAwaits = (statement: Node): boolean => {
    const known = awaitingTry.get(statement);
    if (known !== undefined) return known;
    let found = false;
    const visit = (node: Node): void => {
      if (found) return;
      if (source.ast.kindName(node) === "KindAwaitExpression") { found = true; return; }
      if (node !== statement && (source.ast.is.IsArrowFunction(node) || source.ast.is.IsFunctionExpression(node) ||
        source.ast.is.IsFunctionDeclaration(node))) return;
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(statement);
    awaitingTry.set(statement, found);
    return found;
  };
  const insideCompletionScope = (reference: Node, binding: Node, kinds: { readonly catchClause: boolean }): boolean => {
    const owner = sourceEnclosingCallable(binding, source.ast);
    for (let node = source.ast.parent(reference); node !== undefined && node !== owner; node = source.ast.parent(node)) {
      if (node === binding) return false;
      const kind = source.ast.kindName(node);
      if (kinds.catchClause && kind === "KindCatchClause") return true;
      if (kind === "KindTryStatement" && tryAwaits(node)) return true;
    }
    return false;
  };
  const observesInitializerThroughCompletion = (reference: Node, binding: Node, write: boolean): boolean =>
    insideCompletionScope(reference, binding, { catchClause: write });
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
      // A discarded callable is erased from the native program, so its capture never reads the binding.
      if (operation.kind === "read" || operation.kind === "capture" &&
        (point.source === undefined || records.nativeParticipation.get(point.source) !== "erased")) reads.add(operation.binding);
      if (operation.kind === "read" && point.source !== undefined &&
        observesInitializerThroughCompletion(point.source, operation.binding, false) ||
        operation.kind === "write" && !operation.initialization &&
          observesInitializerThroughCompletion(operation.reference, operation.binding, true))
        initializerObservedByCompletion.add(operation.binding);
      if (operation.kind !== "write") continue;
      if (writeRepeatsThroughCompletion(operation.reference, operation.binding)) repeatedByCompletionScope.add(operation.binding);
      const observed = liveness.after.get(point.id)?.has(operation.binding) === true;
      if (operation.initialization) initialWrites.set(operation.binding,
        (initialWrites.get(operation.binding) ?? true) && !observed);
      // Only a binding owned by this callable can have a write that no later read observes. A write to a module
      // binding or to a binding of an enclosing callable stays observable outside this region.
      else if (records.bindingStorage.get(operation.binding) === undefined &&
        sourceEnclosingCallable(operation.binding, source.ast) === graph.declaration) {
        // A write inside an awaiting try statement is a write through the async block's capture, which the Rust
        // compiler does not report as unused.
        writesBySource.set(operation.reference, (writesBySource.get(operation.reference) ?? true) && !observed &&
          !insideCompletionScope(operation.reference, operation.binding, { catchClause: false }));
      }
    }
    for (const binding of graph.bindings) {
      if (sourceEnclosingCallable(binding, source.ast) !== graph.declaration) continue;
      const previous = bindings.get(binding);
      // A parameter property is read by its implicit field initialization, which has no source read point.
      const stored = source.navigation.declarationUseSummary(binding).escapeKinds.includes("storage");
      bindings.set(binding, { unused: (previous?.unused ?? true) && !reads.has(binding) && !stored &&
          names.nameForDeclaration(binding)?.startsWith("_") !== true,
        unusedInitializer: (previous?.unusedInitializer ?? true) && initialWrites.get(binding) === true &&
          !initializerObservedByCompletion.has(binding) &&
          names.nameForDeclaration(binding)?.startsWith("_") !== true,
        multipleWrites: previous?.multipleWrites === true || (writes.maximum.get(binding) ?? 0) > 1 ||
          repeatedByCompletionScope.has(binding) });
    }
  }
  for (const [binding, value] of bindings) producer.binding(binding, value);
  for (const [reference, unobserved] of writesBySource) producer.write(reference, unobserved);
  return [];
}

