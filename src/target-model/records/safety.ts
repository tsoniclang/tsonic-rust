import type { TsonicSafetyApplicationFact, TsonicSafetyBuilderFact, TsonicUnsafeContextFact } from "@tsonic/source-core/facts";
import type { TargetSafetyApplication, TargetSafetyApplicationFindings, TargetSafetyOperation } from "@tsonic/target-api/analysis";
import type { Node, SourceFile } from "@tsonic/tsts";

export interface RustSafetyApplicationFactIndex {
  readonly safetyApplication: { readonly get: (declaration: Node) => readonly RustSafetyApplication[] };
  readonly safetyOperation: { readonly get: (expression: Node) => RustSafetyOperation | undefined };
  readonly safetySubjectOperation: { readonly get: (subject: Node) => RustSafetyOperation | undefined };
  readonly isCompileTimeApplicationReference: { readonly get: (declaration: Node, reference: Node) => boolean };
  readonly findings: { readonly get: (sourceFile: SourceFile) => TargetSafetyApplicationFindings<RustSafetyApplication> };
}

export type RustSafetyApplication = TargetSafetyApplication<TsonicSafetyApplicationFact>;

export type RustSafetyOperation = TargetSafetyOperation<TsonicUnsafeContextFact, TsonicSafetyBuilderFact>;
