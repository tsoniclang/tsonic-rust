import type { Node } from "@tsonic/tsts";
import type { SourceLabeledStatementTarget } from "@tsonic/target-api/source";
import type { RustCountedLoopRepresentation } from "../../../../target-model/records/operations/counted-loops.js";
import type { RustThrowCompletion, RustCatchBinding } from "../../../../target-model/records/operations/exception-flow.js";
import type { RustAssignmentValueSelection } from "../../../../target-model/records/operations/operator-selection.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type {
  RustAssignmentCompletion, RustControlExitCompletion, RustIterationCompletion,
  RustRuntimeSetterCompletion, RustStatementCompletionRecords,
} from "../../../../target-model/records/operations/statement-completion.js";

export interface RustStatementCompletionData {
  readonly admitted: ReadonlySet<Node>;
  readonly conditions: ReadonlyMap<Node, Node>;
  readonly targets: ReadonlyMap<Node, readonly Node[]>;
  readonly exits: ReadonlyMap<Node, RustControlExitCompletion>;
  readonly iterations: ReadonlyMap<Node, RustIterationCompletion>;
  readonly setters: ReadonlyMap<Node, RustRuntimeSetterCompletion>;
  readonly assignments: ReadonlyMap<Node, RustAssignmentCompletion>;
  readonly projectReads: ReadonlyMap<Node, readonly Node[]>;
  readonly labels: ReadonlyMap<Node, SourceLabeledStatementTarget>;
  readonly countedLoops: ReadonlyMap<Node, RustCountedLoopRepresentation>;
  readonly throws: ReadonlyMap<Node, RustThrowCompletion>;
  readonly catches: ReadonlyMap<Node, RustCatchBinding>;
  readonly assignmentValues: ReadonlyMap<Node, RustAssignmentValueSelection>;
  readonly methodWrites: ReadonlyMap<Node, boolean>;
}

export interface RustStatementCompletionProducer {
  readonly records: RustStatementCompletionRecords;
  publish(data: RustStatementCompletionData): void;
}

export function createRustStatementCompletionProducer(
  assertOpen: () => void,
): RustStatementCompletionProducer {
  let data: RustStatementCompletionData | undefined;
  const records: RustStatementCompletionRecords = Object.freeze({
    statementAdmission: Object.freeze({ get: (node: Node | undefined) =>
      node !== undefined && data?.admitted.has(node) ? true as const : undefined }),
    statementCondition: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.conditions.get(node) }),
    statementControlTargets: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.targets.get(node) }),
    controlExit: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.exits.get(node) }),
    iterationCompletion: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.iterations.get(node) }),
    runtimeSetter: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.setters.get(node) }),
    assignmentCompletion: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.assignments.get(node) }),
    projectTypeTestReads: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.projectReads.get(node) }),
    labeledStatement: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.labels.get(node) }),
    countedLoop: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.countedLoops.get(node) }),
    throwCompletion: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.throws.get(node) }),
    catchBinding: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.catches.get(node) }),
    assignmentValue: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.assignmentValues.get(node) }),
    methodWriteDispatch: Object.freeze({ get: (node: Node | undefined) => node === undefined ? undefined : data?.methodWrites.get(node) }),
  });
  return Object.freeze({ records,
    publish(selected: RustStatementCompletionData): void {
      assertOpen();
      if (data !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Statement completion has one final source-admission owner.");
      data = Object.freeze(selected);
    },
  });
}
