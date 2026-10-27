import type { Node } from "@tsonic/tsts";
import type { RustTargetGenericParameter, RustTargetParameter, TargetTypeRef } from "../../types/model.js";
import type { RustSourceGenericParameterContract } from "../../lifetimes/index.js";
import type { RustSourceParameterAbiFact } from "./callables-and-resources.js";
import type { RustSourceCallableReturnFact } from "../program/source-declarations.js";

export interface SourceCallableSourceContract {
  readonly kind: "source";
  readonly sourceDeclaration: Node;
  readonly parameters: readonly Node[];
  readonly nativeParameters: readonly RustSourceCallableParameterContract[];
  readonly returnType: TargetTypeRef;
  readonly nativeSignature: RustSourceCallableNativeSignature;
}

export interface SourceCallableNativeContract {
  readonly kind: "native";
  readonly sourceDeclaration?: Node;
  readonly nativeParameters: readonly RustSourceCallParameterContract[];
  readonly returnType: TargetTypeRef;
  readonly nativeSignature: RustNativeCallableNativeSignature;
}

export type SourceCallableContract = SourceCallableSourceContract | SourceCallableNativeContract;

export interface RustSourceCallableNativeSignature {
  readonly genericParameters: readonly RustSourceGenericParameterContract[];
  readonly sourceReturn: RustSourceCallableReturnFact | undefined;
}

export interface RustNativeCallableNativeSignature {
  readonly genericParameters: readonly RustTargetGenericParameter[];
}

export interface RustSourceCallableParameterContract {
  readonly sourceParameter: Node;
  readonly targetParameter: RustSourceParameterAbiFact;
}

export interface RustSourceCallParameterContract {
  readonly sourceParameter?: Node;
  readonly targetParameter: RustTargetParameter;
}
