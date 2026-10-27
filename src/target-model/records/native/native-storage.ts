import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourceCallableSpecializationIssue } from "../callables/callable-issues.js";
import type { RustNativeFutureEnvironmentSelection } from "./native-future-inputs.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustPhysicalCallableSourceSelection } from "./physical-emission-contexts.js";
import type { RustNativeCallableInput } from "./native-protocols.js";

export type RustNativeStorageSelection =
  | { readonly kind: "identity"; readonly carrier: TargetTypeRef;
      readonly sources: readonly RustPhysicalCallableSourceSelection[] }
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef; readonly inputs: readonly RustNativeCallableInput[];
      readonly sources: readonly RustPhysicalCallableSourceSelection[];
      /** The physical is a closure's type-erased runtime callable parameter, whose error is carried, never converted. */
      readonly erased?: true }
  | { readonly kind: "unresolved"; readonly reason: string; readonly diagnostic?: TargetDiagnostic };

// A callable with an uninhabited error written into storage whose distinct producers share one boxed callable: the
// written value's own physical callable and the shared storage callable, into which the write eliminates the error.
export interface RustCallableJoinWrite {
  readonly source: TargetTypeRef;
  readonly carrier: TargetTypeRef;
}

export interface RustPhysicalCallableStorage {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  parameterFor(parameter: Node): RustNativeStorageSelection;
  futureEnvironmentFor(declaration: Node): RustNativeFutureEnvironmentSelection;
  returnFor(declaration: Node): RustNativeStorageSelection;
  valueFor(node: Node): RustNativeStorageSelection;
  operandFor(node: Node): RustNativeStorageSelection;
  invocationCallableFor(node: Node): RustNativeStorageSelection;
  invocationWitnessFor(input: RustNativeCallableInput, invocation: Node): TargetTypeRef | undefined;
  invocationArgumentWitnessFor(invocation: Node, argument: Node): TargetTypeRef | undefined;
  joinWriteFor(node: Node): RustCallableJoinWrite | undefined;
}
