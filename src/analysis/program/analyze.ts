import { appendMalformedSourceAstDiagnostic, recordClassBodyFacts, recordClassSignatureFacts, recordInterfaceFacts, recordMethodSelfModeFacts } from "../declarations/project-types.js";
import { appendRustDiagnostic, rustResolutionContext } from "./walk.js";
import { createRustModuleBindingPolicy } from "./module-bindings.js";
import { createRustSourceCallableAbiResolver } from "../../policy/ownership/source-callable-abi.js";
import { createRustSourceProfileRegistry } from "../facts/source-profile-registry.js";
import { createRustSourceTypeRegistry } from "../project-types/source-type-registry.js";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import {
  KindExportAssignment,
  KindFunctionDeclaration,
  KindVariableStatement,
} from "@tsonic/target-api/source";
import { recordEnumFacts, registerTypeAlias } from "../declarations/types-and-bindings.js";
import { recordExportAssignmentFacts, recordFunctionBodyFacts, recordStatementFacts, recordVariableStatementFacts } from "../control-flow/statements.js";
import { recordFallibilityFacts } from "../resources/fallibility.js";
import { recordFunctionSignatureFacts, recordNestedCallableTypeSignatureFacts, recordPredeclaredNativeFunctionBindingFacts, recordTopLevelCallableValueSignatureFacts } from "../callables/signatures.js";
import { recordFutureValueFacts, recordResourceManagementFacts } from "../resources/suspension.js";
import { recordRustObjectLiteralMethodAdapterFacts } from "../objects/method-adapters.js";
import { resolveRustExternalProjectBase } from "../../policy/types/external-project-types.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustRegExpSubsetViolation } from "../../policy/regexp/subset.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "./context.js";
import type { RustFactWalk } from "./walk.js";
import type { RustOperationsProviderOptions } from "../operations/provider/index.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";

export function analyzeRustProgram(context: RustAnalysisContext): void {
  const { ast } = context;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = context.source.sourceFiles;
  if (!isDenseDataArray(rawSourceFiles) || rawSourceFiles.some((sourceFile) => sourceFile === undefined)) {
    appendMalformedSourceAstDiagnostic(context, "Checked source program contains an undefined or non-data source-file slot.");
    return;
  }
  const allSourceFiles = rawSourceFiles as readonly SourceFile[];
  const providerSemantics = context.providerSemantics;
  const providerRows = providerSemantics.operations;
  const jsEnabled = context.jsEnabled;
  const sourceProfiles = createRustSourceProfileRegistry(
    allSourceFiles,
    ast,
    jsEnabled,
  );
  const sourceTypes = createRustSourceTypeRegistry();
  const sourceCallableAbi = createRustSourceCallableAbiResolver();
  const projectSourceFiles = [...context.sourceFiles]
    .sort((left, right) => ast.getFileName(left).localeCompare(ast.getFileName(right)));
  const moduleBindings = createRustModuleBindingPolicy(context);
  for (const sourceFile of projectSourceFiles) {
    const statements = ast.statements(sourceFile);
    if (!isDenseDataArray(statements) || statements.some((statement) => statement === undefined)) {
      appendMalformedSourceAstDiagnostic(context, "Project source file contains an undefined or non-data top-level statement slot.");
      return;
    }
  }
  let finalizedProjectTypes: RustProjectTypePolicy | undefined;
  const operationOptions: RustOperationsProviderOptions = {
    providerExports: providerSemantics.exports,
    providerRows,
    providerTypes: providerSemantics.types,
    providerCarrierPaths: providerSemantics.carrierPaths,
    jsEnabled,
    regExpSubsetViolation: rustRegExpSubsetViolation,
    sourceProfiles,
    sourceTypes,
    resolveProjectUnionCarrier(memberCarriers) {
      return finalizedProjectTypes?.commonSupertype(memberCarriers);
    },
    sourceCallableAbi,
    projectTypes: context.projectTypes,
    projectMethodProperties: context.projectMethodProperties,
  };
  const walk: RustFactWalk = {
    context,
    providerRows,
    resolving: new Set(),
    jsEnabled,
    sourceProfiles,
    sourceTypes,
    providerCarrierPaths: providerSemantics.carrierPaths,
    sourceCallableAbi,
    operationOptions,
    operationAttempts: new WeakSet<object>(),
    postCheckOperations: new WeakMap<object, "binary" | "unary-minus" | "unary-plus">(),
    capturedBindingStorage: new Map<Node, "value" | "location">(),
    objectLiteralMethodExpressions: [],
    objectLiteralMethodSpreadExpressions: [],
    moduleBindings,
    deferredCallbackCalls: new WeakMap(),
    preparedCallbackCalls: new Map(),
  };
  // Pass 0: register every project type declaration so contextual record
  // binding works regardless of file order.
  for (const sourceFile of projectSourceFiles) {
    sourceTypes.registerSourceFile(sourceFile, ast);
  }
  const projectTypes = context.projectTypes.initialize({
    ast,
    names: context.names,
    navigation: context.source.navigation,
    sourceFiles: projectSourceFiles,
    resolveSelectedType(authoredTypeNode, selectedType, heritage) {
      return resolveRustTargetTypeRef(
        authoredTypeNode ?? selectedType,
        rustResolutionContext(walk, heritage),
        operationOptions,
      );
    },
    resolveExternalHeritage(edge) {
      return resolveRustExternalProjectBase(edge, ast, sourceProfiles);
    },
  });
  finalizedProjectTypes = projectTypes;
  for (const issue of projectTypes.issues) {
    appendRustDiagnostic(
      walk,
      issue.code,
      issue.message,
      issue.node,
      ["target.capability=rust.project-types.heritage"],
    );
  }
  if (projectTypes.issues.length > 0) {
    return;
  }
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === "KindInterfaceDeclaration") {
        recordInterfaceFacts(walk, statement);
      } else if (kind === "KindTypeAliasDeclaration") {
        registerTypeAlias(walk, statement);
      }
    }
  }
  // Pass 1: finalize every callable declaration ABI before walking any body.
  // Cross-file and forward calls therefore observe the same parameter facts.
  const signatureDiagnosticCount = context.diagnostics.length;
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionSignatureFacts(walk, statement);
      } else if (kind === "KindClassDeclaration") {
        recordClassSignatureFacts(walk, statement);
      } else if (kind === "KindEnumDeclaration") {
        recordEnumFacts(walk, statement, sourceFile);
      }
    }
    recordNestedCallableTypeSignatureFacts(walk, sourceFile);
    recordTopLevelCallableValueSignatureFacts(walk, sourceFile);
  }
  if (context.diagnostics.length !== signatureDiagnosticCount) {
    return;
  }
  for (const sourceFile of projectSourceFiles) {
    recordPredeclaredNativeFunctionBindingFacts(walk, sourceFile);
  }
  // Pass 1b: close method receiver modes from checked source identity before
  // any call ABI is recorded. Direct writes and finalized mutating provider
  // receivers seed a source-method call graph; mutability then propagates to
  // callers to a fixpoint.
  recordMethodSelfModeFacts(walk, projectSourceFiles);
  // Pass 2: finalize bodies and expressions against the closed declaration
  // ABI from pass 1.
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionBodyFacts(walk, statement, sourceFile);
      } else if (kind === KindVariableStatement) {
        recordVariableStatementFacts(walk, statement, sourceFile);
      } else if (kind === "KindClassDeclaration") {
        recordClassBodyFacts(walk, statement, sourceFile);
      } else if (kind === KindExportAssignment) {
        recordExportAssignmentFacts(walk, statement);
      } else if (kind !== "KindImportDeclaration" &&
        kind !== "KindExportDeclaration" &&
        kind !== "KindInterfaceDeclaration" &&
        kind !== "KindTypeAliasDeclaration" &&
        kind !== "KindEnumDeclaration" &&
        kind !== "KindEndOfFile") {
        recordStatementFacts(walk, statement, sourceFile, undefined);
      }
    }
  }
  const callableSpecializations = context.sourceCallableSpecializations.initialize({
    ast,
    names: context.names,
    projectTypes,
  });
  for (const issue of callableSpecializations.issues) {
    appendRustDiagnostic(
      walk,
      "RUST_SOURCE_CALLABLE_SPECIALIZATION_NOT_CLOSED",
      issue.message,
      issue.subject,
      ["target.capability=rust.source-callable.finite-specialization"],
    );
  }
  for (const request of callableSpecializations.projectMethodRequests) {
    const registration = context.projectMethodDispatch.record(
      request.declaration,
      request.targetTypeArguments,
      ast,
      projectTypes,
    );
    if (registration.kind === "rejected") {
      appendRustDiagnostic(
        walk,
        "RUST_PROJECT_METHOD_SPECIALIZATION_UNAVAILABLE",
        registration.reason,
        request.declaration,
        ["target.capability=rust.project-dispatch.finite-generic-specialization"],
      );
    }
  }
  context.projectMethodDispatch.initialize({
    ast,
    names: context.names,
    projectTypes,
  });
  context.projectMethodProperties.initialize({
    ast,
    navigation: context.source.navigation,
    projectTypes,
  });
  for (const issue of recordRustObjectLiteralMethodAdapterFacts({
    ast: walk.context.ast,
    facts: walk.context.facts,
    projectTypes: walk.context.projectTypes,
    projectMethodDispatch: walk.context.projectMethodDispatch,
    expressions: walk.objectLiteralMethodExpressions,
  })) {
    appendRustDiagnostic(
      walk,
      "RUST_OBJECT_LITERAL_METHOD_ADAPTER_NOT_PROVEN",
      issue.message,
      issue.subject,
      ["target.capability=rust.object-literal-method.exact-adapter"],
    );
  }
  context.structuralShapes.initialize(
    sourceTypes.structuralObjects(),
    sourceTypes.structuralFieldImplementations(),
  );
  context.projectFieldDispatch.initialize({
    ast,
    projectTypes,
    semanticsFor: context.semanticsFor,
  });
  // Fallibility depends on finalized operation facts and the one whole-program
  // structural storage plan produced while walking bodies.
  recordFallibilityFacts(walk, projectSourceFiles);
  recordResourceManagementFacts(walk, projectSourceFiles);
  recordFutureValueFacts(walk, projectSourceFiles);
}
