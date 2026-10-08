import {
  requirementContractsEqual,
  requirementUseHasValidStorage,
  stringListsEqual,
  type RequirementUse,
  type RequirementContractState,
} from "./generic-requirement-contract.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import { type RustOptionalStorageRequirement } from "./type-projections.js";
import { collectRustCallableDeclarations } from "./generic-reference-uses.js";
import { type RustAssociatedTypeRequirement } from "./associated-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import { analyzeRustShapeGenericRequirements, type RustShapeGenericRequirementContract } from "./generic-shape-requirements.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectProjectionImplementation } from "../../policy/types/project-projections.js";
import type { RustProjectProjectionRequirement } from "../../target-model/types/project-projections.js";
import type { RustProjectTypeDefinition } from "../project-types/type-policy.js";
import { createRustProjectProjectionImplementationIndex } from "./project-projection-requirements.js";
import type { RustValueLifetimePlan } from "../program/value-lifetimes.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { resolveTargetContractFixedPoint } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCarrierSupportsTrait } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";

import { classifyRustCallableRequirements } from "./generic-callable-requirements.js";
import { normalizeRustGenericRequirements } from "./generic-requirement-contract.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/type-family-normalization.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustProjectStructuralView } from "../objects/project-structural-views.js";
import { rustStructuralViewRequirementUses } from "./structural-view-requirements.js";

export type RustGenericRequirement = "clone" | "default" | "static" | "source-numeric" | "number-predicate";

export interface RustDeclarationTypeParameterRequirements {
  readonly identity: string;
  readonly name: string;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RustDeclarationGenericRequirementContract {
  readonly declaration: Node;
  readonly typeParameters: readonly RustDeclarationTypeParameterRequirements[];
  readonly capturedTypeParameters: readonly RustDeclarationTypeParameterRequirements[];
  readonly associatedTypes: readonly RustAssociatedTypeRequirement[];
  readonly projectProjections: readonly RustProjectProjectionRequirement[];
  readonly optionalStorage: readonly RustOptionalStorageRequirement[];
}

export interface RustDeclarationGenericRequirementIndex {
  projectionImplementationsFor(definition: RustProjectTypeDefinition): readonly RustProjectProjectionImplementation[];
  contractFor(declaration: Node): RustDeclarationGenericRequirementContract | undefined;
  contractForCarrier(carrier: TargetTypeRef): RustShapeGenericRequirementContract | undefined;
  contractForStructuralView(view: RustProjectStructuralView): RustShapeGenericRequirementContract | undefined;
  supportsClone(declaration: Node, carrier: TargetTypeRef): boolean;
  hasUse(
    declaration: Node,
    node: Node,
    carrier: TargetTypeRef,
    requirements: readonly RustGenericRequirement[],
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
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  names: RustNamePlan,
  sourceLifetimes: RustLifetimeIndex,
  typeFamilies: RustSourceTypeFamilyRegistry,
  projectTypes: RustProjectTypePolicy,
  shapes: RustStructuralShapePlan,
  definitions: RustTypeDefinitions,
  valueLifetimes: RustValueLifetimePlan,
  objectRepresentations: RustObjectRepresentationPlan,
  genericCallables: RustGenericCallablePlan,
  structuralViews: readonly RustProjectStructuralView[],
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
  const declarations = collectRustCallableDeclarations(ast, sourceFiles);
  const declarationById = new Map<string, Node>();
  const idByDeclaration = new WeakMap<Node, string>();
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
    idByDeclaration.set(declaration, id);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }
  const maximumEvaluations = declarations.length * declarations.length +
    declarations.length;
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
  const closure = resolveTargetContractFixedPoint<RequirementContractState>({
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
        facts,
        names,
        sourceLifetimes,
        typeFamilies,
        projectTypes,
        objectRepresentations,
        genericCallables,
        structuralShapes: shapes,
        structuralViewsFor: (declaration: Node) => viewsByDeclaration.get(declaration) ?? [],
        valueLifetimes,
        isStoredValue,
        readsValue(node) {
          const access = ast.is.IsElementAccessExpression(node)
            ? source.semantics.forNode(node).operations.elementAccess(node)
            : ast.is.IsPropertyAccessExpression(node)
              ? source.semantics.forNode(node).operations.propertyAccess(node) : undefined;
          return access?.accessMode !== "write" && access?.accessMode !== "delete";
        },
        idByDeclaration,
        implementationDeclaration,
        contractFor(candidate) {
          const candidateId = idByDeclaration.get(candidate);
          return candidateId === undefined ? undefined : context.get(candidateId);
        },
      });
      return result.kind === "rejected"
        ? result
        : {
            kind: "resolved",
            revision: {
              contract: result.contract,
              dependencies: result.dependencies,
            },
          };
    },
    equals: requirementContractsEqual,
    maximumContracts: Math.max(1, declarations.length),
    maximumRevisionsPerContract: Math.max(8, declarations.length + 1),
    maximumEvaluations: Math.max(64, maximumEvaluations),
  });
  if (closure.kind === "rejected") {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([diagnostic(
        "RUST_CALLABLE_CONTRACT_CLOSURE_REJECTED",
        closure.reason,
        closure.contractId === undefined
          ? undefined
          : declarationById.get(closure.contractId),
      )]),
    };
  }
  const contractByDeclaration = new WeakMap<Node, RequirementContractState>();
  const projectionRequirements: RustProjectProjectionRequirement[] = [];
  const usesByNode = new WeakMap<Node, RequirementUse[]>();
  for (const id of closure.program.ids) {
    const contract = closure.program.get(id)!;
    projectionRequirements.push(...contract.projectProjections);
    contractByDeclaration.set(contract.declaration, contract);
    for (const use of contract.uses) {
      const uses = usesByNode.get(use.node) ?? [];
      uses.push(use);
      usesByNode.set(use.node, uses);
    }
  }
  const normalizeFamily = rustTypeFamilyNormalizer(typeFamilies);
  const index: RustDeclarationGenericRequirementIndex = Object.freeze({
    projectionImplementationsFor: createRustProjectProjectionImplementationIndex(projectionRequirements, projectTypes),
    contractFor(declaration: Node) {
      return contractByDeclaration.get(declaration);
    },
    contractForCarrier(carrier: TargetTypeRef) { return shapeContracts.get(closedMetadataKey(carrier)); },
    contractForStructuralView(view: RustProjectStructuralView) {
      return viewContracts.get(closedMetadataKey([view.sourceCarrier, view.targetCarrier]));
    },
    supportsClone(declaration: Node, carrier: TargetTypeRef) {
      const contract = contractByDeclaration.get(declaration);
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
    ) {
      const normalized = normalizeRustGenericRequirements(requirements);
      return contractByDeclaration.has(declaration) &&
        (usesByNode.get(node) ?? []).some((use) =>
          requirementUseHasValidStorage(use) &&
          rustTargetTypeRefEquals(use.carrier, carrier) &&
          stringListsEqual(use.requirements, normalized));
    },
  });
  const shapeContracts = new Map<string, RustShapeGenericRequirementContract>();
  const viewContracts = new Map<string, RustShapeGenericRequirementContract>();
  for (const carrier of [...shapes.definitions.map(definition => definition.carrier),
    ...shapes.unionDefinitions.flatMap(definition => definition.sourceCarriers),
    ...typeFamilies.implementations().map(implementation => ({ kind: "tuple" as const, elements: [implementation.owner, implementation.output] }))]) {
    const contract = analyzeRustShapeGenericRequirements(carrier, projectTypes, typeFamilies, index.contractFor, definitions);
    if (contract === undefined) return { kind: "rejected", diagnostics: Object.freeze([diagnostic(
      "RUST_SHAPE_GENERIC_CONTRACT_NOT_PROVEN", "A structural source carrier has no exact generic or associated-output requirements.",
    )]) };
    shapeContracts.set(closedMetadataKey(carrier), contract);
  }
  for (const view of structuralViews) {
    const uses = rustStructuralViewRequirementUses(view);
    const contract = analyzeRustShapeGenericRequirements({ kind: "tuple", elements: [view.sourceCarrier, view.targetCarrier] },
      projectTypes, typeFamilies, index.contractFor, definitions, uses);
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
