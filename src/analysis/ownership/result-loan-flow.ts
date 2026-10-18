import type { Node } from "@tsonic/tsts";
import { solveSourceFlow, type SourceControlFlowGraph, type SourceFlowLimits,
  type SourceFlowWork, type SourceStorageQueries, type SourceStorageSubject,
  type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { sourceBindingScope, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustNativeResultRetentionRequest } from "../../providers/native/projection/model.js";
import type { RustCompilerNativeRetentionFact } from "../../providers/native/model/model.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionContext } from "../../target-model/records/physical-emission-contexts.js";
import type { RustPhysicalEmissionSourceOrigin } from "../../target-model/records/physical-emission-contexts.js";
import type { RustNativeInputOwnership, RustNativeInputPlace, RustNativeResultLoanIndex,
  RustNativeResultOwnership, RustOwnershipRecords, RustPreparedNativeResultOwnership } from "../../target-model/records/ownership.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustOwnershipFlow } from "./flow.js";
import { rustNativeStoragePathsDisjoint, rustNativeStorageRoot, rustNativeStorageProjections,
  type RustNativeStoragePathInput } from "../storage/native-paths.js";

type Retention = RustNativeResultOwnership["retention"][number];
interface Loan {
  readonly row: RustNativeResultOwnership;
  readonly retention: Retention;
  readonly origin: Extract<RustNativeResultOwnership["source"], { readonly kind: "resolved" }>["alternatives"][number];
  readonly root: RustNativeInputPlace;
}
type Values = ReadonlyMap<Loan, boolean>;
type State = ReadonlyMap<SourceStorageSubject, Values>;

export function analyzeRustCarriedLoanAdmission(input: {
  readonly source: TargetSourceProgram;
  readonly storage: SourceStorageQueries;
  readonly flow: RustOwnershipFlow;
  readonly contexts: RustCallableEmissionContexts;
  readonly nativeInputs: ReadonlyMap<TargetUseSiteRef, RustNativeInputOwnership>;
  readonly nativeResults: RustNativeResultLoanIndex<RustPreparedNativeResultOwnership>;
  readonly ownership: Pick<RustOwnershipRecords, "reads" | "captures">;
  readonly records: RustProgramRecords;
  readonly query: (requests: readonly RustNativeResultRetentionRequest[]) => readonly RustCompilerNativeRetentionFact[];
  readonly limits?: Partial<SourceFlowLimits>;
}): { readonly kind: "resolved"; readonly nativeResults: RustNativeResultLoanIndex }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (node: Node, message: string, code = "RUST_NATIVE_RESULT_LOAN_NOT_PROVEN"): void => {
    diagnostics.push({ code, message, sourceNode: node, category: "error", source: "tsonic-rust",
      evidence: ["target.capability=rust.native-provider.result-carried-loans"] });
  };
  const requests: RustNativeResultRetentionRequest[] = [];
  const requested = new Map<RustPreparedNativeResultOwnership, readonly {
    readonly request: RustNativeResultRetentionRequest; readonly loan: Retention["loan"]; readonly origin: Retention["origin"];
  }[]>();
  for (const operations of input.nativeResults.values()) for (const contexts of operations.values()) for (const row of contexts.values()) {
    if (row.place.kind === "unavailable") {
      if ((row.operation.abi.result.resultLoans?.loans.length ?? 0) > 0 || row.operation.abi.result.kind === "async" &&
        ((row.operation.abi.result.resultLoans?.inputLoans.length ?? 0) > 0 ||
          row.operation.abi.result.resultLoans?.contract.inputLoans.kind === "unavailable")) reject(row.node, row.place.reasons.join(" "));
      requested.set(row, []);
      continue;
    }
    if (row.place.loans.length > 0 && row.source.kind === "unavailable") reject(row.node, row.source.reasons.join(" "));
    const rows: NonNullable<ReturnType<typeof requested.get>>[number][] = [];
    for (const loan of row.place.loans) for (const origin of loan.origins) {
      const request: RustNativeResultRetentionRequest = Object.freeze({ id: `native-result-retention:${requests.length}`,
        declarationIdentity: row.place.native.contract.declarationIdentity,
        resultTypeIdentity: row.place.native.contract.valueTypeIdentity, origin: origin.declaration,
        phase: loan.kind === "pending" ? "pending" : row.operation.abi.result.kind === "async" ? "completion" : "value",
        application: row.context.bindings, arguments: row.operation.abi.targetGenericArguments });
      requests.push(request);
      rows.push(Object.freeze({ request, loan, origin }));
    }
    requested.set(row, rows);
  }
  if (diagnostics.length > 0) return { kind: "rejected", diagnostics };
  const facts = requests.length === 0 ? [] : input.query(Object.freeze(requests));
  const factsById = new Map(facts.map(fact => [fact.questionId, fact]));
  if (factsById.size !== requests.length || facts.length !== requests.length || requests.some(request => !factsById.has(request.id)))
    throw new Error("Native carried-loan admission requires exactly one original compiler fact per requested application.");
  const completed = new Map<Node, Map<RustNativeResultOwnership["operation"], Map<TargetUseSiteRef, RustNativeResultOwnership>>>();
  const rows: RustNativeResultOwnership[] = [];
  for (const [node, operations] of input.nativeResults) {
    const selectedOperations = new Map<RustNativeResultOwnership["operation"], Map<TargetUseSiteRef, RustNativeResultOwnership>>();
    for (const [operation, contexts] of operations) {
      const selectedContexts = new Map<TargetUseSiteRef, RustNativeResultOwnership>();
      for (const [use, row] of contexts) {
        const retention: Retention[] = [];
        for (const selection of requested.get(row)!) {
          const fact = factsById.get(selection.request.id)!;
          if (fact.kind === "unavailable") reject(row.node, fact.reasons.join(" "));
          else retention.push(Object.freeze({ loan: selection.loan, origin: selection.origin,
            questionId: fact.questionId, applicationIdentity: fact.applicationIdentity, use: fact.use, cleanup: fact.cleanup }));
        }
        const completedRow = Object.freeze({ ...row, retention: Object.freeze(retention) });
        selectedContexts.set(use, completedRow);
        rows.push(completedRow);
      }
      selectedOperations.set(operation, selectedContexts);
    }
    completed.set(node, selectedOperations);
  }
  if (diagnostics.length > 0) return { kind: "rejected", diagnostics };
  const paths: RustNativeStoragePathInput = { ast: input.source.ast, records: input.records, navigation: input.source.navigation };
  for (const context of input.contexts.contexts) {
    const selectedRows = rows.filter(row => row.context === context && row.retention.length > 0);
    if (selectedRows.length === 0) continue;
    const graphs = [...input.flow.graphs.values()].filter(graph => selectedRows.some(row => graph.sourcePoints.has(row.node)));
    if (graphs.length === 0) { reject(selectedRows[0]!.node, "The actual native result has no checked canonical flow execution."); continue; }
    const executions: Extract<RustNativeResultOwnership["source"], { readonly kind: "resolved" }>["alternatives"][number][] = [];
    for (const row of selectedRows) if (row.source.kind === "resolved") for (const alternative of row.source.alternatives) {
      if (!executions.some(execution => sameExecution(execution.origin, alternative.origin))) executions.push(alternative);
    }
    for (const graph of graphs) for (const execution of executions) analyze(graph, context, selectedRows, execution);
  }
  return diagnostics.length === 0 ? { kind: "resolved", nativeResults: completed } : { kind: "rejected", diagnostics };

  function analyze(graph: SourceControlFlowGraph, context: RustPhysicalEmissionContext,
    rows: readonly RustNativeResultOwnership[],
    execution: Extract<RustNativeResultOwnership["source"], { readonly kind: "resolved" }>["alternatives"][number]): void {
    const loans: Loan[] = [];
    for (const row of rows) {
      if (row.source.kind !== "resolved" || !graph.sourcePoints.has(row.node)) continue;
      for (const origin of row.source.alternatives) {
        if (!sameExecution(origin.origin, execution.origin)) continue;
        for (const retention of row.retention) {
          if (retention.origin.kind !== "borrow") continue;
          const root = retention.origin.input;
          if (root.kind !== "place" || root.place.sourcePath === undefined) {
            reject(row.node, "The carried native loan requires its actual admitted physical borrowed source path.");
            continue;
          }
          loans.push(Object.freeze({ row, retention, origin, root }));
        }
      }
    }
    const borrowed = [...loans];
    for (const row of rows) {
      if (row.source.kind !== "resolved" || !graph.sourcePoints.has(row.node)) continue;
      for (const origin of row.source.alternatives) {
        if (!sameExecution(origin.origin, execution.origin)) continue;
        for (const retention of row.retention) if (retention.origin.kind === "carried") {
          for (const source of borrowed) loans.push(Object.freeze({ row, retention, origin, root: source.root }));
        }
      }
    }
    if (loans.length === 0) return;
    const selectedSubjects = new Map<Node, SourceStorageSubject>();
    const needed = new Set<Node>();
    for (const point of graph.points) {
      if (point.source !== undefined && ["read", "capture", "evaluate", "write-location"].includes(point.operation.kind)) needed.add(point.source);
      if ("binding" in point.operation) needed.add(point.operation.binding);
      if ((point.operation.kind === "write" || point.operation.kind === "write-location") && point.operation.value !== undefined)
        needed.add(point.operation.value.expression);
      if (point.operation.kind === "await" && point.operation.value !== undefined) {
        needed.add(point.operation.value);
        if (point.source !== undefined) needed.add(point.source);
      }
    }
    for (const loan of loans) needed.add(loan.retention.origin.input.node);
    for (const node of needed) {
      const selected = input.storage.subjectFor(node);
      if (selected.kind === "unresolved") { reject(node, selected.reason); return; }
      selectedSubjects.set(node, selected.subject);
    }
    const locations = new Map<Node, SourceStorageSubject>();
    for (const point of graph.points) if (point.operation.kind === "write-location") {
      const location = input.storage.storageSubjectFor(point.operation.location);
      if (location.kind === "unresolved") { reject(point.operation.location, location.reason); return; }
      locations.set(point.operation.location, location.subject);
    }
    const subject = (node: Node): SourceStorageSubject => {
      const selected = selectedSubjects.get(node);
      if (selected === undefined) throw new Error("Native loan flow requires each original source subject to be prepared before solving.");
      return selected;
    };
    const subjectsByNode = new Map<Node, SourceStorageSubject[]>();
    for (const value of input.storage.subjects) {
      const existing = subjectsByNode.get(value.node) ?? [];
      existing.push(value);
      subjectsByNode.set(value.node, existing);
    }
    let unresolvedValue: string | undefined;
    const forward = solveSourceFlow<State>(graph, {
      direction: "forward",
      lattice: {
        empty: () => new Map(),
        join(left, right, work) {
          const merged = new Map(left);
          for (const [subject, values] of right) { work.step(); merged.set(subject, union(merged.get(subject) ?? new Map(), values, work)); }
          return merged;
        },
        equals(left, right, work) {
          if (left.size !== right.size) return false;
          for (const [subject, values] of left) {
            work.step();
            const other = right.get(subject);
            if (other === undefined || values.size !== other.size) return false;
            for (const [loan, owned] of values) { work.step(); if (other.get(loan) !== owned) return false; }
          }
          return true;
        },
      },
      transfer(point, incoming, work) {
        const state = new Map(incoming);
        if (point.source === undefined) return state;
        const operation = point.operation;
        if (operation.kind === "read") {
          const value = subject(point.source);
          const selected = valueFor(value, incoming, work);
          const read = input.ownership.reads.get(point.source);
          state.set(value, withOwnership(selected, read?.value.kind !== "borrow", work));
          if (read?.value.kind === "move") for (const key of subjectsByNode.get(operation.binding) ?? []) {
            if (key !== value) state.set(key, withOwnership(incoming.get(key) ?? new Map(), false, work));
          }
        } else if (operation.kind === "write" || operation.kind === "write-location") {
          const selected = operation.value === undefined ? undefined : subject(operation.value.expression);
          const destinations = operation.kind === "write-location" ? [locations.get(operation.location)!]
            : subjectsByNode.get(operation.binding) ?? [subject(operation.binding)];
          for (const destination of destinations) {
            work.step();
            if (selected === undefined) { state.set(destination, new Map()); continue; }
            if (operation.value!.projection.length === 0 && destination.projection.length === 0)
              state.set(destination, valueFor(selected, incoming, work));
            else {
              const candidates = input.storage.incomingFor(destination);
              if (candidates.kind === "unresolved") return undefined;
              const actual = valueFor(selected, incoming, work);
              const exact = candidates.subjects.filter(value => value.node === selected.node);
              let values: Values = new Map();
              for (const value of exact) values = union(values, valueFor(value, incoming, work), work);
              if (actual.size > 0 && exact.length === 0) return undefined;
              state.set(destination, values);
            }
          }
        } else if (operation.kind === "scope-exit") {
          for (const key of state.keys()) {
            work.step();
            if (sourceBindingScope(key.node, input.source.ast) === operation.owner) state.set(key, new Map());
          }
        } else if (operation.kind === "capture") {
          const captured = input.ownership.captures.get(point.source)?.find(capture => capture.declaration === operation.binding);
          if (captured === undefined) return undefined;
          const value = valueFor(subject(operation.binding), incoming, work);
          const borrowed = captured.read.kind === "borrow";
          const selected: Values = new Map([...value].map(([loan, owned]) => [loan, owned && !borrowed]));
          const target = subject(point.source);
          state.set(target, union(incoming.get(target) ?? new Map(), selected, work));
          if (captured.read.kind === "move") for (const key of subjectsByNode.get(operation.binding) ?? [])
            state.set(key, withOwnership(incoming.get(key) ?? new Map(), false, work));
        } else if (operation.kind === "evaluate") {
          const value = subject(point.source);
          state.set(value, valueFor(value, incoming, work));
        } else if (operation.kind === "await" && operation.value !== undefined) {
          const awaited = valueFor(subject(operation.value), incoming, work);
          const completed = new Map<Loan, boolean>();
          for (const original of awaited.keys()) {
            work.step();
            if (original.retention.loan.kind !== "pending") continue;
            for (const loan of loans) {
              work.step();
              if (loan.row !== original.row || loan.root !== original.root || loan.retention.loan.kind !== "value" ||
                loan.retention.origin.input !== original.retention.origin.input ||
                loan.retention.origin.declaration.lifetime !== original.retention.origin.declaration.lifetime ||
                !samePath(loan.retention.origin.declaration.inputPath, original.retention.origin.declaration.inputPath)) continue;
              completed.set(loan, true);
            }
          }
          state.set(subject(point.source), completed);
        }
        for (const loan of loans) if (loan.row.node === point.source && (operation.kind === "evaluate" || operation.kind === "write-location") &&
          !(loan.row.operation.abi.result.kind === "async" && loan.retention.loan.kind === "value")) {
          work.step();
          const value = subject(loan.row.node);
          const selected = new Map(state.get(value) ?? []);
          if (loan.retention.origin.kind === "borrow") selected.set(loan, true);
          else {
            const carried = valueFor(subject(loan.retention.origin.input.node), incoming, work);
            for (const original of carried.keys()) {
              work.step();
              if (original.root !== loan.root) continue;
              const path = loan.retention.origin.declaration.inputPath;
              const selectedPath = loan.retention.origin.input.input.mode !== "value" && path[0] === "referent"
                ? path.slice(1) : path;
              if (original.retention.loan.kind === "value" && samePath(original.retention.loan.resultPath, selectedPath)) selected.set(loan, true);
            }
          }
          state.set(value, selected);
        }
        return state;
      },
    }, input.limits);
    if (forward.kind === "unresolved") { reject(graph.declaration, forward.reason); return; }
    if (unresolvedValue !== undefined) { reject(graph.declaration, unresolvedValue); return; }
    const demands = new Map<number, Set<Loan>>();
    const addDemand = (point: number, value: Values, cleanup: boolean): void => {
      const selected = demands.get(point) ?? new Set<Loan>();
      for (const [loan, owned] of value) if (cleanup ? owned && loan.retention.cleanup === "retained" : loan.retention.use === "retained") selected.add(loan);
      demands.set(point, selected);
    };
    for (const point of graph.points) {
      if (!forward.reachable.has(point.id) || point.source === undefined) continue;
      const state = forward.before.get(point.id)!;
      if (point.operation.kind === "read" || point.operation.kind === "capture") {
        addDemand(point.id, valuesForNode(point.operation.binding, state), false);
      } else if (point.operation.kind === "write") addDemand(point.id, valuesForNode(point.operation.binding, state), true);
      else if (point.operation.kind === "write-location") addDemand(point.id,
        state.get(locations.get(point.operation.location)!) ?? new Map(), true);
      else if (point.operation.kind === "await" && point.operation.value !== undefined)
        addDemand(point.id, valuesForNode(point.operation.value, state), false);
      else if (point.operation.kind === "scope-exit") {
        for (const [value, selected] of state) if (sourceBindingScope(value.node, input.source.ast) === point.operation.owner) {
          if (input.records.bindingStorage.get(value.node) !== undefined && [...selected].some(([loan, owned]) => owned && loan.retention.cleanup === "retained")) {
            reject(value.node, "The carried-loan cleanup requires the completed promoted native storage destruction endpoint.");
          } else addDemand(point.id, selected, true);
        }
      }
      for (const operand of input.contexts.operands) {
        if (operand.context !== context || operand.origin.kind === "call-input" || operand.origin.evaluation.kind !== "provider-source") continue;
        const slot = operand.origin.evaluation.slot;
        if (slot.operationNode !== point.source || point.operation.kind !== "evaluate" && point.operation.kind !== "write-location") continue;
        addDemand(point.id, valuesForNode(slot.node, state), slot.evaluationOnly !== undefined);
      }
    }
    const backward = solveSourceFlow<ReadonlySet<Loan>>(graph, {
      direction: "backward", lattice: {
        empty: () => new Set(),
        join(left, right, work) { const selected = new Set(left); for (const loan of right) { work.step(); selected.add(loan); } return selected; },
        equals(left, right, work) { if (left.size !== right.size) return false; for (const loan of left) { work.step(); if (!right.has(loan)) return false; } return true; },
      },
      transfer(point, incoming, work) {
        const selected = new Set(incoming);
        for (const loan of loans) {
          work.step();
          const completion = loan.row.operation.abi.result.kind === "async" && loan.retention.loan.kind === "value";
          if (!completion && loan.row.node === point.source && (point.operation.kind === "evaluate" || point.operation.kind === "write-location") ||
            completion && point.operation.kind === "await" && point.source !== undefined &&
              [...(forward.after.get(point.id)?.get(subject(point.source))?.keys() ?? [])].includes(loan)) selected.delete(loan);
        }
        for (const loan of demands.get(point.id) ?? []) { work.step(); selected.add(loan); }
        return selected;
      },
    }, input.limits);
    if (backward.kind === "unresolved") { reject(graph.declaration, backward.reason); return; }
    const reported = new Set<string>();
    for (const point of graph.points) {
      if (point.source === undefined || !forward.reachable.has(point.id)) continue;
      const active = new Set<Loan>();
      for (const value of forward.before.get(point.id)!.values()) for (const loan of value.keys()) active.add(loan);
      for (const use of input.nativeInputs.values()) {
        if (use.operand.context !== context) continue;
        const origin = use.operand.origin;
        if (origin.kind !== "call-input") continue;
        const moving = use.kind === "value" && use.input.mode === "value" && use.read.value.kind === "move";
        const exclusive = use.kind === "place" && use.input.mode === "mut-ref";
        if (!moving && !exclusive || (exclusive ? origin.operationNode !== point.source ||
          point.operation.kind !== "evaluate" && point.operation.kind !== "write-location" : use.node !== point.source)) continue;
        for (const loan of active) {
          if (!backward.after.get(point.id)!.has(loan) || loan.row.node === point.source) continue;
          const original = loan.root.place.sourcePath!;
          const actual = use.kind === "place" ? use.place.sourcePath : sourcePath(use.node);
          if (actual === undefined) {
            const fresh = use.kind === "place" ? use.place.storage.kind === "owned" :
              !use.read.readsStorage && !use.read.sharedReference && use.read.formation.kind !== "borrow";
            if (!fresh) reject(use.node, "The conflicting native value use has no original physical storage path.");
            continue;
          }
          if (actual.declaration !== original.declaration || rustNativeStoragePathsDisjoint(actual.projections, original.projections)) continue;
          const key = `${point.id}:${loans.indexOf(loan)}:${moving ? "move" : "exclusive"}`;
          if (reported.has(key)) continue;
          reported.add(key);
          reject(use.node, moving ? "The native source cannot move while its returned owned value retains a live loan."
            : "The native source cannot be mutably borrowed while its returned owned value retains a live loan.",
          moving ? "RUST_NATIVE_RESULT_LOAN_MOVE_CONFLICT" : "RUST_NATIVE_RESULT_LOAN_MUTABLE_CONFLICT");
        }
      }
    }

    function valueFor(selected: SourceStorageSubject, state: State, work: SourceFlowWork,
      visited: ReadonlySet<SourceStorageSubject> = new Set()): Values {
      work.step();
      const known = state.get(selected);
      if (known !== undefined) return known;
      if (visited.has(selected)) {
        unresolvedValue = "The native carried-loan value requires an original current flow value at a cyclic source-storage boundary.";
        return new Map();
      }
      const seen = new Set(visited); seen.add(selected);
      const incoming = input.storage.incomingFor(selected);
      if (incoming.kind === "unresolved") { unresolvedValue = incoming.reason; return new Map(); }
      let values: Values = new Map();
      for (const source of incoming.subjects) values = union(values, valueFor(source, state, work, seen), work);
      return values;
    }
    function valuesForNode(node: Node, state: State): Values {
      const selected = input.storage.subjectFor(node);
      if (selected.kind === "unresolved") { reject(node, selected.reason); return new Map(); }
      return state.get(selected.subject) ?? new Map();
    }
  }

  function sourcePath(node: Node): RustNativeInputPlace["place"]["sourcePath"] {
    const root = rustNativeStorageRoot(node, paths);
    if (root === undefined) return undefined;
    const projections = rustNativeStorageProjections(node, root, paths);
    return projections === undefined ? undefined : { declaration: root, projections };
  }
}

function union(left: Values, right: Values, work: SourceFlowWork): Values {
  const selected = new Map(left);
  for (const [loan, owned] of right) { work.step(); selected.set(loan, owned || selected.get(loan) === true); }
  return selected;
}

function withOwnership(values: Values, owned: boolean, work: SourceFlowWork): Values {
  const selected = new Map<Loan, boolean>();
  for (const loan of values.keys()) { work.step(); selected.set(loan, owned); }
  return selected;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function sameExecution(left: RustPhysicalEmissionSourceOrigin, right: RustPhysicalEmissionSourceOrigin): boolean {
  if (left === right) return true;
  if (left.kind === "module") return right.kind === "module" && left.sourceFile === right.sourceFile &&
    left.initializer === right.initializer && left.module === right.module;
  if (left.kind === "construction") return right.kind === "construction" && left.root === right.root &&
    left.construction === right.construction && left.callerBindings === right.callerBindings && sameExecution(left.caller, right.caller);
  if (left.kind === "callable") return right.kind === "callable" && left.producer === right.producer &&
    left.member === right.member && left.execution.subject === right.execution.subject &&
    left.execution.bindings === right.execution.bindings && sameActivation(left.activation, right.activation);
  return right.kind === "declaration" && sameActivation(left.activation, right.activation);
}

function sameActivation(left: import("@tsonic/target-api/analysis").SourceStorageBoundActivation,
  right: import("@tsonic/target-api/analysis").SourceStorageBoundActivation): boolean {
  if (left === right) return true;
  if (left.declaration !== right.declaration || left.bindings !== right.bindings) return false;
  return left.kind === "invocation" ? right.kind === "invocation" && left.invocation === right.invocation &&
    left.callerBindings === right.callerBindings : right.kind === "declaration" &&
    (left.nativeEntry === undefined ? right.nativeEntry === undefined : right.nativeEntry !== undefined &&
      left.nativeEntry.invocation === right.nativeEntry.invocation && left.nativeEntry.argument === right.nativeEntry.argument &&
      left.nativeEntry.callerBindings === right.nativeEntry.callerBindings);
}
