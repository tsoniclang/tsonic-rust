import { requirementContractsEqual, requirementUseHasValidStorage, stringListsEqual, type RequirementContractState } from "./generic-requirement-contract.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { Node } from "@tsonic/tsts";
import { normalizeRustErrorType } from "../errors/error-types.js";

import { collectRustCallableDeclarations } from "./generic-reference-uses.js";

import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import { analyzeRustShapeGenericRequirements } from "./generic-shape-requirements.js";
import type { RustShapeGenericRequirementContract } from "../../target-model/records/generic-requirements.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectProjectionImplementation } from "../../target-model/records/project-projections.js";
import type { RustProjectProjectionRequirement } from "../../target-model/types/project-projections.js";
import type { RustProjectTypeDefinition } from "../project-types/index.js";
import { createRustProjectProjectionImplementationIndex } from "./project-projection-requirements.js";
import type { RustOwnershipFlow } from "../../target-model/records/ownership-flow.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { resolveTargetContractFixedPoint } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceExpressionResultDisposition, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import { rustCarrierSupportsTrait } from "../../policy/constraints/native-traits.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";

import { classifyRustCallableRequirements } from "./generic-callable-requirements.js";
import { normalizeRustGenericRequirements } from "./generic-requirement-contract.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustNativeCallableInputPlan } from "../callables/native-inputs.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import type { RustProjectStructuralView } from "../../target-model/records/project-structural-views.js";
import { rustStructuralViewRequirementUses } from "./structural-view-requirements.js";
import type { RustAnalyzedErrorRegions } from "../errors/regions.js";
import type { RustErrorTypeContext } from "../errors/error-types.js";
import type { RustPromiseBodies } from "../../target-model/records/callables-and-resources.js";
import type { RustNativeStoragePlan } from "../callables/native-storage.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";
import type { RustStaticRequirementEvidence } from "./generic-carrier-requirements.js";
import type { RustProjectCallableFieldStorage } from "../callables/project-field-storage.js";
import { rustSuspendingPromiseBorrowReason } from "../callables/suspension-storage.js";

import type { RustGenericRequirement, RustDeclarationGenericRequirementContract } from "../../target-model/records/generic-requirements.js";

export interface RustDeclarationGenericRequirementIndex {
  projectionImplementationsFor(definition: RustProjectTypeDefinition): readonly RustProjectProjectionImplementation[];
  contractFor(declaration: Node, body?: true): RustDeclarationGenericRequirementContract | undefined;
  contractForCarrier(carrier: TargetTypeRef): RustShapeGenericRequirementContract | undefined;
  contractForStructuralView(view: RustProjectStructuralView): RustShapeGenericRequirementContract | undefined;
  supportsClone(declaration: Node, carrier: TargetTypeRef, body?: true): boolean;
  hasUse(
    declaration: Node,
    node: Node,
    carrier: TargetTypeRef,
    requirements: readonly RustGenericRequirement[],
    body?: true,
  ): boolean;
}

export type AnalyzeRustDeclarationGenericRequirementsResult =
  | {
      readonly kind: "resolved";
      readonly index: RustDeclarationGenericRequirementIndex;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

export function analyzeRustDeclarationGenericRequirements(
  source: TargetSourceProgram,
  nativeNodes: readonly Node[],
  records: RustAnalysisRecords,
  names: RustNamePlan,
  sourceLifetimes: RustLifetimeIndex,
  typeFamilies: RustSourceTypeFamilyRegistry,
  projectTypes: RustProjectTypePolicy,
  shapes: RustStructuralShapePlan,
  definitions: RustTypeDefinitions,
  ownershipFlow: RustOwnershipFlow,
  objectRepresentations: RustObjectRepresentationPlan,
  genericCallables: RustGenericCallablePlan,
  structuralViews: readonly RustProjectStructuralView[],
  frameCallables: RustFrameCallablePlan,
  nativeCallables: RustNativeCallableInputPlan,
  errorRegions: RustAnalyzedErrorRegions,
  promiseBodies: RustPromiseBodies,
  nativeStorage: RustNativeStoragePlan,
  projectFieldStorage: RustProjectCallableFieldStorage,
  classValues: RustClassValuePlan,
  errorTypes: RustErrorTypeContext,
  borrowFor: (node: Node) => "shared" | "mutable" | undefined,
): AnalyzeRustDeclarationGenericRequirementsResult {
  const ast = source.ast;
  const diagnostics: TargetDiagnostic[] = [];
  const storageReads = new WeakMap<Node, ReadonlySet<Node>>();
  const viewsByDeclaration = new WeakMap<Node, RustProjectStructuralView[]>();
  for (const view of structuralViews) {
    const selected = viewsByDeclaration.get(view.declaration) ?? [];
    selected.push(view);
    viewsByDeclaration.set(view.declaration, selected);
  }
  const isStoredValue = (node: Node): boolean => {
    const owner = source.navigation.sourceReferenceFor(node)?.declaration;
    if (owner === undefined) return false;
    let references = storageReads.get(owner);
    if (references === undefined) {
      references = new Set(source.navigation.declarationUses(owner)
        .filter(use => use.role === "storage" && !use.throughMember).map(use => use.reference));
      storageReads.set(owner, references);
    }
    return references.has(node);
  };
  const declarations = collectRustCallableDeclarations(ast, nativeNodes);
  const declarationById = new Map<string, Node>();
  const idByDeclaration = new WeakMap<Node, string>();
  const bodyIdByDeclaration = new WeakMap<Node, string>();
  const objectFacets = new Set<string>();
  const promiseStorageDemands = (declaration: Node): readonly Node[] => {
    const demands = new Set(promiseBodies.objects.get(declaration) ?? [declaration]);
    for (const node of nativeNodes) {
      const operation = records.targetOperation.get(node);
      if (operation?.kind === "source-call" && operation.asyncBody?.declaration === declaration &&
        sourceExpressionResultDisposition(ast, node).kind === "stored") demands.add(node);
    }
    return [...demands];
  };
  for (const declaration of declarations) {
    const id = sourceNodeIdentity(ast, declaration);
    if (id === undefined || declarationById.has(id)) {
      diagnostics.push(diagnostic(
        "RUST_CALLABLE_CONTRACT_IDENTITY_MISSING",
        "A Rust callable contract requires one unique compiler-owned source identity.",
        declaration,
      ));
      continue;
    }
    declarationById.set(id, declaration);
    bodyIdByDeclaration.set(declaration, id);
    if (promiseBodies.declarations.has(declaration) && promiseBodies.objects.has(declaration)) {
      const objectId = `${id}:promise-object`;
      declarationById.set(objectId, declaration);
      objectFacets.add(objectId);
      idByDeclaration.set(declaration, objectId);
    } else idByDeclaration.set(declaration, id);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }
  const maximumEvaluations = declarationById.size * declarationById.size + declarationById.size;
  if (!Number.isSafeInteger(maximumEvaluations)) {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([diagnostic(
        "RUST_CALLABLE_CONTRACT_BUDGET_INVALID",
        "The callable inventory cannot produce a finite generic-contract analysis budget.",
      )]),
    };
  }
  const implementationDeclaration = (declaration: Node): Node => {
    if (idByDeclaration.has(declaration)) {
      return declaration;
    }
    const implementation = source.navigation.callableImplementation(declaration);
    return implementation?.kind === "resolved" &&
        idByDeclaration.has(implementation.implementation.declaration)
      ? implementation.implementation.declaration
      : declaration;
  };
  const closure = resolveTargetContractFixedPoint<RequirementContractState, readonly TargetDiagnostic[]>({
    roots: [...declarationById.keys()],
    evaluate(id, context) {
      const declaration = declarationById.get(id);
      if (declaration === undefined) {
        return {
          kind: "rejected",
          reason: `Rust callable contract '${id}' has no exact source declaration.`,
        };
      }
      const result = classifyRustCallableRequirements({
        ast,
        typeDefinitions: definitions,
        declaration,
        records,
        names,
        sourceLifetimes,
        typeFamilies,
        projectTypes,
        objectRepresentations,
        genericCallables,
        nativeCallables,
        nativeStorage,
        projectFieldStorage,
        classValues,
        errorRegions,
        errorTypes,
        frameCallables,
        structuralShapes: shapes,
        structuralViewsFor: (declaration: Node) => viewsByDeclaration.get(declaration) ?? [],
        ownershipFlow,
        borrowFor,
        isStoredValue,
        readsValue(node) {
          const access = ast.is.IsElementAccessExpression(node)
            ? source.semantics.forNode(node).operations.elementAccess(node)
            : ast.is.IsPropertyAccessExpression(node)
              ? source.semantics.forNode(node).operations.propertyAccess(node) : undefined;
          return access?.accessMode !== "write" && access?.accessMode !== "delete";
        },
        idByDeclaration,
        bodyIdByDeclaration,
        nativePromiseBody: promiseBodies.declarations.has(declaration),
        ...(objectFacets.has(id) ? { promiseObjectFacet: true as const,
          inheritedBody: context.get(bodyIdByDeclaration.get(declaration)!) } : {}),
        implementationDeclaration,
        contractFor(candidate, body?: true) {
          const candidateId = (body === true ? bodyIdByDeclaration : idByDeclaration).get(candidate);
          return candidateId === undefined ? undefined : context.get(candidateId);
        },
      });
      return result.kind === "rejected"
        ? { kind: "rejected", reason: result.reason, cause: Object.freeze(result.promiseStorage === true
            ? promiseStorageDemands(declaration).map(demand =>
              diagnostic("RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", rustSuspendingPromiseBorrowReason, demand))
            : [diagnostic("RUST_CALLABLE_CONTRACT_CLOSURE_REJECTED", result.reason, declaration)]) }
        : {
            kind: "resolved",
            revision: {
              contract: result.contract,
              dependencies: objectFacets.has(id) ? [bodyIdByDeclaration.get(declaration)!, ...result.dependencies] : result.dependencies,
            },
          };
    },
    equals: requirementContractsEqual,
    maximumContracts: Math.max(1, declarationById.size),
    maximumRevisionsPerContract: Math.max(8, declarationById.size + 1),
    maximumEvaluations: Math.max(64, maximumEvaluations),
  });
  if (closure.kind === "rejected") {
    const storageDemands = new Set<NonNullable<TargetDiagnostic["sourceNode"]>>();
    for (const failure of closure.failures) {
      for (const issue of failure.cause ?? [diagnostic("RUST_CALLABLE_CONTRACT_CLOSURE_REJECTED",
        failure.reason, failure.contractId === undefined ? undefined : declarationById.get(failure.contractId))]) {
        if (issue.code === "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN" && issue.sourceNode !== undefined) {
          if (storageDemands.has(issue.sourceNode)) continue;
          storageDemands.add(issue.sourceNode);
        }
        diagnostics.push(issue);
      }
    }
    return {
      kind: "rejected",
      diagnostics: Object.freeze(diagnostics),
    };
  }
  const contractByDeclaration = new WeakMap<Node, RequirementContractState>();
  const bodyContractByDeclaration = new WeakMap<Node, RequirementContractState>();
  const projectionRequirements: RustProjectProjectionRequirement[] = [];
  for (const id of closure.program.ids) {
    const contract = closure.program.get(id)!;
    projectionRequirements.push(...contract.projectProjections);
    if (bodyIdByDeclaration.get(contract.declaration) === id) bodyContractByDeclaration.set(contract.declaration, contract);
    if (idByDeclaration.get(contract.declaration) === id) contractByDeclaration.set(contract.declaration, contract);
  }
  const normalizeFamily = rustTypeFamilyNormalizer(typeFamilies);
  const index: RustDeclarationGenericRequirementIndex = Object.freeze({
    projectionImplementationsFor: createRustProjectProjectionImplementationIndex(projectionRequirements, projectTypes),
    contractFor(declaration: Node, body?: true) {
      return (body === true ? bodyContractByDeclaration : contractByDeclaration).get(declaration);
    },
    contractForCarrier(carrier: TargetTypeRef) { return shapeContracts.get(closedMetadataKey(carrier)); },
    contractForStructuralView(view: RustProjectStructuralView) {
      return viewContracts.get(closedMetadataKey([view.sourceCarrier, view.targetCarrier]));
    },
    supportsClone(declaration: Node, carrier: TargetTypeRef, body?: true) {
      const contract = (body === true ? bodyContractByDeclaration : contractByDeclaration).get(declaration);
      if (contract === undefined) return false;
      const parameters = [...contract.typeParameters, ...contract.capturedTypeParameters,
        ...contract.optionalStorage.map(entry => ({ identity: entry.carrier.identity, requirements: entry.requirements }))];
      return rustCarrierSupportsTrait(mapRustTargetTypes(carrier, normalizeFamily), "core::clone::Clone", (name, trait) =>
        trait === "core::clone::Clone" && parameters.some(parameter =>
          parameter.identity === name && parameter.requirements.includes("clone")),
        (projection, trait) => trait === "core::clone::Clone" && contract.associatedTypes.some(requirement =>
          rustTargetTypeRefEquals(requirement.carrier, projection) && requirement.requirements.includes("clone")), definitions);
    },
    hasUse(
      declaration: Node,
      node: Node,
      carrier: TargetTypeRef,
      requirements: readonly RustGenericRequirement[],
      body?: true,
    ) {
      const normalized = normalizeRustGenericRequirements(requirements);
      const contract = (body === true ? bodyContractByDeclaration : contractByDeclaration).get(declaration);
      return contract !== undefined && contract.uses.some((use) => use.node === node &&
          requirementUseHasValidStorage(use) &&
          rustTargetTypeRefEquals(use.carrier, carrier) &&
          stringListsEqual(use.requirements, normalized));
    },
  });
  const shapeContracts = new Map<string, RustShapeGenericRequirementContract>();
  const viewContracts = new Map<string, RustShapeGenericRequirementContract>();
  const shapeEvidence: RustStaticRequirementEvidence = { lifetimeContract: undefined, genericCallables,
    frameCallables, classValues, objectRepresentations, structuralShapes: shapes, projectTypes, records, projectFieldStorage,
    errorType: (carrier, node) => normalizeRustErrorType(carrier, errorTypes, node) };
  const sourceScopes = new Map<string, Node | undefined>();
  for (const sourceFile of source.sourceFiles) {
    const fileName = ast.getFileName(sourceFile);
    sourceScopes.set(fileName, sourceScopes.has(fileName) && sourceScopes.get(fileName) !== sourceFile ? undefined : sourceFile);
  }
  const shapeInputs = [...shapes.definitions.map(definition => ({
    carrier: definition.carrier, sourceFileName: definition.ownerFileName,
  })), ...shapes.unionDefinitions.flatMap(definition => definition.sourceCarriers.map(carrier => ({
    carrier, sourceFileName: rustSourceUnionCarrierValue(carrier)?.fileName,
  }))), ...typeFamilies.implementations().map(implementation => ({
    carrier: { kind: "tuple" as const, elements: [implementation.owner, implementation.output] },
    sourceFileName: implementation.sourceFileName,
  }))];
  for (const { carrier, sourceFileName } of shapeInputs) {
    const sourceScope = sourceFileName === undefined ? undefined : sourceScopes.get(sourceFileName);
    const contract = analyzeRustShapeGenericRequirements(carrier, projectTypes, typeFamilies, index.contractFor,
      shapeEvidence, definitions, [], errorTypes, sourceScope);
    if (contract === undefined) return { kind: "rejected", diagnostics: Object.freeze([diagnostic(
      "RUST_SHAPE_GENERIC_CONTRACT_NOT_PROVEN", "A structural source carrier has no exact generic or associated-output requirements.",
    )]) };
    shapeContracts.set(closedMetadataKey(carrier), contract);
  }
  for (const view of structuralViews) {
    const uses = rustStructuralViewRequirementUses(view);
    const contract = analyzeRustShapeGenericRequirements({ kind: "tuple", elements: [view.sourceCarrier, view.targetCarrier] },
      projectTypes, typeFamilies, index.contractFor, shapeEvidence, definitions, uses, errorTypes, view.declaration);
    if (contract === undefined) return { kind: "rejected", diagnostics: Object.freeze([diagnostic(
      "RUST_STRUCTURAL_VIEW_GENERIC_CONTRACT_NOT_PROVEN",
      "A selected structural implementation has no exact generic or associated-output requirements.", view.declaration,
    )]) };
    viewContracts.set(closedMetadataKey([view.sourceCarrier, view.targetCarrier]), contract);
  }
  return { kind: "resolved", index };
}

function diagnostic(
  code: string,
  message: string,
  sourceNode?: Node,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    ...(sourceNode === undefined ? {} : { sourceNode }),
    evidence: ["target.capability=rust.callable.generic-contract-closure"],
  };
}
