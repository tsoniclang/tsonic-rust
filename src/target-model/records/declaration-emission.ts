import type { RustRecordFamily } from "./program.js";
import type { TargetTypeRef } from "../types/model.js";
import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableGenericHeader } from "./native-generics.js";
import type { RustGenericCallableEnvironment, RustGenericCallableImplementation } from "./generic-callables.js";
import type { RustTargetGenericArgument } from "../types/model.js";
import type { RustFrameCallableImplementation } from "./frame-callables.js";
import type { RustFrameNativeType } from "./frame-emission.js";
import type { RustStructuralShapeDefinition } from "./structural-shapes.js";
import type { RustLexicalCaptureEmission } from "./lexical-functions.js";
import type { RustNativeTaskUse } from "./native-tasks.js";
import type { RustNamedClassEnvironment } from "./class-values.js";
import type { RustProjectTypeDefinition } from "../types/project-types.js";
import type { RustCallableEntryHeaderSelections } from "./callable-entry-headers.js";

export type RustNativeCallableEntrySlot =
  | { readonly kind: "source"; readonly declaration: Node; readonly carrier: TargetTypeRef }
  | { readonly kind: "leading"; readonly parameter: RustCallableLeadingEmission["parameters"][number]; readonly carrier: TargetTypeRef }
  | { readonly kind: "lexical"; readonly capture: RustLexicalCaptureEmission; readonly carrier: TargetTypeRef }
  | { readonly kind: "task"; readonly use: Extract<RustNativeTaskUse, { readonly kind: "owner" }>; readonly carrier: TargetTypeRef }
  | { readonly kind: "structural-receiver"; readonly owner: RustStructuralShapeDefinition; readonly sourceName: string;
      readonly carrier: TargetTypeRef; readonly passing: "value" | "shared" }
  | { readonly kind: "method-receiver"; readonly owner: RustProjectTypeDefinition; readonly carrier: TargetTypeRef;
      readonly passing: "ref" | "mut-ref" }
  | { readonly kind: "class-environment"; readonly declaration: Node; readonly carrier: TargetTypeRef; readonly name: string;
      readonly genericParameterIndexes: readonly number[]; readonly environment: RustNamedClassEnvironment };

export interface RustNativeCallableEntry {
  readonly slots: readonly RustNativeCallableEntrySlot[];
}

export interface RustNativeCallableEntryFacets {
  readonly body: RustNativeCallableEntry;
  readonly object: RustNativeCallableEntry;
}

export interface RustNativeCallableEntries {
  readonly direct: RustNativeCallableEntryFacets | undefined;
  readonly module: RustNativeCallableEntryFacets | undefined;
  readonly structuralFixed: ReadonlyMap<RustStructuralShapeDefinition, ReadonlyMap<string, RustNativeCallableEntryFacets>>;
}

export interface RustNativeGenericEntry {
  readonly implementation: RustGenericCallableImplementation;
  readonly environment: RustGenericCallableEnvironment;
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly suspended: boolean;
  readonly helper: boolean;
  readonly statePassing: "value" | "rc" | "shared-reference" | undefined;
}

export interface RustNativeFrameEntry {
  readonly implementation: RustFrameCallableImplementation;
  readonly type: RustFrameNativeType;
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly suspended: boolean;
  readonly ownerPassing: "rc" | "shared-reference-to-rc";
  readonly statePassing: "value" | "rc" | "shared-reference" | undefined;
}

export interface RustClassDeclarationEmission {
  readonly environmentBindingName: string | undefined;
  readonly nonCamelCaseName: boolean;
  readonly defaultConstructor: string | undefined;
  readonly scope: string | undefined;
}

export interface RustCallableReturnEmission {
  readonly invocation: TargetTypeRef | undefined;
  readonly outward: TargetTypeRef | undefined;
  readonly generatorError: { readonly carrier: TargetTypeRef; readonly uninhabited: boolean } | undefined;
  readonly destination: { readonly kind: "identity" } | { readonly kind: "selected"; readonly carrier: TargetTypeRef };
}

export interface RustCallableLeadingEmission {
  readonly headerSelections: RustCallableEntryHeaderSelections;
  readonly nativeEntry: RustNativeCallableEntries;
  readonly genericHeader: RustNativeCallableGenericHeader | undefined;
  readonly genericEntries: ReadonlyMap<RustGenericCallableImplementation, RustNativeGenericEntry>;
  readonly frameEntries: ReadonlyMap<RustFrameCallableImplementation, RustNativeFrameEntry>;
  readonly sourceParameters: ReadonlyMap<Node, TargetTypeRef>;
  readonly parameters: readonly {
    readonly kind: "this" | "receiver";
    readonly carrier: TargetTypeRef;
    readonly reads: readonly Node[];
  }[];
}

export interface RustDeclarationEmissionRecords {
  readonly classDeclaration: RustRecordFamily<RustClassDeclarationEmission>;
  readonly callableReturn: RustRecordFamily<RustCallableReturnEmission>;
  readonly callableLeading: RustRecordFamily<RustCallableLeadingEmission>;
  readonly sourceTypeScopes: RustRecordFamily<readonly string[]>;
}
