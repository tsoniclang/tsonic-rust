import type { RustSourceCallableSpecializationIssue } from "./callable-issues.js";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustClosureCaptureFact } from "../operations/operation-selections.js";
import type { RustTargetGenericReferences } from "../../types/carriers/generic-references.js";
import type { RustSourceGenericParameterContract, RustLifetimeRef } from "../../lifetimes/index.js";

export interface RustSuspendedCallableImplementation {
  readonly declaration: Node;
  readonly sourceFileName: string;
  readonly stateName: string;
  readonly carrier: TargetTypeRef;
  readonly captures: RustClosureCaptureFact["captures"];
  readonly receiverFields: RustClosureCaptureFact["receiverFields"];
  readonly receivers: RustClosureCaptureFact["receivers"];
  readonly storage: readonly TargetTypeRef[];
  readonly environment: RustTargetGenericReferences;
  readonly signature: RustTargetGenericReferences;
  readonly parameters: readonly RustSourceGenericParameterContract[];
  readonly elision?: { readonly parameterIndex: number; readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }> };
}

export interface RustSuspendedCallableEmission {
  readonly implementation: RustSuspendedCallableImplementation;
  readonly physicalCarrier: TargetTypeRef;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly captures: readonly TargetTypeRef[];
}

export interface RustSuspendedCallablePlan {
  readonly implementations: readonly RustSuspendedCallableImplementation[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  implementationFor(node: Node): RustSuspendedCallableImplementation | undefined;
}
