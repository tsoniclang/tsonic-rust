import type {
  AstReader,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetDiagnostic,
  TargetBackendContext,
  TargetCompileInput,
} from "@tsonic/target-api";
import {
  RustSemanticModel,
} from "../policy/model.js";
import { isDenseDataArray } from "../common/closed-metadata.js";
import { analyzeRustProgram } from "../source/rust-target-semantics/index.js";

export interface RustTranslationContext extends TargetCompileInput {
  readonly backend: TargetBackendContext;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustSemanticModel;
  readonly diagnostics: TargetDiagnostic[];
  readonly analysis: {
    getEnumMemberConstant(node: Node): { readonly value: string | number } | undefined;
  };
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function createRustTranslationContext(
  backend: TargetBackendContext,
  input: TargetCompileInput,
): RustTranslationContext {
  const ast = input.source.ast;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = input.source.sourceFiles;
  const sourceFiles = Object.freeze(
    isDenseDataArray(rawSourceFiles) && rawSourceFiles.every((sourceFile) => sourceFile !== undefined)
      ? rawSourceFiles.filter((sourceFile): sourceFile is SourceFile =>
          sourceFile !== undefined && !ast.getFileName(sourceFile).endsWith(".d.ts"))
      : [],
  );
  const facts = new RustSemanticModel(input.source.sourceFacts);
  const diagnostics: TargetDiagnostic[] = [];
  const context: RustTranslationContext = {
    ...input,
    backend,
    ast,
    sourceFiles,
    facts,
    diagnostics,
    analysis: Object.freeze({
      getEnumMemberConstant(node: Node) {
        const value = input.source.semantics.forNode(node).getConstantValue(node);
        return typeof value === "number" || typeof value === "string"
          ? { value }
          : undefined;
      },
    }),
    semantics: input.source.semantics.forFile,
    semanticsFor: input.source.semantics.forNode,
  };
  analyzeRustProgram(context);
  return Object.freeze(context);
}
