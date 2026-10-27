import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustProjectTypeDefinition } from "../../types/project-types.js";
import type { RustObjectRepresentation } from "./object-representation.js";
import type { RustNamedClassEnvironment } from "./class-values.js";
import type { RustFrameCallableBinding, RustFrameCallableDefinition } from "../callables/frame-callables.js";
import type { RustCapturedFieldStorage } from "../../types/field-storage.js";
import type { RustDeadCodeDisposition } from "../native/native-liveness.js";
import type { SourceCallableContract } from "../callables/source-callable-contract.js";

export interface RustNativeClassField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly initializer: Node | undefined;
  readonly visibility: "private" | "crate" | "public";
  readonly deadCode: RustDeadCodeDisposition | undefined;
  readonly frameBinding: RustFrameCallableBinding | undefined;
  readonly capturedStorage: RustCapturedFieldStorage | undefined;
}

export interface RustNativeClassEmission {
  readonly abstract: boolean;
  readonly constructorEnvironment: RustNamedClassEnvironment | undefined;
  readonly kind: "ordinary" | "polymorphic";
  readonly name: string;
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly representation: RustObjectRepresentation;
  readonly publiclyReachable: boolean;
  readonly visibility: "crate" | "public";
  readonly explicitWrapperTraits: boolean;
  readonly fields: readonly RustNativeClassField[];
  readonly constructor: Node | undefined;
  readonly constructorContracts: readonly SourceCallableContract[];
  readonly constructorDeadCode: RustDeadCodeDisposition | undefined;
  readonly constructorVisibility: "public" | "private";
  readonly methods: readonly Node[];
  readonly accessors: readonly { readonly declaration: Node; readonly role: "read" | "write"; readonly name: string }[];
  readonly environment: RustNamedClassEnvironment | undefined;
  readonly frame: RustFrameCallableDefinition | undefined;
}
