import type { Node } from "@tsonic/tsts";
import type { RustSourceGenericParameterContract } from "../lifetimes/index.js";

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
}
