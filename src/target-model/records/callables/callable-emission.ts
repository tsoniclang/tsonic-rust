import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustPromiseBodyDeclaration } from "./callables-and-resources.js";
import type { RustDeadCodeDisposition } from "../native/native-liveness.js";
import type { SourceCallableSourceContract } from "./source-callable-contract.js";

export interface RustSourceCallableSpecializationVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterIdentities: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly targetName: string;
  readonly nativeBodyName?: string;
}

export interface RustCallableDeclarationEmission {
  readonly name: string | undefined;
  readonly exported: boolean;
  readonly visibility: "private" | "crate" | "public";
  readonly deadCode: RustDeadCodeDisposition | undefined;
  readonly promiseObjectDeadCode: RustDeadCodeDisposition | undefined;
  readonly nativeBody: RustPromiseBodyDeclaration | undefined;
  readonly promiseObject: boolean;
  readonly requiresSpecialization: boolean;
  readonly specializations: readonly RustSourceCallableSpecializationVariant[];
  readonly canFallThrough: boolean;
  readonly contract: SourceCallableSourceContract;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly resultCarrier: TargetTypeRef;
  readonly nativeAsync: boolean;
  readonly resultWrapped: boolean;
}
