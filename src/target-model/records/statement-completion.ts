import type { Node } from "@tsonic/tsts";
import type { SourceLabeledStatementTarget } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "./operations.js";
import type { RustCountedLoopRepresentation } from "./counted-loops.js";
import type { RustThrowCompletion, RustCatchBinding } from "./exception-flow.js";
import type { RustAssignmentValueSelection } from "./operator-selection.js";

export type RustAssignmentCompletion = Extract<RustTargetOperationFact, { readonly kind: "operator-token" | "operator-call" }>;

export interface RustControlExitCompletion {
  readonly completion: "break" | "continue";
  readonly target: Node;
}

export type RustIterationBindingCompletion =
  | { readonly kind: "declaration"; readonly declaration: Node; readonly name: string; readonly mutable: boolean }
  | { readonly kind: "pattern"; readonly pattern: Node }
  | { readonly kind: "assignment"; readonly declaration: Node; readonly reference: Node; readonly name: string };

export interface RustIterationCompletion {
  readonly binding: RustIterationBindingCompletion;
  readonly resource: Node | undefined;
}

export interface RustRuntimeSetterCompletion {
  readonly receiver: Node | undefined;
  readonly sourceArguments: readonly Node[];
}

export interface RustStatementRecord<Value> {
  readonly get: (subject: Node | undefined) => Value | undefined;
}

export interface RustStatementCompletionRecords {
  readonly statementAdmission: RustStatementRecord<true>;
  readonly statementCondition: RustStatementRecord<Node>;
  readonly statementControlTargets: RustStatementRecord<readonly Node[]>;
  readonly controlExit: RustStatementRecord<RustControlExitCompletion>;
  readonly iterationCompletion: RustStatementRecord<RustIterationCompletion>;
  readonly runtimeSetter: RustStatementRecord<RustRuntimeSetterCompletion>;
  readonly assignmentCompletion: RustStatementRecord<RustAssignmentCompletion>;
  readonly projectTypeTestReads: RustStatementRecord<readonly Node[]>;
  readonly labeledStatement: RustStatementRecord<SourceLabeledStatementTarget>;
  readonly countedLoop: RustStatementRecord<RustCountedLoopRepresentation>;
  readonly throwCompletion: RustStatementRecord<RustThrowCompletion>;
  readonly catchBinding: RustStatementRecord<RustCatchBinding>;
  readonly assignmentValue: RustStatementRecord<RustAssignmentValueSelection>;
  readonly methodWriteDispatch: RustStatementRecord<boolean>;
}
