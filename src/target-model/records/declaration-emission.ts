import type { RustRecordFamily } from "./program.js";
import type { TargetTypeRef } from "../types/model.js";
import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableGenericHeader } from "./native-generics.js";
import type { RustGenericCallableEnvironment, RustGenericCallableImplementation } from "./generic-callables.js";
import type { RustTargetGenericArgument } from "../types/model.js";

export interface RustNativeGenericEntry {
  readonly implementation: RustGenericCallableImplementation;
  readonly environment: RustGenericCallableEnvironment;
  readonly arguments: readonly RustTargetGenericArgument[];
  readonly suspended: boolean;
  readonly helper: boolean;
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
  readonly genericHeader: RustNativeCallableGenericHeader | undefined;
  readonly genericEntry: RustNativeGenericEntry | undefined;
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
