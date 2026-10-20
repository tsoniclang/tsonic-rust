import type { Node } from "@tsonic/tsts";
import type { RustSourceCallableSpecializationIssue } from "./callable-issues.js";
import type { RustNativeFutureEnvironmentSelection } from "./native-future-inputs.js";
import type { TargetTypeRef } from "../types/model.js";
import type { RustPhysicalCallableSourceSelection } from "./physical-emission-contexts.js";
import type { RustNativeCallableInput } from "./native-protocols.js";

export type RustNativeStorageSelection =
  | { readonly kind: "identity"; readonly carrier: TargetTypeRef;
      readonly sources: readonly RustPhysicalCallableSourceSelection[] }
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef; readonly inputs: readonly RustNativeCallableInput[];
      readonly sources: readonly RustPhysicalCallableSourceSelection[] }
  | { readonly kind: "unresolved"; readonly reason: string };

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
}
