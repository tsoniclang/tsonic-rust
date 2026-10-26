import { recordRustProgramClassEnvironments } from "../objects/class-environment-admission.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { requireRustRecord } from "./records/required-records.js";
import { appendMalformedSourceAstDiagnostic, recordClassBodyFacts, recordClassSignatureFacts, recordInterfaceFacts, recordMethodSelfModeFacts } from "../declarations/project-types.js";
import { appendRustDiagnostic, rustResolutionContext, rustOperationContext } from "./walk.js";
import { resolveRustProjectField } from "../operations/members/project-fields.js";
import { createRustModuleBindingAnalysis } from "./module-bindings.js";
import { recordRustModuleCallableStorage } from "../callables/module-values.js";
import { analyzeRustStructuralMethodExposures } from "../callables/structural-method-storage.js";
import { analyzeRustNativeHandlers } from "../operations/native-handlers.js";
import { recordRustModuleValueDeclarations } from "./module-declarations.js";

import { finalizeRustCallableParameterAbis, finalizeRustCallableSignature, resolveRustCallableSignatureCarrier } from "../callables/signature-query.js";
import { refuseRustUnresolvedParameterCarriers } from "../callables/parameter-facts.js";
import { createRustSourceCallableAbiResolver } from "../callables/source-callable-abi.js";
import { createRustSourceTypeRegistry } from "../project-types/source-type-registry.js";
import { rustProjectGenericParameters } from "../../policy/types/project/project-generic-contract.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { KindExportAssignment, KindFunctionDeclaration, KindVariableStatement } from "@tsonic/target-api/source";
import { reserveTypeAliasUnion } from "../declarations/type-aliases.js";
import { recordEnumFacts } from "../declarations/enum-facts.js";
import { recordExportAssignmentFacts, recordFunctionBodyFacts, recordStatementFacts, recordVariableStatementFacts } from "../control-flow/statements.js";
import { recordFallibilityFacts } from "../errors/fallibility.js";
import { recordNestedCallableTypeSignatureFacts, recordPredeclaredNativeFunctionBindingFacts, recordTopLevelCallableValueSignatureFacts } from "../callables/signatures.js";
import { recordFutureValueFacts } from "../callables/suspension.js";
import { recordResourceManagementFacts } from "../control-flow/resource-management.js";
import { recordRustDeferredProducerEffects } from "../errors/deferred-producer-effects.js";
import { resolveRustExternalProjectBase } from "../../policy/types/project/external-project-types.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "./context.js";
import type { RustFactWalk } from "./walk.js";
import type { RustOperationsProviderOptions } from "../operations/members/index.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

import { rustTypedLocationStorageRootReference } from "../operations/typed-locations.js";
import { selectRustAddressOfSourceOperation } from "../../source/extension/typed-locations.js";
import { rustProjectCallableTargetName } from "../names/source-member-name.js";
import { collectRustMutableProjectStorageRequirements } from "../project-types/mutable-storage-requirements.js";

import { recordRustNativeBacking } from "../operations/native-memory.js";
import { collectRustThrownClassDeclarations } from "../errors/thrown-values.js";
import { rustSourceTypeDeclarations } from "../project-types/source-declarations.js";
import { realizeRustSourceTypeFamilyDemands } from "../project-types/type-family-demands.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";
import { recordRustTypeOnlyDeclarations } from "../declarations/type-only.js";
import { recordRustValueStructDeclaration } from "../declarations/value-structs.js";
import { recordRustInterfaceRepresentationAliases } from "../declarations/interface-aliases.js";
import { collectRustImplicitInterfaceContracts } from "../project-types/implicit-interfaces.js";

import { closeRustInheritedStructuralViews } from "../objects/inherited-structural-views.js";
import { createRustSourceProfileCallableAliasQuery } from "../operations/source-profiles/callable-aliases.js";
import { collectRustDeclaredProviderErrorCarriers } from "./provider-errors.js";
import { createRustLexicalFunctionEnvironmentPlan, finalizeRustLexicalFunctionQueries } from "../callables/lexical-functions.js";
import { type RustLexicalFunctionQueries } from "../../target-model/records/lexical-functions.js";
import { recordRustLexicalValueEnvironments } from "../callables/lexical-value-environments.js";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../target-model/types/carriers/source-error.js";
import { analyzeRustReceiverStorage } from "../project-types/receiver-storage.js";
import { resolveRustCallableOwnershipCarrier } from "../callables/ownership-carriers.js";
import { createSourceStorageBudget, defaultSourceStorageLimits, type SourceNativeTaskGraph } from "@tsonic/target-api/analysis";
import { analyzeRustSourcePackageComponents } from "../source-modules/component-semantics.js";
import { type RustSourcePackageComponentClassifications } from "../../target-model/records/source-package-semantics.js";
import type { RustSourceTypeRegistry } from "../project-types/source-type-model.js";
import { completeRustNativeTaskValues, type RustNativeTaskCompletion } from "../callables/native-tasks.js";

import type { RustOperationAttempt } from "./operation-attempts.js";

interface RustSourceStageOutput {
  readonly operationAttempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">;
  readonly nativeTasks: SourceNativeTaskGraph;
  readonly nativeTaskCompletions: readonly RustNativeTaskCompletion[];
  readonly lexicalFunctions: RustLexicalFunctionQueries;
  readonly sourcePackageComponents: RustSourcePackageComponentClassifications;
  readonly sourceTypes: Pick<RustSourceTypeRegistry, "structuralObjectForCarrier">;
}

export function analyzeRustProgram(context: RustAnalysisContext, outputType: "bin" | "lib"): RustSourceStageOutput | undefined {
  if (context.sourcePackageComponentIdentities.kind === "rejected") return;
  const sourcePackageIdentities = context.sourcePackageComponentIdentities.identities;
  const { ast } = context;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = context.source.sourceFiles;
  if (!isDenseDataArray(rawSourceFiles) || rawSourceFiles.some((sourceFile) => sourceFile === undefined)) {
    appendMalformedSourceAstDiagnostic(context, "Checked source program contains an undefined or non-data source-file slot.");
    return;
  }
  const providerSemantics = context.providerSemantics;
  const providerRows = providerSemantics.operations;
  const jsEnabled = context.jsEnabled;
  const sourceProfiles = context.sourceProfiles;
  const sourceTypes = createRustSourceTypeRegistry(context.typeFamilies, context.typeDefinitions);
  const projectSourceFiles = [...context.sourceFiles]
    .sort((left, right) => ast.getFileName(left).localeCompare(ast.getFileName(right)));
  for (const sourceFile of projectSourceFiles) {
    const statements = ast.statements(sourceFile);
    if (!isDenseDataArray(statements) || statements.some((statement) => statement === undefined)) {
      appendMalformedSourceAstDiagnostic(context, "Project source file contains an undefined or non-data top-level statement slot.");
      return;
    }
  }
  const { externallyExtensibleDeclarations, closedSourceFiles, publishedDeclarations } = context.sourceBoundaries;
  for (const declaration of publishedDeclarations) context.promiseBodies.expose(declaration, declaration);
  const promotedStorageDeclarations = new Set<Node>();
  const moduleBindings = createRustModuleBindingAnalysis(context, promotedStorageDeclarations);
  const sourceCallableAbi = createRustSourceCallableAbiResolver({
    isNativeCallableExpression: moduleBindings.isNativeCallableExpression,
    parameterAbiFor: parameter => context.records.sourceParameterAbi.get(parameter),
  });
  let finalizedProjectTypes: RustProjectTypePolicy | undefined;
  const operationOptions: RustOperationsProviderOptions = {
    dispatchContextInputFor: context.dispatchContexts.resolveInput,
    providerExports: providerSemantics.exports,
    providerRows,
    providerTypes: providerSemantics.types,
    jsEnabled,
    sourceProfiles,
    sourceTypes,
    callableSignatureCarrier(declaration) {
      return walk.callableSignatureCarrierFor(walk, declaration);
    },
    callableParameterCarriers(declaration) {
      return finalizeRustCallableParameterAbis(walk, declaration)?.map(parameter => parameter.parameterCarrier);
    },
    callableStorageCarrier(source, selection, logicalCarrier, environmentFor, classFrameFor) {
      return resolveRustCallableOwnershipCarrier(walk, source, selection, logicalCarrier, environmentFor, classFrameFor);
    },
    sourceErrorCarrier(subject) {
      const demand = subject === undefined ? undefined : context.errorStorageDemands.storageFor(subject);
      if (demand?.kind === "unresolved") return undefined;
      if (demand?.kind === "writable") return rustWritableSourceErrorTargetType();
      const origins = subject === undefined ? undefined : context.sourceStorage.originsFor(subject);
      if (origins?.kind === "unresolved") return undefined;
      let requiresSourceError = false;
      if (origins?.kind === "resolved") {
        for (const origin of origins.origins) {
          const originDemand = context.errorStorageDemands.storageFor(origin.subject);
          if (originDemand.kind === "unresolved") return undefined;
          const types = context.source.semantics.forNode(origin.subject.node).types;
          if (originDemand.kind === "writable" || types.isUnknown(origin.type) || types.isAny(origin.type)) {
            requiresSourceError = true;
          }
        }
      }
      if (requiresSourceError) return rustSourceErrorTargetType();
      return subject !== undefined && context.errorStorageDemands.receivesWritableNative(subject)
          ? rustSourceErrorTargetType() : context.errorStorageDemands.retainedBoundaries.length !== 0
            ? rustSourceErrorTargetType() : context.projectTypes.sourceErrorCarrier();
    },
    resolveProjectUnionCarrier(memberCarriers) {
      return finalizedProjectTypes?.commonSupertype(memberCarriers);
    },
    sourceCallableAbi,
    receiverFieldAliases: context.objectRepresentations,
    projectTypes: context.projectTypes,
    projectCarrierSupportsObjectIdentity(carrier) {
      const definition = context.projectTypes.definitionForCarrier(carrier);
      const representation = context.objectRepresentations.representationFor(definition);
      return representation !== undefined && representation.kind !== "value";
    },
    projectFieldProjection(property, owner, ownerType, sourceStorageResolution) {
      const definition = context.projectTypes.definitionForCarrier(owner);
      const declarations = definition === undefined ? []
        : context.semanticsFor(definition.declaration).declarations.symbolDeclarations(property.symbol);
      if (declarations.length !== 1) return undefined;
      const declaration = declarations[0]!;
      const contextForField = rustOperationContext(walk, declaration);
      const selected = resolveRustProjectField(declaration, owner, ownerType,
        { ...contextForField, sourceStorageResolution: sourceStorageResolution === undefined
          ? { kind: "unresolved", reason: "Physical project-field resolution requires its original source storage binding." }
          : sourceStorageResolution }, operationOptions);
      return selected === undefined ? undefined : {
        output: selected.resultCarrier,
        field: { storage: selected.storage, storageIndex: selected.storageIndex, readonly: property.readonly,
          sharedWrite: !property.readonly && operationOptions.projectCarrierSupportsObjectIdentity(owner) },
      };
    },
    projectMethodDispatch: context.projectMethodDispatch,
    projectMethodProperties: context.projectMethodProperties,
  };
  const walk: RustFactWalk = {
    context,
    providerRows,
    providerErrorCarriers: collectRustDeclaredProviderErrorCarriers(providerRows, providerSemantics.binaryHooks),
    resolving: new Set(),
    rejectedExpressions: new WeakSet<Node>(),
    jsEnabled,
    sourceProfiles,
    sourceTypes,
    sourceCallableAbi,
    operationOptions,
    operationAttempts: new WeakMap(),
    inferredReturns: new WeakMap(),
    resolvingReturns: new Set(),
    callableSignatures: new WeakMap(),
    finalizedParameters: new WeakSet(),
    callableSignatureCarrierFor: resolveRustCallableSignatureCarrier,
    postCheckOperations: new WeakMap<object, "binary" | "unary-minus" | "unary-plus">(),
    capturedBindingStorage: new Map(),
    promotedStorageDeclarations,
    objectLiteralMethodExpressions: new Set(),
    objectLiteralMethodSpreadExpressions: new Set(),
    moduleBindings,
    deferredCallbackCalls: new WeakMap(),
    preparedCallbackCalls: new Map(),
  };
  // Pass 0: register every project type declaration so contextual record
  // binding works regardless of file order.
  for (const sourceFile of projectSourceFiles) {
    sourceTypes.registerSourceFile(sourceFile, ast, context.isNativeNode);
  }
  const enumDiagnosticCount = context.diagnostics.length;
  for (const sourceFile of projectSourceFiles) {
    for (const declaration of ast.statements(sourceFile) as readonly Node[]) {
      if (ast.kindName(declaration) === "KindEnumDeclaration") recordEnumFacts(walk, declaration);
    }
  }
  if (context.diagnostics.length !== enumDiagnosticCount) return;
  recordRustInterfaceRepresentationAliases(walk, projectSourceFiles);
  const projectTypes = context.projectTypes.initialize({
    collectImplicitInterfaces: () => collectRustImplicitInterfaceContracts(walk),
    ast,
    names: context.names,
    navigation: context.source.navigation,
    sourceFiles: projectSourceFiles,
    sourceNodes: context.nativeNodes,
    isNativeNode: context.isNativeNode,
    semanticsFor: context.semanticsFor,
    sourceLifetimes: context.sourceLifetimes,
    isRepresentationAlias(declaration) {
      return context.records.typeOnlyDeclaration.get(declaration)?.reason === "representation-alias";
    },
    normalizeCarrier: rustTypeFamilyNormalizer(context.typeFamilies),
    genericParametersFor: declaration => rustProjectGenericParameters(declaration, context),
    thrownClassDeclarations: collectRustThrownClassDeclarations(context, projectSourceFiles),
    sourceCreatedErrorOrigins: context.errorStorageDemands.nativeConstructors.filter(origin =>
      context.errorStorageDemands.storageFor(origin).kind === "writable").map(origin => origin.node),
    externallyExtensible(declaration) {
      return externallyExtensibleDeclarations.has(declaration);
    },
    targetNameForCallable(declaration) {
      return rustProjectCallableTargetName(declaration, context);
    },
    sourcePackageComponentForFile(fileName) {
      return sourcePackageIdentities.componentIdForFile(fileName);
    },
    resolveSelectedType(authoredTypeNode, selectedType, heritage) {
      return resolveRustTargetTypeRef(
        authoredTypeNode ?? selectedType,
        { ...rustResolutionContext(walk, heritage), callableRepresentation: "signature" },
        operationOptions,
      );
    },
    resolveExternalHeritage(edge) {
      return resolveRustExternalProjectBase(edge, sourceProfiles);
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
  context.promiseBodies.initializeNames(context, moduleBindings);
  const methodProperties = context.projectMethodProperties.initialize({
    ast,
    navigation: context.source.navigation,
    projectTypes,
    semanticsFor: context.semanticsFor,
    isRuntimeReference: context.runtimeValueUses.isRuntimeReference,
    budget: createSourceStorageBudget(defaultSourceStorageLimits),
  });
  if (methodProperties.kind === "unresolved") {
    appendRustDiagnostic(walk, "RUST_PROJECT_METHOD_PROPERTY_USAGE_NOT_CLOSED", methodProperties.reason, undefined,
      ["target.capability=rust.project-method-property.usage"]);
    return;
  }
  for (const carrier of walk.providerErrorCarriers) {
    if (!context.typeDefinitions.registerProgramErrorOrigin(carrier, { kind: "provider" })) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust provider Error origin conflicts with its canonical type definition.");
    }
  }
  for (const definition of projectTypes.programErrorDefinitions) {
    const variant = projectTypes.programErrorVariant(definition);
    if (variant === undefined || !context.typeDefinitions.registerProgramErrorOrigin(projectTypes.openCarrier(definition),
      { kind: "project", variant, sourceError: projectTypes.sourceErrorDefinitions.includes(definition) })) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust project Error origin conflicts with its canonical type definition.", definition.declaration);
    }
  }
  const receiverStorage = analyzeRustReceiverStorage({ ast, navigation: context.source.navigation,
    semantics: context.source.semantics, projectTypes, sourceFiles: projectSourceFiles,
    isNativeNode: context.isNativeNode,
  });
  const callableOwnership = context.callableOwnership.initialize({ storage: context.sourceStorage, nativeNodes: context.nativeNodes,
    receiverCaptures: receiverStorage.captures,
    isRuntimeUse: (use, declaration) => context.isNativeNode(use.reference) &&
      context.runtimeValueUses.isRuntimeReference(declaration, use.reference),
  });
  const ownershipFailure = callableOwnership.failureReason();
  if (ownershipFailure !== undefined) {
    appendRustDiagnostic(walk, "RUST_CALLABLE_OWNERSHIP_NOT_CLOSED", ownershipFailure, undefined,
      ["target.capability=rust.callable.activation-owner"]);
    return;
  }
  const callableAlias = createRustSourceProfileCallableAliasQuery(context, sourceProfiles);
  const collectPromotedStorage = (node: Node): void => {
    if (!context.isNativeNode(node)) return;
    if (ast.is.IsVariableDeclaration(node)) {
      const alias = callableAlias(node);
      if (alias !== undefined) {
        for (const declaration of alias.declarations) {
          requireRustRecord(context.requiredRecords, "compileTimeSource", declaration, "callable-alias", "collectPromotedStorage");
          context.records.compileTimeSources.erase(declaration);
        }
        return;
      }
    }
    if (recordRustValueStructDeclaration(walk, node)) return;
    context.pointerBacking.record(node);
    const metadata = context.memoryMetadata.declaration(node);
    if (metadata !== undefined || context.memoryMetadata.isCompileTimeExpression(node)) {
      requireRustRecord(context.requiredRecords, "compileTimeSource", node, "memory-metadata", "collectPromotedStorage");
      context.records.compileTimeSources.erase(node);
      for (const issue of metadata?.issues ?? []) appendRustDiagnostic(walk,
        "RUST_MEMORY_METADATA_RUNTIME_ESCAPE", issue.reason, issue.node, []);
      return;
    }
    const operation = selectRustAddressOfSourceOperation(
      node,
      (subject, key) => context.source.sourceFacts.getFact(subject, key),
    );
    if (operation !== undefined) {
      const root = rustTypedLocationStorageRootReference(
        operation.storageExpression,
        ast,
        context.source.navigation,
      );
      if (root !== undefined) {
        promotedStorageDeclarations.add(root.declaration);
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        collectPromotedStorage(child);
      }
    });
  };
  const promotedStorageDiagnosticCount = context.diagnostics.length;
  for (const sourceFile of projectSourceFiles) {
    collectPromotedStorage(sourceFile);
  }
  if (context.diagnostics.length !== promotedStorageDiagnosticCount) return;
  const mutableStorageDeclarations = collectRustMutableProjectStorageRequirements(
    context,
    projectTypes,
    projectSourceFiles,
    providerRows,
    node => rustStructuralObjectCarrierValue(resolveRustTargetTypeRef(node, rustResolutionContext(walk, node), operationOptions))?.representation === "value",
  );
  context.objectRepresentations.initialize({
    receiverStorage,
    ast,
    navigation: context.source.navigation,
    semantics: context.source.semantics,
    valueWrites: mutableStorageDeclarations.valueWrites,
    referenceDeclarations: mutableStorageDeclarations.referenceDeclarations,
    projectTypes,
    sourceFiles: projectSourceFiles,
    isNativeNode: context.isNativeNode,
    hasPromotedStorage(declaration) {
      return promotedStorageDeclarations.has(declaration) ||
        context.records.bindingStorage.get(declaration) !== undefined;
    },
    hasMutableStorageUse(declaration) {
      return mutableStorageDeclarations.declarations.has(declaration);
    },
  });
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      if (ast.kindName(statement) === "KindTypeAliasDeclaration") reserveTypeAliasUnion(walk, statement);
    }
  }
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === "KindInterfaceDeclaration") {
        recordInterfaceFacts(walk, statement);
      } else if (kind === "KindTypeAliasDeclaration") {
        walk.context.records.typeAliasDeclarations.register(walk, statement);
      }
    }
  }
  for (const declaration of sourceTypes.pendingSourceUnions()) {
    appendRustDiagnostic(walk, "RUST_SOURCE_UNION_NOT_CLOSED",
      "A declared runtime union has no complete, consistent set of native variant carriers.", declaration,
      ["target.capability=rust.type.source-union"]);
  }
  // Pass 0: close method receiver modes from checked source identity before
  // any call ABI is recorded, including the calls that return inference probes
  // in pass 1. Direct writes and mutating provider receivers seed a
  // source-method call graph in the object representation plan; mutability
  // then propagates to callers to a fixpoint.
  recordMethodSelfModeFacts(walk, projectSourceFiles);
  // Pass 1: finalize every callable declaration ABI before walking any body.
  // Cross-file and forward calls therefore observe the same parameter facts.
  const signatureDiagnosticCount = context.diagnostics.length;
  for (const issue of context.objectRepresentations.receiverCaptures.issues) {
    appendRustDiagnostic(walk, "RUST_RECEIVER_CAPTURE_NOT_CLOSED", issue.reason, issue.node,
      ["target.capability=rust.callable.receiver-field-owner"]);
  }
  for (const sourceFile of projectSourceFiles) {
    for (const statement of rustSourceTypeDeclarations(sourceFile, ast, context.isNativeNode)) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        const signature = finalizeRustCallableSignature(walk, statement);
        if (signature.kind === "unresolved") refuseRustUnresolvedParameterCarriers(walk, statement, signature);
      } else if (kind === "KindClassDeclaration" || kind === "KindClassExpression") {
        recordClassSignatureFacts(walk, statement);
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
    recordRustModuleValueDeclarations(walk, sourceFile);
  }
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
    for (const definition of context.projectTypes.definitions) {
      if (definition.sourceFile === sourceFile && definition.kind === "class" &&
        ast.parent(definition.declaration) !== sourceFile) {
        recordClassBodyFacts(walk, definition.declaration, sourceFile);
      }
    }
  }
  recordRustProgramClassEnvironments(walk, projectTypes);
  const nativeFields = recordRustNativeBacking(walk);
  const callableSpecializations = context.sourceCallableSpecializations.initialize({
    navigation: context.source.navigation,
    ast,
    sourceFiles: context.sourceFiles,
    records: context.records,
    closedSourceFiles,
    names: context.names,
    promiseBodyNames: context.promiseBodies,
    projectTypes,
    sourceLifetimes: context.sourceLifetimes,
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
      context.sourceLifetimes,
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
    sourceLifetimes: context.sourceLifetimes,
  });
  for (const issue of walk.context.records.objectLiteralMethodAdapters.finalize({
    ast: walk.context.ast,
    source: walk.context.source,
    requiredRecords: walk.context.requiredRecords,
    sourceLifetimes: walk.context.sourceLifetimes,
    records: walk.context.records,
    projectTypes: walk.context.projectTypes,
    typeDefinitions: walk.context.typeDefinitions,
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
  realizeRustSourceTypeFamilyDemands(walk, projectSourceFiles);
  recordRustTypeOnlyDeclarations(walk, projectSourceFiles);
  closeRustInheritedStructuralViews(walk);
  const structuralObjects = sourceTypes.structuralObjects();
  for (const shape of structuralObjects) {
    const ownerFileName = rustStructuralObjectCarrierValue(shape.carrier)?.ownerFileName;
    if (ownerFileName === undefined || sourcePackageIdentities.componentIdForFile(ownerFileName) === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_STRUCTURAL_SHAPE_SOURCE_PACKAGE_MISSING",
        "A structural source type has no exact source-package component owner.",
        shape.fields[0]!.declarations[0]!,
        ["target.capability=rust.structural-shape.source-package-ownership"],
      );
      return;
    }
  }
  const structuralMethodExposures = analyzeRustStructuralMethodExposures({ source: context.source,
    sourceStorage: context.sourceStorage, records: context.records, nativeNodes: context.nativeNodes,
    shapes: structuralObjects, componentForFile: fileName => sourcePackageIdentities.componentIdForFile(fileName)! });
  context.structuralShapes.initialize(
    structuralObjects,
    sourceTypes.structuralFieldImplementations(),
    (fileName) => sourcePackageIdentities.componentIdForFile(fileName)!,
    nativeFields,
    sourceTypes.structuralInstantiations(),
    structuralMethodExposures,
    walk.context.records.receiverIndependentMethods.finalize(walk, projectSourceFiles,
      fileName => sourcePackageIdentities.componentIdForFile(fileName)!),
  );
  context.frozenDataWrites.initialize({ jsEnabled: walk.jsEnabled, ast, projectTypes,
    representations: context.objectRepresentations, structuralShapes: context.structuralShapes,
    isNativeNode: context.isNativeNode,
    sourceFiles: projectSourceFiles, records: context.records, views: context.classValues.instanceViewRequests(),
    typeDefinitions: context.typeDefinitions });
  context.projectFieldDispatch.initialize({
    ast,
    projectTypes,
    semanticsFor: context.semanticsFor,
    frozenDataWrites: context.frozenDataWrites,
    mutableContentFields: mutableStorageDeclarations.declarations,
    receiverFieldAliases: context.objectRepresentations,
  });
  // Fallibility depends on finalized operation facts and the one whole-program
  // structural storage plan produced while walking bodies.
  walk.context.records.projectCallableAdapterPlans.finalize(walk);
  recordRustModuleCallableStorage(walk);
  const lexical = createRustLexicalFunctionEnvironmentPlan(context.source, context.nativeNodes, context.records,
    context.runtimeValueUses, context.sourceCallables);
  recordRustLexicalValueEnvironments(walk, lexical);
  analyzeRustNativeHandlers(context.nativeNodes, context.records, { get: context.safetyApplications.operationForExpression },
    context.source.sourceFacts, context.requiredRecords);
  const frameBindingCarriers = new Map<Node, TargetTypeRef>();
  for (const activation of callableOwnership.activations) for (const declaration of activation.slotDeclarations) {
    const carrier = context.records.runtimeCarrier.get(declaration)?.carrier;
    if (carrier === undefined || rustFrameCallableValue(carrier) === undefined) {
      appendRustDiagnostic(walk, "RUST_CALLABLE_VALUE_NOT_CLOSED",
        "A native frame slot requires its completed physical carrier in its original checked declaration scope.",
        declaration, ["target.capability=rust.callable-value.exact-implementation"]);
    } else frameBindingCarriers.set(declaration, carrier);
  }
  if (context.diagnostics.length !== 0) return undefined;
  const callableValues = context.callableValues.initialize({ ast, sourceFiles: context.sourceFiles, records: context.records,
    operationAttempts: walk.operationAttempts,
    flowApplications: context.records.genericFlowApplications,
    nativeNodes: context.nativeNodes, isNativeNode: context.isNativeNode,
    sourcePackages: context.sourcePackages,
    names: context.names, navigation: context.source.navigation, lifetimes: context.sourceLifetimes,
    classValueAdapters: context.classValues.valueAdapters(), structuralViews: context.classValues.instanceViewRequests(),
    closedSourceFiles, ownership: callableOwnership,
    frameBindingCarriers, sourceStorage: context.sourceStorage,
    sourceTypes: walk.sourceTypes,
    projectTypes: context.projectTypes, objectRepresentations: context.objectRepresentations,
    frozenDataWrites: context.frozenDataWrites,
    typeDefinitions: context.typeDefinitions, lexicalFunctions: lexical, structuralShapes: context.structuralShapes,
    retainedEnvironments: context.retainedEnvironments, nativeTasks: context.nativeTaskGraph,
    normalizeTypeFamily: rustTypeFamilyNormalizer(context.typeFamilies),
    carrierHost: { sourceStorage: context.sourceStorage, sourceTypes: walk.sourceTypes,
      projectFieldProjection: walk.operationOptions.projectFieldProjection, semantics: context.semantics,
      types: { resolveNode: node => context.records.runtimeCarrier.get(node)?.carrier } } });
  const callableIssue = (issue: RustSourceCallableSpecializationIssue): void => appendRustDiagnostic(walk,
    "RUST_CALLABLE_VALUE_NOT_CLOSED", issue.message, issue.subject, ["target.capability=rust.callable-value.exact-implementation"]);
  callableValues.issues.forEach(callableIssue);
  if (context.diagnostics.length !== 0) return undefined;
  const selectedIssuePosition = context.diagnostics.length;
  context.promiseBodies.seal(context);
  if (context.diagnostics.length !== selectedIssuePosition) return undefined;
  const nativeTasks = context.nativeTaskGraph;
  const fallibility = recordFallibilityFacts(walk, projectSourceFiles, nativeTasks);
  if (fallibility === undefined || context.diagnostics.length !== selectedIssuePosition) return;
  recordResourceManagementFacts(walk);
  const sourcePackageComponents = analyzeRustSourcePackageComponents(context, outputType, fallibility.effectsFor);
  if (sourcePackageComponents.kind === "rejected") {
    context.diagnostics.push(...sourcePackageComponents.diagnostics);
    return;
  }
  const physicalIssues = context.callableValues.preparePhysicalStorage(sourcePackageComponents.plan, fallibility.effectsFor,
    context.promiseBodies.plan);
  const sourceStorageFailure = context.sourceStorage.failureReason();
  if (sourceStorageFailure !== undefined) {
    appendRustDiagnostic(walk, "RUST_SOURCE_STORAGE_NOT_PROVEN", sourceStorageFailure, undefined,
      []);
    return;
  }
  physicalIssues.forEach(callableIssue);
  if (context.diagnostics.length !== selectedIssuePosition) return;
  recordFutureValueFacts(walk, fallibility.sourceErrors);
  const nativeTaskCompletions = completeRustNativeTaskValues(walk, nativeTasks, fallibility.sourceErrors);
  if (nativeTaskCompletions.kind === "rejected") {
    context.diagnostics.push(...nativeTaskCompletions.diagnostics);
    return;
  }
  recordRustDeferredProducerEffects(walk, fallibility.sourceErrors);
  const lexicalFunctions = finalizeRustLexicalFunctionQueries(lexical, context.source, context.records, context.sourceLifetimes,
    callableValues.nativeStorage, callableValues.native);
  const effectDiagnosticEnd = context.diagnostics.length;
  try {
    const callableSelection = context.callableValues.finalizeSelected();
    if (callableSelection.kind === "rejected") {
      context.diagnostics.push(...callableSelection.diagnostics);
      return undefined;
    }
    callableSelection.value.forEach(callableIssue);
    fallibility.complete();
  } finally {
    context.diagnostics.splice(selectedIssuePosition, 0, ...context.diagnostics.splice(effectDiagnosticEnd));
  }
  return Object.freeze({ lexicalFunctions, nativeTasks, nativeTaskCompletions: nativeTaskCompletions.value,
    operationAttempts: walk.operationAttempts,
    sourcePackageComponents: sourcePackageComponents.plan,
    sourceTypes: Object.freeze({ structuralObjectForCarrier: sourceTypes.structuralObjectForCarrier }) });
}
