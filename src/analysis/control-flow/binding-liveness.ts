import type { Node } from "@tsonic/tsts";
import { analyzeSourceWrites, solveSourceFlow, type SourceFlowWork } from "@tsonic/target-api/analysis";
import { ForStatement_Condition, ForStatement_Incrementor, Node_Expression, sourceEnclosingCallable, type TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustOwnershipFlow } from "../../target-model/records/ownership-flow.js";
import type { RustBindingLivenessProducer } from "../program/records/binding-liveness.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { rustStaticComparisonSkipsOperand } from "../operations/static-comparison-operands.js";
import type { RustAdmittedConstruction } from "../../target-model/records/construction.js";

export function analyzeRustBindingLiveness(
  source: TargetSourceProgram, flow: RustOwnershipFlow, records: RustProgramRecords, names: RustNamePlan,
  producer: RustBindingLivenessProducer,
): readonly TargetDiagnostic[] {
  const writesBySource = new Map<Node, boolean>();
  const bindings = new Map<Node, { unused: boolean; unusedInitializer: boolean; multipleWrites: boolean }>();
  const completion = createRustCompletionLivenessQueries(source);
  const repeatedByCompletionScope = new Set<Node>();
  // The native completion scope of a try statement keeps every arm reachable for the Rust compiler: its catch block
  // may be skipped, and a try statement that awaits runs inside a native async block that captures the binding. An
  // initial value is then observable to the Rust compiler through such a write or reference even when no source path
  // reads it, so its unused-initializer expectation would be unfulfilled.
  const initializerObservedByCompletion = new Set<Node>();
  const observesInitializerThroughCompletion = (reference: Node, binding: Node, write: boolean): boolean =>
    completion.observed(reference, binding, sourceEnclosingCallable(binding, source.ast), write);
  // A read the native program never evaluates (in a decided guard condition, whose if statement emits only its
  // selected branch, or in a removed branch) does not keep the binding used.
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
      // A discarded callable is erased from the native program, so its capture never reads the binding; an unemitted
      // read and a statically decided comparison operand are not evaluated natively.
      if (operation.kind === "read" && (point.source === undefined || rustLivenessReadEmitted(source, records, point.source, operation.binding, graph.declaration) &&
          !rustStaticComparisonSkipsOperand(source.ast, records, point.source)) ||
        operation.kind === "capture" &&
        (point.source === undefined || records.nativeParticipation.get(point.source) !== "erased")) reads.add(operation.binding);
      if (operation.kind === "read" && point.source !== undefined &&
        observesInitializerThroughCompletion(point.source, operation.binding, false) ||
        operation.kind === "write" && !operation.initialization &&
          observesInitializerThroughCompletion(operation.reference, operation.binding, true))
        initializerObservedByCompletion.add(operation.binding);
      if (operation.kind !== "write") continue;
      if (completion.repeated(operation.reference, operation.binding, sourceEnclosingCallable(operation.binding, source.ast)))
        repeatedByCompletionScope.add(operation.binding);
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
          !completion.observed(operation.reference, operation.binding, graph.declaration, false));
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

export function analyzeRustConstructionWriteLiveness(
  source: TargetSourceProgram, flow: RustOwnershipFlow, records: RustProgramRecords,
  constructions: readonly RustAdmittedConstruction[], producer: RustBindingLivenessProducer,
): readonly TargetDiagnostic[] {
  const writesBySource = new Map<Node, boolean>();
  const completion = createRustCompletionLivenessQueries(source);
  for (const plan of constructions) for (const [layerIndex, layer] of plan.layers.entries()) {
    if (layer.constructor === undefined) continue;
    for (const { graph, liveness } of flow.regions) {
      if (graph.declaration !== layer.constructor) continue;
      const fields = new Set(plan.fields.map(field => field.declaration));
      const readsAfter = new Map<number, Set<Node>>();
      const boundaries = new Map<Node, { readonly before: ReadonlySet<Node>; readonly after: ReadonlySet<Node> }>();
      const captureReads = new Map<Node, Set<Node>>();
      const addReads = (index: Map<number, Set<Node>>, point: number, selected: ReadonlySet<Node>): void => {
        let reads = index.get(point);
        if (reads === undefined) { reads = new Set(); index.set(point, reads); }
        for (const field of selected) reads.add(field);
      };
      for (const preparation of plan.emission.preparations.values()) {
        if (preparation.layer !== layer) continue;
        const point = preparation.point;
        if (!rustLivenessReadEmitted(source, records, point.node, graph.declaration, graph.declaration)) continue;
        const before = new Set<Node>(point.publishBefore ? fields : []);
        if (plan.emission.exposure?.expression === point.node)
          for (const binding of plan.emission.frame?.bindings ?? []) before.add(binding.declaration);
        const after = new Set<Node>(point.publishAfter ? fields : []);
        if (before.size !== 0 || after.size !== 0) boundaries.set(point.node, { before, after });
        if (point.publishMissingElse) for (const id of graph.sourcePoints.get(point.node) ?? [])
          if (graph.points[id]?.operation.kind === "branch") addReads(readsAfter, id, fields);
        for (const projection of preparation.projections) {
          if (projection.expression.kind !== "capture" || projection.expression.declaration === undefined) continue;
          let callable = source.ast.parent(projection.expression.node);
          while (callable !== undefined && callable !== graph.declaration &&
            !source.ast.is.IsArrowFunction(callable) && !source.ast.is.IsFunctionExpression(callable)) callable = source.ast.parent(callable);
          if (callable === undefined || callable === graph.declaration) continue;
          let captured = captureReads.get(callable);
          if (captured === undefined) { captured = new Set(); captureReads.set(callable, captured); }
          captured.add(projection.expression.declaration);
        }
      }
      const subtrees = new Map<Node, Set<number>>([...boundaries.keys()].map(node => [node, new Set()]));
      for (const point of graph.points) {
        if (!liveness.reachable.has(point.id)) continue;
        for (let node = point.source; node !== undefined && node !== graph.declaration; node = source.ast.parent(node))
          subtrees.get(node)?.add(point.id);
      }
      for (const [node, boundary] of boundaries) {
        const subtree = subtrees.get(node)!;
        for (const id of subtree) {
          const point = graph.points[id]!;
          if (boundary.before.size !== 0) for (const edge of point.predecessors)
            if (!subtree.has(edge.from) && liveness.reachable.has(edge.from)) addReads(readsAfter, edge.from, boundary.before);
          if (boundary.after.size !== 0 && point.successors.some(edge => !subtree.has(edge.to) &&
            edge.kind !== "exception" && edge.kind !== "return" &&
            edge.kind !== "break" && edge.kind !== "continue")) addReads(readsAfter, id, boundary.after);
        }
      }
      const finalLayer = layerIndex === plan.layers.length - 1;
      const finalPoint = plan.points.get(plan.definition.declaration);
      if (finalPoint === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "Construction write liveness requires the admitted final native materialization point.", plan.definition.declaration);
      const completedFields = finalLayer ? new Set(plan.completesNormally && (!plan.publishesReceiver || !finalPoint.published) ? fields : [])
        : new Set(plan.layers.slice(0, layerIndex + 1)
        .flatMap(selected => selected.fields).map(field => plan.physicalDeclarations.get(field.declaration))
        .filter((field): field is Node => field !== undefined && plan.localFieldDeclarations.has(field)));
      const projectionFor = (expression: Node) => plan.emission.preparations.get(expression)?.projections
        .find(projection => projection.expression.node === expression);
      const plainWrites = new Map<Node, Node>();
      for (const point of graph.points) {
        if (!liveness.reachable.has(point.id) || point.operation.kind !== "write-location") continue;
        const target = point.operation.location;
        if (!rustLivenessReadEmitted(source, records, target, graph.declaration, graph.declaration) ||
          plan.emission.preparations.get(target)?.retainsFrame !== false) continue;
        const projection = projectionFor(target);
        if (projection?.kind !== "local" || projection.expression.kind !== "field") continue;
        if (projection.storage === "value") {
          plainWrites.set(target, projection.declaration);
          continue;
        }
        if (projection.storage !== "frame") continue;
        const binding = records.frameBindingDeclaration.get(projection.declaration);
        if (binding === undefined) failTargetAnalysisInvariant("tsonic-rust",
          "Construction write liveness requires its admitted native frame binding.", target);
        if (binding.storage === "value" && binding.initialization === "ready") plainWrites.set(target, projection.declaration);
      }
      const solution = solveSourceFlow<ReadonlySet<Node>>(graph, {
        direction: "backward",
        boundary: new Map([[graph.exit, completedFields]]),
        lattice: {
          empty: () => new Set(),
          join(left, right, work) {
            if (left === right || right.size === 0) return left;
            const joined = copyConstructionLiveFields(left, work);
            for (const field of right) { work.step(); joined.add(field); }
            return joined;
          },
          equals(left, right, work) {
            if (left === right) return true;
            if (left.size !== right.size) return false;
            for (const field of left) { work.step(); if (!right.has(field)) return false; }
            return true;
          },
        },
        transfer(point, input, work) {
          const live = copyConstructionLiveFields(input, work);
          for (const field of readsAfter.get(point.id) ?? []) { work.step(); live.add(field); }
          if (point.operation.kind === "write-location") {
            const field = plainWrites.get(point.operation.location);
            if (field !== undefined) live.delete(field);
          }
          if (point.source !== undefined && rustLivenessReadEmitted(source, records, point.source, graph.declaration, graph.declaration)) {
            const projection = projectionFor(point.source);
            const operation = records.targetOperation.get(point.source);
            if (projection?.expression.declaration !== undefined && operation?.kind === "source-field" && operation.accessMode !== "write" &&
              !rustStaticComparisonSkipsOperand(source.ast, records, point.source))
              live.add(projection.expression.declaration);
            for (const field of captureReads.get(point.source) ?? []) { work.step(); live.add(field); }
          }
          return live;
        },
      });
      if (solution.kind === "unresolved") return [{ code: "RUST_LIVENESS_FLOW_UNRESOLVED", source: "tsonic-rust",
        category: "error", message: solution.reason, sourceNode: solution.source ?? graph.declaration,
        evidence: ["target.capability=rust.analysis.liveness"] }];
      for (const point of graph.points) {
        if (!solution.reachable.has(point.id) || point.operation.kind !== "write-location") continue;
        const target = point.operation.location;
        if (!rustLivenessReadEmitted(source, records, target, graph.declaration, graph.declaration)) continue;
        const projection = projectionFor(target);
        if (projection?.expression.kind !== "field" || projection.expression.declaration === undefined) continue;
        const field = projection.expression.declaration;
        const unobserved = plainWrites.has(target) &&
          !solution.after.get(point.id)?.has(field) && !readsAfter.get(point.id)?.has(field) &&
          !completion.observed(target, field, graph.declaration, false) && !completion.repeated(target, field, graph.declaration);
        writesBySource.set(target, (writesBySource.get(target) ?? true) && unobserved);
      }
    }
  }
  for (const [reference, unobserved] of writesBySource) producer.write(reference, unobserved);
  return [];
}

function copyConstructionLiveFields(input: ReadonlySet<Node>, work: SourceFlowWork): Set<Node> {
  const selected = new Set<Node>();
  for (const field of input) { work.step(); selected.add(field); }
  return selected;
}

function rustLivenessReadEmitted(source: TargetSourceProgram, records: RustProgramRecords,
  reference: Node, binding: Node, owner: Node): boolean {
  let child = reference;
  for (let current: Node | undefined = reference; current !== undefined && current !== owner;
    child = current, current = source.ast.parent(current)) {
    if (records.nativeUnreachable.get(current) === true || records.compileTimeSource.get(current) !== undefined ||
      records.nativeParticipation.get(current) === "erased") return false;
    if (source.ast.is.IsIfStatement(current) && Node_Expression(source.ast, current) === child &&
      records.nativeGuardResult.get(child) !== undefined) return false;
    if (source.ast.is.IsForStatement(current)) {
      const counted = records.countedLoop.get(current);
      if (counted?.counterDeclaration === binding &&
        (child === ForStatement_Condition(source.ast, current) || child === ForStatement_Incrementor(source.ast, current))) return false;
    }
  }
  return true;
}

function createRustCompletionLivenessQueries(source: TargetSourceProgram) {
  const loopKinds = new Set(["KindForStatement", "KindForInStatement", "KindForOfStatement", "KindWhileStatement", "KindDoStatement"]);
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
  return {
    observed(reference: Node, binding: Node, owner: Node | undefined, catchClause: boolean): boolean {
      for (let node = source.ast.parent(reference); node !== undefined && node !== owner; node = source.ast.parent(node)) {
        if (node === binding) return false;
        const kind = source.ast.kindName(node);
        if (catchClause && kind === "KindCatchClause" || kind === "KindTryStatement" && tryAwaits(node)) return true;
      }
      return false;
    },
    repeated(reference: Node, binding: Node, owner: Node | undefined): boolean {
      let insideTry = false;
      for (let node = source.ast.parent(reference); node !== undefined && node !== owner; node = source.ast.parent(node)) {
        if (node === binding) return false;
        const kind = source.ast.kindName(node);
        if (kind === "KindTryStatement") insideTry = true;
        else if (insideTry && loopKinds.has(kind)) return true;
      }
      return false;
    },
  };
}

