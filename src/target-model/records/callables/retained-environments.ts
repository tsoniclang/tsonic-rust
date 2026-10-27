import type { Node } from "@tsonic/tsts";
import type { SourceLexicalEnvironment } from "@tsonic/target-api/source";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

export interface RustRetainedEnvironment {
  readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
  readonly inputs: readonly (
    | { readonly kind: "parameter"; readonly declaration: Node }
    | { readonly kind: "native-task-scope" }
  )[];
}

export type RustRetainedEnvironmentSelection =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly environment: RustRetainedEnvironment }
  | { readonly kind: "unresolved"; readonly reason: string };

export type RustRetainedLexicalSelection = SourceLexicalEnvironment | { readonly kind: "unresolved"; readonly reason: string };

export interface RustRetainedEnvironmentQueries {
  suspendedParametersFor(declaration: Node): readonly Node[] | undefined;
  lexicalFor(declaration: Node): RustRetainedLexicalSelection;
  environmentFor(declaration: Node): RustRetainedEnvironmentSelection;
  inputsFor(declaration: Node):
    | { readonly kind: "resolved"; readonly ownership: "owned" | "borrowed" }
    | { readonly kind: "unresolved"; readonly reason: string };
}
