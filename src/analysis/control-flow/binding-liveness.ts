import type { AstReader, Node } from "@tsonic/tsts";
import { analyzeSourceWrites, createSourceControlFlow, solveSourceFlow, type SourceControlFlowGraph, type SourceFlowWork } from "@tsonic/target-api/analysis";
import { ForStatement_Condition, ForStatement_Incrementor, Node_Expression, Node_Initializer, sourceEnclosingCallable, sourceParameterIsProperty, type TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustOwnershipFlow } from "../../target-model/records/storage/ownership-flow.js";
import type { RustBindingLivenessProducer } from "../program/records/storage/binding-liveness.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { rustStaticComparisonSkipsOperand } from "../operations/static-comparison-operands.js";
import type { RustAdmittedConstruction, RustConstructionLayer } from "../../target-model/records/objects/construction.js";
import type { RustCallableEmissionContexts } from "../../target-model/records/native/physical-emission-contexts.js";
import { isRustNeverCarrier } from "../../target-model/types/index.js";

export function analyzeRustBindingLiveness(
  source: TargetSourceProgram, flow: RustOwnershipFlow, records: RustProgramRecords, names: RustNamePlan,
  contexts: RustCallableEmissionContexts, producer: RustBindingLivenessProducer,
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
      if (operation.kind === "read" && (point.source === undefined || rustBindingUseIsEmitted(source.ast, records, point.source, operation.binding, graph.declaration) &&
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
  const constructionWrites = new Map<Node, Map<RustConstructionLayer, boolean>>();
  const constructionIssues = collectRustConstructionWriteLiveness(source, flow, records, contexts, constructionWrites);
  if (constructionIssues.length !== 0) return constructionIssues;
  for (const [binding, value] of bindings) producer.binding(binding, value);
  for (const [reference, unobserved] of writesBySource) producer.write(reference, { kind: "lexical", unobserved });
  for (const [reference, layers] of constructionWrites) producer.write(reference, { kind: "construction", layers });
  return [];
}

function collectRustConstructionWriteLiveness(
  source: TargetSourceProgram, flow: RustOwnershipFlow, records: RustProgramRecords,
  contexts: RustCallableEmissionContexts, writesBySource: Map<Node, Map<RustConstructionLayer, boolean>>,
): readonly TargetDiagnostic[] {
  const completion = createRustCompletionLivenessQueries(source);
  const plans = new Set<RustAdmittedConstruction>();
  const layers = new Map<object, RustConstructionLayer>();
  for (const context of contexts.contexts) {
    if (context.use.role !== "constructor") continue;
    const plan = records.classConstruction.get(context.declaration);
    if (plan === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "Construction write liveness requires its complete admitted physical constructor.", context.declaration);
    plans.add(plan);
    for (const layer of plan.layers) layers.set(layer, layer);
  }
  const emittedLayers = new Set<RustConstructionLayer>();
  for (const context of contexts.contexts) {
    if (context.use.role !== "constructor-layer") continue;
    const selected = layers.get(context.use.subject);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "Construction write liveness requires the identical admitted native constructor layer.", context.declaration);
    emittedLayers.add(selected);
  }
  for (const plan of plans) {
    const fields = new Set(plan.fields.map(field => field.declaration));
    const finalPoint = plan.points.get(plan.definition.declaration);
    if (finalPoint === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "Construction write liveness requires the admitted final native materialization point.", plan.definition.declaration);
    let continuation: ReadonlySet<Node> = new Set(plan.completesNormally && (!plan.publishesReceiver || !finalPoint.published) ? fields : []);
    for (let layerIndex = plan.layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = plan.layers[layerIndex]!;
      if (!emittedLayers.has(layer)) failTargetAnalysisInvariant("tsonic-rust",
        "Construction write liveness requires every identical admitted native layer context.", layer.definition.declaration);
      const completed = new Set(continuation);
      if (layerIndex < plan.layers.length - 1) for (const selected of plan.layers.slice(0, layerIndex + 1))
        for (const field of selected.fields) {
          const physical = physicalField(plan, field.declaration);
          if (plan.localFieldDeclarations.has(physical)) completed.add(physical);
        }
      if (layer.constructor === undefined) {
        continuation = completed;
        for (let fieldIndex = layer.fields.length - 1; fieldIndex >= 0; fieldIndex -= 1) {
          const field = layer.fields[fieldIndex]!;
          if (field.externallyInitialized || field.initializer === undefined) continue;
          if (!source.ast.is.IsPropertyDeclaration(field.declaration) || Node_Initializer(source.ast, field.declaration) !== field.initializer)
            failTargetAnalysisInvariant("tsonic-rust", "An implicit native layer requires its identical checked field initializer.", field.declaration);
          const selected = createSourceControlFlow(source, field.declaration, { domain: { kind: "source" } });
          if (selected.kind === "unresolved") return flowIssues(selected.reason, selected.source ?? field.declaration);
          const analyzed = analyzeGraph(plan, layer, selected.graph, continuation);
          if (analyzed.kind === "unresolved") return flowIssues(analyzed.reason, analyzed.source ?? field.declaration);
          const before = analyzed.solution.before.get(selected.graph.entry);
          if (before === undefined) failTargetAnalysisInvariant("tsonic-rust",
            "A native initializer continuation requires its actual checked flow entry.", field.declaration);
          continuation = before;
        }
        continue;
      }
      const region = flow.regions.find(value => value.graph.declaration === layer.constructor);
      if (region === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "Construction write liveness requires the existing checked source constructor flow.", layer.constructor);
      const analyzed = analyzeGraph(plan, layer, region.graph, completed);
      if (analyzed.kind === "unresolved") return flowIssues(analyzed.reason, analyzed.source ?? layer.constructor);
      if (layer.baseCall === undefined) {
        if (layerIndex !== 0) failTargetAnalysisInvariant("tsonic-rust",
          "An explicit inherited native layer requires its admitted base invocation.", layer.constructor);
        continue;
      }
      const following = new Set<Node>();
      let completions = 0;
      for (const id of region.graph.sourcePoints.get(layer.baseCall) ?? []) {
        const point = region.graph.points[id]!;
        if (point.operation.kind !== "evaluate" || !analyzed.solution.reachable.has(id)) continue;
        const normal = new Set<Node>();
        for (const edge of point.successors) {
          if (edge.kind === "exception" || !analyzed.solution.reachable.has(edge.to)) continue;
          const before = analyzed.solution.before.get(edge.to);
          if (before === undefined) failTargetAnalysisInvariant("tsonic-rust",
            "A native base continuation requires its actual checked normal successor.", layer.baseCall);
          for (const field of before) normal.add(field);
        }
        for (const field of analyzed.afterNative(id, normal, undefined)) following.add(field);
        completions += 1;
      }
      if (completions === 0) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted native base invocation requires its identical checked completion point.", layer.baseCall);
      continuation = following;
    }
  }
  return [];

  function physicalField(plan: RustAdmittedConstruction, declaration: Node): Node {
    const physical = plan.physicalDeclarations.get(declaration);
    if (physical === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "Construction write liveness requires its identical admitted physical field.", declaration);
    return physical;
  }

  function flowIssues(reason: string, node: Node): readonly TargetDiagnostic[] {
    return [{ code: "RUST_LIVENESS_FLOW_UNRESOLVED", source: "tsonic-rust", category: "error", message: reason,
      sourceNode: node, evidence: ["target.capability=rust.analysis.liveness"] }];
  }

  function analyzeGraph(plan: RustAdmittedConstruction, layer: RustConstructionLayer,
    graph: SourceControlFlowGraph, completedFields: ReadonlySet<Node>) {
    const fields = new Set(plan.fields.map(field => field.declaration));
    const observations = new Map<number, { readonly order: number; readonly reads: ReadonlySet<Node>;
      readonly written: Node | undefined }[]>();
    const boundaries = new Map<Node, { readonly before: ReadonlySet<Node>; readonly after: ReadonlySet<Node> }>();
    const captureReads = new Map<Node, Set<Node>>();
    const initializers = layer.fields.map((field, index) => ({ field, index })).filter(({ field }) =>
      !field.externallyInitialized && field.initializer !== undefined &&
      (layer.constructor !== undefined || field.declaration === graph.declaration));
    const propertyInitializers = new Map<Node, number>();
    const parameterInitializers = new Set<Node>();
    for (const { index, field } of initializers) {
      if (field.initializer === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted native initialization requires its checked expression.", field.declaration);
      if (sourceParameterIsProperty(source.ast, field.declaration)) parameterInitializers.add(field.initializer);
      else propertyInitializers.set(field.initializer, index);
    }
    const addObservation = (point: number, order: number, reads: ReadonlySet<Node>, written: Node | undefined): void => {
      let selected = observations.get(point);
      if (selected === undefined) { selected = []; observations.set(point, selected); }
      selected.push({ order, reads, written });
    };
    const nativeOrder = (node: Node, after: boolean): number => {
      for (let owner: Node | undefined = node; owner !== undefined && owner !== graph.declaration; owner = source.ast.parent(owner)) {
        const index = propertyInitializers.get(owner);
        if (index !== undefined) return index * 3 + (owner === node ? after ? 2 : 0 : 0.5);
      }
      return Number.POSITIVE_INFINITY;
    };
    for (const preparation of plan.emission.preparations.values()) {
      if (preparation.layer !== layer) continue;
      const point = preparation.point;
      if (!rustBindingUseIsEmitted(source.ast, records, point.node, graph.declaration, graph.declaration)) continue;
      const before = new Set<Node>(point.publishBefore ? fields : []);
      if (plan.emission.exposure?.expression === point.node)
        for (const binding of plan.emission.frame?.bindings ?? []) before.add(binding.declaration);
      const after = new Set<Node>(point.publishAfter ? fields : []);
      if (!parameterInitializers.has(point.node) && (before.size !== 0 || after.size !== 0)) boundaries.set(point.node, { before, after });
      if (point.publishMissingElse) for (const id of graph.sourcePoints.get(point.node) ?? [])
        if (graph.points[id]?.operation.kind === "branch") addObservation(id, nativeOrder(point.node, true), fields, undefined);
      for (const projection of preparation.projections) {
        if (projection.expression.kind !== "capture" || projection.expression.declaration === undefined) continue;
        let callable = source.ast.parent(projection.expression.node);
        while (callable !== undefined && callable !== graph.declaration &&
          !source.ast.is.IsArrowFunction(callable) && !source.ast.is.IsFunctionExpression(callable)) callable = source.ast.parent(callable);
        if (callable === undefined || callable === graph.declaration) continue;
        let captured = captureReads.get(callable);
        if (captured === undefined) { captured = new Set(); captureReads.set(callable, captured); }
        captured.add(physicalField(plan, projection.expression.declaration));
      }
    }
    const parameters = layer.constructor === undefined ? [] : source.ast.parameters(layer.constructor)
      .filter((parameter): parameter is Node => parameter !== undefined && graph.bindings.has(parameter));
    const subtrees = new Map<Node, Set<number>>([...boundaries.keys(), ...propertyInitializers.keys(), ...parameters]
      .map(node => [node, new Set()]));
    for (const point of graph.points) {
      for (let node = point.source; node !== undefined && node !== graph.declaration; node = source.ast.parent(node))
        subtrees.get(node)?.add(point.id);
    }
    for (const [node, boundary] of boundaries) {
      const subtree = subtrees.get(node)!;
      for (const id of subtree) {
        const point = graph.points[id]!;
        if (boundary.before.size !== 0) for (const edge of point.predecessors)
          if (!subtree.has(edge.from)) addObservation(edge.from, nativeOrder(node, false), boundary.before, undefined);
        if (boundary.after.size !== 0 && point.successors.some(edge => !subtree.has(edge.to) &&
          edge.kind !== "exception" && edge.kind !== "return" &&
          edge.kind !== "break" && edge.kind !== "continue")) addObservation(id, nativeOrder(node, true), boundary.after, undefined);
      }
    }
    const exits = (node: Node): readonly number[] => {
      const subtree = subtrees.get(node);
      if (subtree === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "Construction write liveness requires its original checked initializer or parameter region.", node);
      return [...subtree].filter(id => graph.points[id]!.successors.some(edge => !subtree.has(edge.to) &&
        edge.kind !== "exception" && edge.kind !== "return" && edge.kind !== "break" && edge.kind !== "continue"));
    };
    const plainField = (declaration: Node): boolean => {
      const binding = records.frameBindingDeclaration.get(declaration);
      return binding === undefined ? records.capturedFieldStorage.get(declaration) === undefined
        : binding.storage === "value" && binding.initialization === "ready";
    };
    let preceding: readonly number[] | undefined;
    if (layer.constructor !== undefined) {
      if (layer.baseCall !== undefined) preceding = (graph.sourcePoints.get(layer.baseCall) ?? [])
        .filter(id => graph.points[id]?.operation.kind === "evaluate");
      else {
        const last = parameters[parameters.length - 1];
        preceding = last === undefined ? [graph.entry] : exits(last);
      }
    }
    for (const { index, field } of initializers) {
      if (field.initializer === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted native initialization requires its checked expression.", field.declaration);
      const parameter = parameterInitializers.has(field.initializer);
      const points = parameter ? preceding : exits(field.initializer);
      if (points === undefined || points.length === 0) failTargetAnalysisInvariant("tsonic-rust",
        "A native field initializer requires its actual checked predecessor.", field.declaration);
      const preparation = plan.emission.preparations.get(field.initializer);
      if (preparation === undefined || preparation.layer !== layer) failTargetAnalysisInvariant("tsonic-rust",
        "Construction write liveness requires its admitted field initialization preparation.", field.initializer);
      const physical = physicalField(plan, field.declaration);
      for (const id of points) {
        if (parameter) {
          const before = new Set<Node>(preparation.point.publishBefore ? fields : []);
          if (plan.emission.exposure?.expression === field.initializer)
            for (const binding of plan.emission.frame?.bindings ?? []) before.add(binding.declaration);
          addObservation(id, index * 3, before, undefined);
        }
        if (!preparation.retainsFrame && plainField(physical)) addObservation(id, index * 3 + 1, new Set(), physical);
        if (parameter) addObservation(id, index * 3 + 2,
          new Set(preparation.point.publishAfter ? fields : []), undefined);
      }
      if (!parameter) preceding = points;
    }
    for (const selected of observations.values()) selected.sort((left, right) => right.order - left.order);
    const afterNative = (point: number, input: ReadonlySet<Node>, work: SourceFlowWork | undefined): Set<Node> => {
      const live = work === undefined ? new Set(input) : copyConstructionLiveFields(input, work);
      for (const observation of observations.get(point) ?? []) {
        work?.step();
        if (observation.written !== undefined) live.delete(observation.written);
        for (const field of observation.reads) { work?.step(); live.add(field); }
      }
      return live;
    };
    const projectionFor = (expression: Node) => plan.emission.preparations.get(expression)?.projections
      .find(projection => projection.expression.node === expression);
    const plainWrites = new Map<Node, Node>();
    for (const point of graph.points) {
      if (point.operation.kind !== "write-location") continue;
      const target = point.operation.location;
      if (!rustBindingUseIsEmitted(source.ast, records, target, graph.declaration, graph.declaration) ||
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
        const live = afterNative(point.id, input, work);
        if (point.operation.kind === "write-location") {
          const field = plainWrites.get(point.operation.location);
          if (field !== undefined) live.delete(field);
        }
        if (point.source !== undefined && rustBindingUseIsEmitted(source.ast, records, point.source, graph.declaration, graph.declaration)) {
          const projection = projectionFor(point.source);
          const operation = records.targetOperation.get(point.source);
          if (projection?.expression.declaration !== undefined && operation?.kind === "source-field" && operation.accessMode !== "write" &&
            !rustStaticComparisonSkipsOperand(source.ast, records, point.source))
            live.add(physicalField(plan, projection.expression.declaration));
          for (const field of captureReads.get(point.source) ?? []) { work.step(); live.add(field); }
        }
        return live;
      },
    });
    if (solution.kind === "unresolved") return solution;
    for (const point of graph.points) {
      if (!solution.reachable.has(point.id) || point.operation.kind !== "write-location") continue;
      const target = point.operation.location;
      if (!rustBindingUseIsEmitted(source.ast, records, target, graph.declaration, graph.declaration)) continue;
      const projection = projectionFor(target);
      if (projection?.expression.kind !== "field" || projection.expression.declaration === undefined) continue;
      const field = physicalField(plan, projection.expression.declaration);
      const after = solution.after.get(point.id);
      if (after === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A construction write requires its actual completed source-flow state.", target);
      const unobserved = plainWrites.has(target) &&
        !afterNative(point.id, after, undefined).has(field) &&
        !completion.observed(target, field, graph.declaration, false) && !completion.repeated(target, field, graph.declaration);
      let selectedLayers = writesBySource.get(target);
      if (selectedLayers === undefined) { selectedLayers = new Map(); writesBySource.set(target, selectedLayers); }
      selectedLayers.set(layer, (selectedLayers.get(layer) ?? true) && unobserved);
    }
    return { kind: "resolved" as const, solution, afterNative };
  }
}

function copyConstructionLiveFields(input: ReadonlySet<Node>, work: SourceFlowWork): Set<Node> {
  const selected = new Set<Node>();
  for (const field of input) { work.step(); selected.add(field); }
  return selected;
}

export function rustBindingUseIsEmitted(ast: AstReader, records: RustProgramRecords,
  reference: Node, binding: Node, owner: Node | undefined): boolean {
  let child = reference;
  for (let current: Node | undefined = reference; current !== undefined && current !== owner;
    child = current, current = ast.parent(current)) {
    if (records.nativeUnreachable.get(current) === true || records.compileTimeSource.get(current) !== undefined ||
      records.nativeParticipation.get(current) === "erased") return false;
    if (ast.is.IsIfStatement(current) && Node_Expression(ast, current) === child &&
      records.nativeGuardResult.get(child) !== undefined) return false;
    if (ast.is.IsBinaryExpression(current) && ast.as.AsBinaryExpression(current)?.Right === child) {
      const operation = records.targetOperation.get(current);
      if (operation?.kind === "sequence" && isRustNeverCarrier(operation.leftCarrier)) return false;
    }
    if (ast.is.IsForStatement(current)) {
      const counted = records.countedLoop.get(current);
      if (counted?.counterDeclaration === binding &&
        (child === ForStatement_Condition(ast, current) || child === ForStatement_Incrementor(ast, current))) return false;
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

