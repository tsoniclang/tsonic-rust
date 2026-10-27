import { type Node } from "@tsonic/tsts";
import { type RustSourceGenericParameterContract } from "../../lifetimes/index.js";
import { type TargetTypeRef } from "../../types/model.js";
import { type RustBindingStorageFact } from "../operations/operation-selections.js";

export interface RustLexicalFunctionCapture {
  readonly declaration: Node;
  readonly reference: Node;
  readonly mutable: boolean;
}

export type RustLexicalFunctionEnvironmentSelection =
  | { readonly kind: "resolved"; readonly captures: readonly RustLexicalFunctionCapture[];
      readonly valueObserved: boolean;
      readonly inlineValueReference?: Node;
      readonly singleInvocation: boolean; readonly captureRoots: readonly Node[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export type RustLexicalFunctionSelection =
  | (Extract<RustLexicalFunctionEnvironmentSelection, { readonly kind: "resolved" }> & {
      readonly genericParameters: readonly RustSourceGenericParameterContract[] })
  | Extract<RustLexicalFunctionEnvironmentSelection, { readonly kind: "unresolved" }>;

export interface RustLexicalFunctionEnvironments {
  forDeclaration(declaration: Node): RustLexicalFunctionEnvironmentSelection | undefined;
  valueDeclarationsAt(statement: Node): readonly Node[];
}

export interface RustLexicalFunctionEnvironmentPlan extends RustLexicalFunctionEnvironments {
  readonly declarations: readonly Node[];
  readonly subjects: readonly Node[];
  genericNodesFor(declaration: Node): readonly Node[];
  calleesFor(declaration: Node): readonly Node[];
}

export interface RustLexicalFunctionQueries extends RustLexicalFunctionEnvironments {
  forDeclaration(declaration: Node): RustLexicalFunctionSelection | undefined;
  /** The lexical functions a lexical function body invokes directly. */
  calleesFor(declaration: Node): readonly Node[];
}

export interface RustLexicalCaptureEmission {
  readonly declaration: Node;
  readonly reference: Node;
  readonly mutable: boolean;
  readonly carrier: TargetTypeRef;
  readonly physicalCarrier: TargetTypeRef;
  readonly storage: RustBindingStorageFact | undefined;
  readonly owned: boolean;
  readonly borrowedCarrier: TargetTypeRef | undefined;
  readonly parameterCarrier: TargetTypeRef;
}

export interface RustLexicalFunctionEmission {
  readonly captures: readonly RustLexicalCaptureEmission[];
  readonly genericParameters: readonly RustSourceGenericParameterContract[];
}
