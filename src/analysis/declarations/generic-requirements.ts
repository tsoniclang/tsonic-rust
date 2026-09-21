import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { rustGenericNumericOperandsKey } from "../facts/generic-numeric.js";
import { classifyCarrierRequirements } from "./generic-carrier-requirements.js";
import { isRustDeclarationPathUse } from "./generic-reference-uses.js";
import { createRustAssociatedRequirementCollector, type RustAssociatedTypeRequirement } from "./associated-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../policy/types/type-families.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustJsArrayEntriesElementTargetType } from "../../target-model/types/carriers/array-entries.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { analyzeRustShapeGenericRequirements, type RustShapeGenericRequirementContract } from "./generic-shape-requirements.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustValueLifetimePlan } from "../program/value-lifetimes.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import {
  resolveTargetContractFixedPoint,
} from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  KindBinaryExpression,
  KindExpressionStatement,
  Node_Expression,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import { rustValueCarrierBeforeOptionProjection } from "../facts/value-carrier-queries.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  getRustGeneratorProtocol,
  isRustCopyCarrier,
  rustCarrierSupportsTrait,
  rustClosureProtocol,
  rustJsPromiseTargetId,
  rustSourceTypeCarrierValue,
  rustTargetGenericTypeArguments,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import {
  rustAsyncFunctionFactKey,
  rustClosureCaptureFactKey,
  rustGeneratorFactKey,
  rustFutureValueFactKey,
  rustFlowReadProjectionFactKey,
  rustLocationStorageFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
  rustTypedLocationPlanKey,
  rustYieldFactKey,
} from "../facts/keys.js";

export type RustGenericRequirement = "clone" | "default" | "static" | "source-numeric";

export interface RustDeclarationTypeParameterRequirements {
  readonly name: string;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RustDeclarationGenericRequirementContract {
  readonly declaration: Node;
  readonly typeParameters: readonly RustDeclarationTypeParameterRequirements[];
  readonly associatedTypes: readonly RustAssociatedTypeRequirement[];
}

export interface RustDeclarationGenericRequirementIndex {
  contractFor(declaration: Node): RustDeclarationGenericRequirementContract | undefined;
  contractForCarrier(carrier: TargetTypeRef): RustShapeGenericRequirementContract | undefined;
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

interface RequirementUse {
  readonly node: Node;
  readonly carrier: TargetTypeRef;
  readonly requirements: readonly RustGenericRequirement[];
}

interface RequirementContractState extends RustDeclarationGenericRequirementContract {
  readonly uses: readonly RequirementUse[];
  readonly capturedTypeParameters: readonly RustDeclarationTypeParameterRequirements[];
}

const requirementOrder: readonly RustGenericRequirement[] = [
  "clone",
  "default",
  "static",
  "source-numeric",
];

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
): AnalyzeRustDeclarationGenericRequirementsResult {
  const ast = source.ast;
  const diagnostics: TargetDiagnostic[] = [];
  const declarations = collectCallableDeclarations(ast, sourceFiles);
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
      const result = classifyCallableRequirements({
        ast,
        typeDefinitions: definitions,
        declaration,
        facts,
        names,
        sourceLifetimes,
        typeFamilies,
        projectTypes,
        valueLifetimes,
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
  const usesByNode = new WeakMap<Node, RequirementUse[]>();
  for (const id of closure.program.ids) {
    const contract = closure.program.get(id)!;
    contractByDeclaration.set(contract.declaration, contract);
    for (const use of contract.uses) {
      const uses = usesByNode.get(use.node) ?? [];
      uses.push(use);
      usesByNode.set(use.node, uses);
    }
  }
  const index: RustDeclarationGenericRequirementIndex = Object.freeze({
    contractFor(declaration: Node) {
      return contractByDeclaration.get(declaration);
    },
    contractForCarrier(carrier: TargetTypeRef) { return shapeContracts.get(closedMetadataKey(carrier)); },
    supportsClone(declaration: Node, carrier: TargetTypeRef) {
      const contract = contractByDeclaration.get(declaration);
      if (contract === undefined) return false;
      const parameters = [...contract.typeParameters, ...contract.capturedTypeParameters];
      return rustCarrierSupportsTrait(carrier, "core::clone::Clone", (name, trait) =>
        trait === "core::clone::Clone" && parameters.some(parameter =>
          parameter.name === name && parameter.requirements.includes("clone")),
        (projection, trait) => trait === "core::clone::Clone" && contract.associatedTypes.some(requirement =>
          rustTargetTypeRefEquals(requirement.carrier, projection) && requirement.requirements.includes("clone")), definitions);
    },
    hasUse(
      declaration: Node,
      node: Node,
      carrier: TargetTypeRef,
      requirements: readonly RustGenericRequirement[],
    ) {
      const normalized = normalizeRequirements(requirements);
      return contractByDeclaration.has(declaration) &&
        (usesByNode.get(node) ?? []).some((use) =>
          rustTargetTypeRefEquals(use.carrier, carrier) &&
          stringListsEqual(use.requirements, normalized));
    },
  });
  const shapeContracts = new Map<string, RustShapeGenericRequirementContract>();
  for (const carrier of [...shapes.definitions.map(definition => definition.carrier),
    ...shapes.unionDefinitions.flatMap(definition => definition.sourceCarriers),
    ...typeFamilies.implementations().map(implementation => ({ kind: "tuple" as const, elements: [implementation.owner, implementation.output] }))]) {
    const contract = analyzeRustShapeGenericRequirements(carrier, projectTypes, typeFamilies, index.contractFor, definitions);
    if (contract === undefined) return { kind: "rejected", diagnostics: Object.freeze([diagnostic(
      "RUST_SHAPE_GENERIC_CONTRACT_NOT_PROVEN", "A structural source carrier has no exact generic or associated-output requirements.",
    )]) };
    shapeContracts.set(closedMetadataKey(carrier), contract);
  }
  return { kind: "resolved", index };
}

interface ClassifyCallableInput {
  readonly valueLifetimes: RustValueLifetimePlan;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly ast: AstReader;
  readonly declaration: Node;
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  readonly projectTypes: RustProjectTypePolicy;
  readonly idByDeclaration: WeakMap<Node, string>;
  readonly implementationDeclaration: (declaration: Node) => Node;
  readonly contractFor: (declaration: Node) => RequirementContractState | undefined;
}


function classifyCallableRequirements(input: ClassifyCallableInput):
  | {
      readonly kind: "resolved";
      readonly contract: RequirementContractState;
      readonly dependencies: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: string } {
  const { ast, declaration, facts, names } = input;
  const definition = input.projectTypes.definitionForDeclaration(declaration);
  const typeParameterNodes = (definition === undefined ? ast.typeParameters(declaration)
    : definition.genericParameters.map(parameter => parameter.declaration)).filter(
    (candidate): candidate is Node => candidate !== undefined &&
      input.sourceLifetimes.parameterFor(candidate)?.kind !== "lifetime",
  );
  const typeParameterNames = typeParameterNodes.map((parameter) =>
    names.nameForDeclaration(parameter));
  if (typeParameterNames.some((name) => name === undefined)) {
    return {
      kind: "rejected",
      reason: "A Rust callable type parameter has no exact target identity.",
    };
  }
  const exactNames = typeParameterNames as string[];
  const capturedNames: string[] = [];
  for (let ancestor = ast.parent(declaration); ancestor !== undefined; ancestor = ast.parent(ancestor)) {
    if (!isIndependentCallable(ast, ancestor) && ast.kindName(ancestor) !== "KindClassDeclaration") continue;
    for (const parameter of ast.typeParameters(ancestor)) {
      if (parameter === undefined || input.sourceLifetimes.parameterFor(parameter)?.kind === "lifetime") continue;
      const name = names.nameForDeclaration(parameter);
      if (name === undefined) return { kind: "rejected", reason: "A captured Rust type parameter has no exact target identity." };
      if (!exactNames.includes(name) && !capturedNames.includes(name)) capturedNames.push(name);
    }
  }
  const declared = new Set([...exactNames, ...capturedNames]);
  const byParameter = new Map([...declared].map((name) =>
    [name, new Set<RustGenericRequirement>()] as const));
  if (definition !== undefined) for (const name of exactNames) byParameter.get(name)!.add("clone");
  const uses: RequirementUse[] = [];
  const dependencies = new Set<string>();
  const associated = createRustAssociatedRequirementCollector(declared, input.typeFamilies,
    (carrier, requirements) => classifyCarrierRequirements(carrier, requirements, declared, byParameter, associated.require, input.typeDefinitions));
  const addUse = (
    node: Node,
    carrier: TargetTypeRef | undefined,
    requirements: readonly RustGenericRequirement[],
  ): string | undefined => {
    if (carrier === undefined) {
      return "A Rust generic requirement has no exact target carrier.";
    }
    const normalized = normalizeRequirements(requirements);
    const classified = classifyCarrierRequirements(
      carrier,
      normalized,
      declared,
      byParameter,
      associated.require,
      input.typeDefinitions,
    );
    if (!classified) {
      return `A generated Rust operation requires ${rustRequirementDescription(normalized)} that its exact target carrier does not provide.`;
    }
    if (!uses.some((use) => use.node === node &&
      rustTargetTypeRefEquals(use.carrier, carrier) &&
      stringListsEqual(use.requirements, normalized))) {
      uses.push(Object.freeze({ node, carrier, requirements: normalized }));
    }
    return undefined;
  };
  const generator = facts.getFact(declaration, rustGeneratorFactKey);
  if (generator !== undefined) {
    if (generator.storage.kind !== "lifetime") {
      for (const parameter of generator.capturedParameters) {
        const error = addUse(
          parameter,
          facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier,
          ["static"],
        );
        if (error !== undefined) {
          return { kind: "rejected", reason: error };
        }
      }
      for (const carrier of [generator.yieldType, generator.returnType, generator.nextType]) {
        const error = addUse(declaration, carrier, ["static"]);
        if (error !== undefined) {
          return { kind: "rejected", reason: error };
        }
      }
    }
  }
  const asynchronous = facts.getFact(declaration, rustAsyncFunctionFactKey);
  if (asynchronous?.kind === "js-promise") {
    const error = addUse(
      declaration,
      asynchronous.outputCarrier,
      asynchronous.storage.kind === "static" ? ["clone", "static"] : ["clone"],
    );
    if (error !== undefined) {
      return { kind: "rejected", reason: error };
    }
    if (asynchronous.storage.kind === "static") {
      for (const parameter of asynchronous.capturedParameters) {
        const parameterError = addUse(
          parameter,
          facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier,
          ["static"],
        );
        if (parameterError !== undefined) {
          return { kind: "rejected", reason: parameterError };
        }
      }
    }
  }
  const visit = (node: Node): string | undefined => {
    if (node !== declaration && (isIndependentCallable(ast, node) || isGenericTypeDeclaration(ast, node))) {
      const nestedId = input.idByDeclaration.get(node);
      if (nestedId !== undefined) {
        dependencies.add(nestedId);
        for (const parameter of input.contractFor(node)?.capturedTypeParameters ?? []) {
          if (parameter.requirements.length === 0) continue;
          const error = addUse(node, { kind: "type-parameter", name: parameter.name }, parameter.requirements);
          if (error !== undefined) return error;
        }
        for (const requirement of input.contractFor(node)?.associatedTypes ?? []) {
          if (!rustTargetTypeParameterNames(requirement.carrier).every(name => declared.has(name))) continue;
          if (!associated.collect(requirement.carrier)) return "A captured associated output has no enclosing generic contract.";
          if (requirement.fieldAccess !== undefined && !associated.requireField(requirement.carrier, requirement.fieldAccess)) {
            return "A captured field operation has no enclosing native field contract.";
          }
          const error = addUse(node, requirement.carrier, requirement.requirements);
          if (error !== undefined) return error;
        }
      }
      return undefined;
    }
    const collectType = (carrier: TargetTypeRef): string | undefined => {
      if (!associated.collect(carrier)) return "A dependent Rust type has no exact family implementation or generic obligation.";
      const sourceType = rustSourceTypeCarrierValue(carrier);
      const definition = sourceType === undefined ? undefined : input.projectTypes.definitionForCarrier(carrier);
      if (definition !== undefined && definition.declaration !== declaration) {
        const dependency = input.idByDeclaration.get(definition.declaration);
        if (dependency !== undefined) {
          dependencies.add(dependency);
          const parameters = definition.genericParameters;
          const arguments_ = sourceType!.genericArguments;
          if (parameters.length !== arguments_.length) return "A source type family use has inconsistent generic class arity.";
          const substitutions = new Map<string, TargetTypeRef>();
          for (const [index, parameter] of parameters.entries()) {
            const argument = arguments_[index];
            if (argument?.kind !== parameter.kind) return "A source type family use lost a class generic parameter kind.";
            if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.targetName, argument.type);
          }
          const contract = input.contractFor(definition.declaration);
          for (const parameter of contract?.typeParameters ?? []) {
            if (parameter.requirements.length === 0) continue;
            const argument = substitutions.get(parameter.name);
            if (argument === undefined) return "A generic class use lost its required type argument.";
            const error = addUse(node, argument, parameter.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of contract?.associatedTypes ?? []) {
            const instantiated = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
            if (!associated.collect(instantiated)) return "A generic class argument does not satisfy its dependent type contract.";
            if (requirement.fieldAccess !== undefined && (instantiated.kind !== "associated-type" ||
              !associated.requireField(instantiated, requirement.fieldAccess))) return "A generic class argument does not satisfy its field access contract.";
            const error = addUse(node, instantiated, requirement.requirements);
            if (error !== undefined) return error;
          }
        }
      }
      for (const child of rustTargetTypeChildren(carrier)) {
        const error = collectType(child);
        if (error !== undefined) return error;
      }
      return undefined;
    };
    const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
    if (carrier !== undefined && !isRustDeclarationPathUse(node, ast, facts)) {
      const error = collectType(carrier);
      if (error !== undefined) return error;
      if (ast.kindName(node) === "KindPropertyDeclaration" && carrier.kind === "associated-type") {
        const fieldError = addUse(node, carrier, ["clone"]);
        if (fieldError !== undefined) return fieldError;
      }
    }
    const indexedField = facts.getFact(node, rustTargetOperationFactKey);
    if (indexedField?.kind === "source-indexed-field" && !associated.requireField(indexedField.resultCarrier,
      indexedField.accessMode === "read-write" ? ["read", "write"] : [indexedField.accessMode])) {
      return "A dependent field operation has no exact read/write trait obligation.";
    }
    const location = facts.getFact(node, rustLocationStorageFactKey);
    const objectView = facts.getFact(node, rustObjectReferenceViewKey);
    if (objectView !== undefined) {
      const error = addUse(node, objectView.sourceCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
      for (const field of objectView.fields) {
        const fieldError = addUse(node, field.source.resultCarrier, ["clone", "static"]);
        if (fieldError !== undefined) return fieldError;
      }
    }
    if (location !== undefined) {
      const error = addUse(node, location.valueCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
    }
    const typedLocation = facts.getFact(node, rustTypedLocationPlanKey);
    if (typedLocation?.operation === "allocate" || typedLocation?.operation === "address-of") {
      const error = addUse(node, typedLocation.pointeeCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
    }
    if (typedLocation?.operation === "bind-pointer" || typedLocation?.operation === "project-pointer" ||
      typedLocation?.operation === "view-pointer") {
      const error = addUse(node, typedLocation.pointeeCarrier, ["static"]);
      if (error !== undefined) return error;
      if (typedLocation.operation === "project-pointer" || typedLocation.operation === "view-pointer") {
        const sourceError = addUse(node, typedLocation.sourcePointeeCarrier, ["static"]);
        if (sourceError !== undefined) return sourceError;
      } else {
        const identity = facts.getRuntimeCarrierFact(typedLocation.identityExpression)?.carrier;
        if (identity !== undefined) {
          const identityError = addUse(node, identity, ["static"]);
          if (identityError !== undefined) return identityError;
        }
      }
      const callbacks = typedLocation.operation === "project-pointer"
        ? [typedLocation.fromSourceExpression, typedLocation.toSourceExpression]
        : [typedLocation.readExpression, typedLocation.writeExpression];
      for (const callback of callbacks) {
        const captures = facts.getFact(callback, rustClosureCaptureFactKey);
        for (const capture of captures?.captures ?? []) {
          const captureError = addUse(capture.reference, capture.carrier, ["static"]);
          if (captureError !== undefined) return captureError;
        }
      }
    }
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if ((operation?.kind === "source-field" || operation?.kind === "source-union-field") &&
      operation.accessMode !== "write") {
      const fields = operation.kind === "source-field" ? [operation]
        : operation.selectedVariantIndexes.map(index => operation.variants[index]?.field);
      if (fields.some(field => field?.storage === "structural-object" && field.valueSemantics.kind === "stored")) {
        const error = addUse(node, operation.resultCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "nullish-assignment") {
      const parent = ast.parent(node);
      if (parent === undefined || ast.kindName(parent) !== KindExpressionStatement) {
        const error = addUse(node, operation.rightCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "iteration" && operation.iterationKind !== "for-in") {
      const iterable = Node_Expression(ast, node);
      const iterableCarrier = iterable === undefined ? undefined : facts.getRuntimeCarrierFact(iterable)?.carrier;
      if (operation.lowering.kind === "js-array" ||
        operation.lowering.kind === "borrowed" && operation.lowering.style === "cloned" ||
        operation.lowering.kind === "receiver-method" && rustJsArrayEntriesElementTargetType(iterableCarrier) !== undefined) {
        const error = addUse(node, operation.elementCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    for (const operand of facts.getFact(node, rustGenericNumericOperandsKey) ?? []) {
      const error = addUse(node, operand, ["source-numeric"]);
      if (error !== undefined) return error;
    }
    if (ast.kindName(node) === KindBinaryExpression) {
      const parent = ast.parent(node);
      const assignment = operation?.kind === "runtime-set" ||
        (operation?.kind === "operator-token" || operation?.kind === "operator-call") &&
        isRustAssignmentOperator(operation.operator);
      if (assignment &&
          (parent === undefined || ast.kindName(parent) !== KindExpressionStatement)) {
        const carrier = rustValueCarrierBeforeOptionProjection(facts, node);
        if (carrier !== undefined) {
          const error = addUse(node, carrier, ["clone"]);
          if (error !== undefined) return error;
        }
      }
    }
    const projection = facts.getFact(node, rustFlowReadProjectionFactKey);
    if (projection?.kind === "option-value" || projection?.kind === "source-union") {
      const error = addUse(node, projection.selectedCarrier, ["clone"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "provider-operation") {
      for (const argument of operation.abi.sourceArguments) {
        if (argument.disposition !== "runtime" || argument.mode !== "value" ||
          argument.form !== "value" || isRustCopyCarrier(argument.carrier)) continue;
        const expression = ast.arguments(node)[argument.sourceIndex];
        if (expression === undefined || !ast.is.IsIdentifier(expression) ||
          input.valueLifetimes.canMove(expression)) continue;
        const error = addUse(expression, argument.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
      for (const requirement of operation.carrierRequirements ?? []) {
        const error = addUse(node, requirement.carrier, [requirement.requirement]);
        if (error !== undefined) return error;
      }
    }
    if (ast.kindName(node) === "KindAwaitExpression") {
      const operand = Node_Expression(ast, node);
      const operandCarrier = operand === undefined
        ? undefined
        : facts.getRuntimeCarrierFact(operand)?.carrier;
      const future = operand === undefined
        ? undefined
        : facts.getFact(operand, rustFutureValueFactKey);
      if (operandCarrier?.kind === "target-named" &&
        operandCarrier.id === rustJsPromiseTargetId && future !== undefined) {
        const error = addUse(node, future.outputCarrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "default-value") {
      const error = addUse(node, operation.resultCarrier, ["default"]);
      if (error !== undefined) return error;
    }
    if (operation?.kind === "closure") {
      const captures = facts.getFact(node, rustClosureCaptureFactKey);
      if (captures === undefined) {
        return "A Rust closure has no exact capture classification.";
      }
      const required: readonly RustGenericRequirement[] =
        rustClosureProtocol(operation.resultCarrier) === undefined
          ? ["clone", "static"]
          : ["clone"];
      for (const capture of captures.captures) {
        const error = addUse(capture.reference, capture.carrier,
          input.valueLifetimes.canMoveCapture(node, capture.declaration)
            ? required.filter(requirement => requirement !== "clone") : required);
        if (error !== undefined) return error;
      }
    }
    const yieldFact = facts.getFact(node, rustYieldFactKey);
    if (yieldFact?.kind === "delegate") {
      const delegated = getRustGeneratorProtocol(yieldFact.delegatedCarrier);
      if (delegated === undefined) {
        return "A delegated Rust generator yield has no exact generator protocol.";
      }
      const nextError = addUse(node, delegated.nextType, ["default"]);
      if (nextError !== undefined) return nextError;
      const returnError = addUse(node, delegated.returnType, ["clone"]);
      if (returnError !== undefined) return returnError;
    }
    if (operation?.kind === "source-call") {
      const selected = facts.getSelectedTargetCall(node);
      if (selected?.sourceDeclaration !== undefined) {
        const selectedDeclaration = input.implementationDeclaration(
          selected.sourceDeclaration,
        );
        const calleeId = input.idByDeclaration.get(selectedDeclaration);
        const targetTypeArguments = rustTargetGenericTypeArguments(
          operation.targetGenericArguments,
        );
        if (calleeId !== undefined) {
          dependencies.add(calleeId);
          const callee = input.contractFor(selectedDeclaration);
          if (callee !== undefined && callee.typeParameters.length > 0) {
            if (callee.typeParameters.length !== targetTypeArguments.length) {
              return "A selected Rust source call has inconsistent generic contract arity.";
            }
            for (let index = 0; index < callee.typeParameters.length; index += 1) {
              const requirements = callee.typeParameters[index]!.requirements;
              if (requirements.length === 0) continue;
              const error = addUse(node, targetTypeArguments[index], requirements);
              if (error !== undefined) return error;
            }
            const substitutions = new Map(callee.typeParameters.map((parameter, index) =>
              [parameter.name, targetTypeArguments[index]!] as const));
            for (const requirement of callee.associatedTypes) {
              const carrier = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
              const collected = collectType(carrier);
              if (collected !== undefined) return collected;
              if (requirement.fieldAccess !== undefined && (carrier.kind !== "associated-type" ||
                !associated.requireField(carrier, requirement.fieldAccess))) return "A generic call does not satisfy its selected field access contract.";
              const error = addUse(node, carrier, requirement.requirements);
              if (error !== undefined) return error;
            }
          }
        }
      }
    }
    let childError: string | undefined;
    ast.forEachChild(node, (child) => {
      if (child !== undefined && childError === undefined) {
        childError = visit(child);
      }
    });
    return childError;
  };
  const error = visit(declaration);
  if (error !== undefined) {
    return { kind: "rejected", reason: error };
  }
  return {
    kind: "resolved",
    dependencies: Object.freeze([...dependencies]),
    contract: Object.freeze({
      declaration,
      associatedTypes: associated.seal(),
      typeParameters: Object.freeze(exactNames.map((name) => Object.freeze({
        name,
        requirements: normalizeRequirements([...(byParameter.get(name) ?? [])]),
      }))),
      capturedTypeParameters: Object.freeze(capturedNames.map((name) => Object.freeze({
        name,
        requirements: normalizeRequirements([...(byParameter.get(name) ?? [])]),
      }))),
      uses: Object.freeze(uses),
    }),
  };
}

function collectCallableDeclarations(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): readonly Node[] {
  const result: Node[] = [];
  const visit = (node: Node): void => {
    if (isIndependentCallable(ast, node) || isGenericTypeDeclaration(ast, node)) {
      result.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  return Object.freeze(result);
}

function isGenericTypeDeclaration(ast: AstReader, node: Node): boolean {
  const kind = ast.kindName(node);
  return kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration" || kind === "KindTypeAliasDeclaration";
}

function isIndependentCallable(ast: AstReader, node: Node): boolean {
  const kind = ast.kindName(node);
  return kind === "KindFunctionDeclaration" ||
    kind === "KindFunctionExpression" ||
    kind === "KindArrowFunction" ||
    kind === "KindMethodDeclaration" ||
    kind === "KindConstructor" ||
    kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}


function normalizeRequirements(
  requirements: readonly RustGenericRequirement[],
): readonly RustGenericRequirement[] {
  const selected = new Set(requirements);
  return Object.freeze(requirementOrder.filter((requirement) =>
    selected.has(requirement)));
}

function rustRequirementDescription(
  requirements: readonly RustGenericRequirement[],
): string {
  const descriptions = requirements.map((requirement) =>
    requirement === "clone"
      ? "an exact Rust Clone implementation"
      : requirement === "default"
        ? "an exact Rust Default implementation"
        : requirement === "source-numeric" ? "an exact source numeric comparison contract"
        : "an exact Rust 'static lifetime");
  if (descriptions.length <= 1) return descriptions[0] ?? "an exact Rust carrier contract";
  return `${descriptions.slice(0, -1).join(", ")} and ${descriptions[descriptions.length - 1]}`;
}

function requirementContractsEqual(
  left: RequirementContractState,
  right: RequirementContractState,
): boolean {
  return left.declaration === right.declaration &&
    left.associatedTypes.length === right.associatedTypes.length &&
    left.associatedTypes.every((requirement, index) => {
      const other = right.associatedTypes[index];
      return other !== undefined && rustTargetTypeRefEquals(requirement.carrier, other.carrier) &&
        stringListsEqual(requirement.fieldAccess ?? [], other.fieldAccess ?? []) &&
        stringListsEqual(requirement.requirements, other.requirements);
    }) &&
    left.capturedTypeParameters.length === right.capturedTypeParameters.length &&
    left.capturedTypeParameters.every((parameter, index) => {
      const other = right.capturedTypeParameters[index];
      return other !== undefined && parameter.name === other.name &&
        stringListsEqual(parameter.requirements, other.requirements);
    }) &&
    left.typeParameters.length === right.typeParameters.length &&
    left.typeParameters.every((parameter, index) => {
      const other = right.typeParameters[index];
      return other !== undefined && parameter.name === other.name &&
        stringListsEqual(parameter.requirements, other.requirements);
    }) &&
    left.uses.length === right.uses.length &&
    left.uses.every((use, index) => {
      const other = right.uses[index];
      return other !== undefined && use.node === other.node &&
        rustTargetTypeRefEquals(use.carrier, other.carrier) &&
        stringListsEqual(use.requirements, other.requirements);
    });
}

function stringListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    entry === right[index]);
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
import { rustObjectReferenceViewKey } from "../facts/object-reference-views.js";
