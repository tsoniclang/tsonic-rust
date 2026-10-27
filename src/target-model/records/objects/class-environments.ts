import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustNamedClassEnvironment } from "./class-values.js";
import type { RustDeadCodeDisposition } from "../native/native-liveness.js";

export interface RustClassEnvironmentTypeEmission {
  readonly definition: RustProjectTypeDefinition;
  readonly environment: RustNamedClassEnvironment;
  readonly visibility: "public" | "crate";
  readonly module: boolean;
  readonly manualClone: boolean;
  readonly captures: readonly { readonly name: string; readonly carrier: TargetTypeRef; readonly copy: boolean }[];
  readonly fields: readonly { readonly field: RustNamedClassEnvironment["staticFields"][number]; readonly initializer: Node;
    readonly visibility: "private" | "crate" | "public"; readonly deadCode: RustDeadCodeDisposition | undefined }[];
}

export interface RustClassMemberEnvironmentEmission {
  readonly environment: RustNamedClassEnvironment;
  readonly source: "parameter" | "field" | "state";
  readonly borrowed: boolean;
}

export interface RustClassValueReadEmission {
  readonly environment: RustNamedClassEnvironment;
  readonly source: "new" | "existing";
  readonly clone: boolean;
  readonly target: TargetTypeRef | undefined;
}

export interface RustClassValueModuleEmission {
  readonly environment: RustNamedClassEnvironment;
  readonly visibility: "public" | "crate";
}

export interface RustClassEnvironmentRecords {
  readonly classEnvironment: { readonly get: (declaration: Node) => RustClassEnvironmentTypeEmission | undefined };
  readonly classEnvironmentType: { readonly get: (carrier: TargetTypeRef) => RustClassEnvironmentTypeEmission | undefined };
  readonly classMemberEnvironment: { readonly get: (declaration: Node) => RustClassMemberEnvironmentEmission | undefined };
  readonly classStaticEnvironment: { readonly get: (declaration: Node) => RustNamedClassEnvironment | undefined };
  readonly classCallGenericArguments: { readonly get: (declaration: Node) => number | undefined };
  readonly classValueRead: { readonly get: (node: Node) => RustClassValueReadEmission | undefined };
  readonly classValueModule: { readonly get: (declaration: Node) => RustClassValueModuleEmission | undefined };
}
