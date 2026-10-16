import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "./operations.js";

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

export interface RustStatementCompletionIndex {
  readonly admitted: (statement: Node) => boolean;
  readonly conditionFor: (statement: Node) => Node | undefined;
  readonly controlTargetsFor: (statement: Node) => readonly Node[] | undefined;
  readonly exitFor: (statement: Node) => RustControlExitCompletion | undefined;
  readonly iterationFor: (statement: Node) => RustIterationCompletion | undefined;
  readonly setterFor: (expression: Node) => RustRuntimeSetterCompletion | undefined;
  readonly assignmentFor: (expression: Node) => RustAssignmentCompletion | undefined;
  readonly projectTypeTestReadsFor: (statement: Node) => readonly Node[] | undefined;
}
