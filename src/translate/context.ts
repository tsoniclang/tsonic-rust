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
import {
  createRustTranslationArtifactGraph,
} from "./artifacts/index.js";
import type {
  RustTranslationArtifactGraph,
} from "./artifacts/index.js";
import {
  createRustProjectTypePolicyRegistry,
} from "../source/rust-target-semantics/project-type-policy.js";
import type {
  RustProjectTypePolicyRegistry,
} from "../source/rust-target-semantics/project-type-policy.js";
import type { RustProviderSemantics } from "../source/provider-packages/index.js";
import {
  collectRustProviderSemantics,
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../source/provider-packages/index.js";
import { rustBuiltInSourceTypeSemantics } from "../source/rust-target-semantics/built-in-source-types.js";
import { rustStdProviderDefinition } from "../providers/compiler/std-catalog.js";
import {
  createRustSafetyApplicationFactIndex,
} from "./safety/application-fact-index.js";
import type {
  RustSafetyApplicationFactIndex,
} from "./safety/application-fact-index.js";

export interface RustTranslationContext extends TargetCompileInput {
  readonly backend: TargetBackendContext;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustSemanticModel;
  readonly artifacts: RustTranslationArtifactGraph;
  readonly projectTypes: RustProjectTypePolicyRegistry;
  readonly providerSemantics: RustProviderSemantics;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
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
  compilerProviderSemantics?: RustProviderSemantics,
): RustTranslationContext {
  const ast = input.source.ast;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = input.source.sourceFiles;
  const sourceFiles = Object.freeze(
    isDenseDataArray(rawSourceFiles) && rawSourceFiles.every((sourceFile) => sourceFile !== undefined)
      ? rawSourceFiles.filter((sourceFile): sourceFile is SourceFile =>
          sourceFile !== undefined && !ast.isDeclarationFile(sourceFile))
      : [],
  );
  const facts = new RustSemanticModel(input.source.sourceFacts);
  const artifacts = createRustTranslationArtifactGraph(ast);
  const projectTypes = createRustProjectTypePolicyRegistry();
  const safetyApplications = createRustSafetyApplicationFactIndex({
    ast,
    sourceFiles,
    sourceFacts: input.source.sourceFacts,
    navigation: input.source.navigation,
  });
  const diagnostics: TargetDiagnostic[] = [];
  const staticProviderSemantics = mergeRustProviderSemantics(
    rustBuiltInSourceTypeSemantics(),
    collectRustProviderSemanticsFromDefinitions([rustStdProviderDefinition()]),
    collectRustProviderSemantics(backend),
  );
  const providerSemantics = compilerProviderSemantics === undefined
    ? staticProviderSemantics
    : mergeRustProviderSemantics(staticProviderSemantics, compilerProviderSemantics);
  const context: RustTranslationContext = {
    ...input,
    backend,
    ast,
    sourceFiles,
    facts,
    artifacts,
    projectTypes,
    safetyApplications,
    providerSemantics,
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
