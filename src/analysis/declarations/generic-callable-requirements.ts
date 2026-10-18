import { stringListsEqual, requirementUseHasValidStorage, type RequirementUse, type RequirementContractState } from "./generic-requirement-contract.js";
import { substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustStaticLifetime } from "../../target-model/lifetimes/index.js";

import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustCallableInputProtocol, rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/names/type-parameters.js";
import type { Node } from "@tsonic/tsts";

import { classifyCarrierRequirements, type RustCarrierRequirementSelection } from "./generic-carrier-requirements.js";
import { normalizeRustErrorType, type RustErrorTypeContext } from "../errors/error-types.js";
import { createRustOptionalStorageCollector } from "./type-projections.js";
import { isRustBorrowedValueRead, isRustDeclarationPathUse, isRustReturnedValue, isRustIndependentCallable, isRustGenericTypeDeclaration } from "./generic-reference-uses.js";
import { createRustAssociatedRequirementCollector } from "./associated-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { mapRustTargetTypes, substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/model/type-family-normalization.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import { createRustProjectProjectionRequirementCollector } from "./project-projection-requirements.js";
import { rustReadTransferRequirement } from "../ownership/flow.js";
import { rustCaptureReadFormation, type RustReadOwnershipRequirements } from "../ownership/reads.js";
import { sourceParameterIsProperty } from "@tsonic/target-api/source";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  getRustGeneratorProtocol,
  rustClosureProtocol,
  rustSourceTypeCarrierValue,
  rustNamedTypeCarrierValue,
  rustTargetGenericTypeArguments,
  rustCarrierSatisfiesTraitRef,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustAwaitValueRequirements } from "../callables/await-values.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { collectRustCallableInvocationRequirements,
  type RustCallableInvocationRequirementContext } from "./generic-callable-invocation-requirements.js";

import type { RustGenericRequirement } from "../../target-model/lifetimes/model.js";
import { normalizeRustGenericRequirements } from "./generic-requirement-contract.js";
import type { RustClassValuePlan } from "../objects/class-values.js";
import { rustNativeCallableErrorChannel } from "../callables/native-protocols.js";
import type { RustProjectStructuralView } from "../objects/project-structural-views.js";
import { rustProjectViewBindings } from "../objects/view-implementations.js";
import { rustStructuralViewRequirementUses } from "./structural-view-requirements.js";
import type { RustAnalyzedErrorRegions } from "../errors/regions.js";

import { rustCallableParameterCloneSources } from "../callables/adapter-requirements.js";
import { createRustCloneRequirementCollector } from "./generic-clone-requirements.js";

interface ClassifyCallableInput extends RustCallableInvocationRequirementContext {
  readonly readRequirements: RustReadOwnershipRequirements;
  readonly isStoredValue: (node: Node) => boolean;
  readonly readsValue: (node: Node) => boolean;
  readonly names: RustNamePlan;
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly classValues: RustClassValuePlan;
  readonly structuralViewsFor: (declaration: Node) => readonly RustProjectStructuralView[];
  readonly promiseObjectFacet?: true;
  readonly nativePromiseBody: boolean;
  readonly inheritedBody?: RequirementContractState;
  readonly errorRegions: RustAnalyzedErrorRegions;
  readonly errorTypes: RustErrorTypeContext;
}

export function classifyRustCallableRequirements(input: ClassifyCallableInput):
  | {
      readonly kind: "resolved";
      readonly contract: RequirementContractState;
      readonly dependencies: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: string; readonly promiseStorage?: true } {
  const { ast, declaration, records } = input;
  const definition = input.projectTypes.definitionForDeclaration(declaration);
  const typeParameterNodes = (definition === undefined ? ast.is.IsSourceFile(declaration) ? [] : ast.typeParameters(declaration)
    : definition.genericParameters.map(parameter => parameter.declaration)).filter(
    (candidate): candidate is Node => candidate !== undefined &&
      input.sourceLifetimes.parameterFor(candidate)?.kind !== "lifetime",
  );
  const typeParameters = typeParameterNodes.map(parameter => input.sourceLifetimes.parameterFor(parameter));
  if (typeParameters.some(parameter => parameter?.kind !== "type")) {
    return {
      kind: "rejected",
      reason: "A Rust callable type parameter has no exact target identity.",
    };
  }
  const ownParameters = typeParameters.flatMap(parameter => parameter?.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const exactNames = ownParameters.map(parameter => parameter.identity);
  const capturedParameters = new Map<string, Extract<TargetTypeRef, { readonly kind: "type-parameter" }>>();
  for (let ancestor = ast.parent(declaration); ancestor !== undefined; ancestor = ast.parent(ancestor)) {
    if (!isRustIndependentCallable(ast, ancestor) && !isRustGenericTypeDeclaration(ast, ancestor)) continue;
    for (const parameter of ast.typeParameters(ancestor)) {
      if (parameter === undefined || input.sourceLifetimes.parameterFor(parameter)?.kind === "lifetime") continue;
      const selected = input.sourceLifetimes.parameterFor(parameter);
      if (selected?.kind !== "type") return { kind: "rejected", reason: "A captured Rust type parameter has no exact target identity." };
      if (!exactNames.includes(selected.identity)) capturedParameters.set(selected.identity, rustTypeParameterFromSourceContract(selected));
    }
  }
  const nativeBindings = [...input.nativeCallables.inputsFor(declaration), ...input.nativeCallables.capturesFor(declaration)];
  const nativeInputs = new Map(nativeBindings
    .map(selected => [selected.implementation.identity, selected.implementation]));
  const declared = new Set([...exactNames, ...capturedParameters.keys(), ...nativeInputs.keys()]);
  const projections = createRustProjectProjectionRequirementCollector(declared, input.projectTypes);
  const byParameter = new Map([...declared].map((name) =>
    [name, new Set<RustGenericRequirement>()] as const));
  const optionalStorage = createRustOptionalStorageCollector(new Set(exactNames), declared, byParameter);
  const normalizeFamily = rustTypeFamilyNormalizer(input.typeFamilies);
  if (definition !== undefined) {
    const dispatchLifetime = input.objectRepresentations.representationFor(definition)?.dispatchObjectLifetime;
    for (const name of exactNames) {
      if (dispatchLifetime?.kind === "static") byParameter.get(name)!.add("static");
    }
  }
  const uses: RequirementUse[] = [...input.inheritedBody?.uses ?? []];
  const dependencies = new Set<string>();
  const staticEvidence = { lifetimeContract: input.sourceLifetimes.contractFor(declaration),
    genericCallables: input.genericCallables, structuralShapes: input.structuralShapes,
    frameCallables: input.frameCallables, classValues: input.classValues,
    objectRepresentations: input.objectRepresentations, projectTypes: input.projectTypes, records };
  const classifyUse = (node: Node, carrier: TargetTypeRef,
    requirements: readonly RustGenericRequirement[]): RustCarrierRequirementSelection => {
    const normalized = mapRustTargetTypes(carrier, normalizeFamily);
    const physical = requirements.includes("static")
      ? normalizeRustErrorType(normalized, input.errorTypes, node) : normalized;
    return physical === undefined ? { kind: "unresolved",
      reason: "A native static requirement has no exact admitted physical error-boundary carrier." }
      : classifyCarrierRequirements(physical, requirements, declared, byParameter, associated.require,
        input.typeDefinitions, staticEvidence);
  };
  const associated = createRustAssociatedRequirementCollector(declared, input.typeFamilies,
    (carrier, requirements) => classifyUse(declaration, carrier, requirements).kind === "supported",
    carrier => nativeBindings.some(binding => rustNativeCallableErrorChannel(binding, binding.implementation, carrier) !== undefined));
  for (const parameter of [...input.inheritedBody?.typeParameters ?? [], ...input.inheritedBody?.capturedTypeParameters ?? [],
    ...input.inheritedBody?.nativeInputs ?? []])
    for (const requirement of parameter.requirements) byParameter.get(parameter.identity)?.add(requirement);
  for (const projection of input.inheritedBody?.optionalStorage ?? []) {
    if (!optionalStorage.collect(projection.carrier)) return { kind: "rejected", reason: "A Promise object lost its native body's exact optional-storage contract." };
    for (const requirement of projection.requirements) byParameter.get(projection.carrier.identity)?.add(requirement);
  }
  for (const requirement of input.inheritedBody?.associatedTypes ?? []) {
    if (!associated.require(requirement.carrier) || requirement.requirements.some(value => !associated.require(requirement.carrier, value)) ||
      requirement.fieldAccess !== undefined && !associated.requireField(requirement.carrier, requirement.fieldAccess, requirement.output))
      return { kind: "rejected", reason: "A Promise object lost its native body's exact associated-type contract." };
  }
  const addUse = (
    node: Node,
    carrier: TargetTypeRef | undefined,
    requirements: readonly RustGenericRequirement[],
    nativeStorage = false,
  ): string | undefined => {
    if (carrier === undefined) {
      return "A Rust generic requirement has no exact target carrier.";
    }
    if (!optionalStorage.collect(mapRustTargetTypes(carrier, normalizeFamily))) return "A native optional storage projection has no exact generic owner.";
    const normalized = normalizeRustGenericRequirements(requirements);
    const requiredCarrier = nativeStorage && normalized.includes("static")
      ? substituteElidedLifetime(carrier, rustStaticLifetime) : carrier;
    const classified = classifyUse(node, requiredCarrier, normalized);
    if (classified.kind === "unresolved") return classified.reason;
    if (classified.kind === "unsatisfied") {
      return `A generated Rust operation requires ${rustRequirementDescription(normalized)} that its exact target carrier does not provide.`;
    }
    if (!uses.some((use) => use.node === node &&
      rustTargetTypeRefEquals(use.carrier, carrier) &&
      stringListsEqual(use.requirements, normalized))) {
      const use = Object.freeze({ node, carrier, requirements: normalized,
        ...(rustTargetTypeRefEquals(carrier, requiredCarrier) ? {} : { nativeStorageCarrier: requiredCarrier }),
      });
      if (!requirementUseHasValidStorage(use)) return "A native storage requirement lost its exact physical carrier correspondence.";
      uses.push(use);
    }
    return undefined;
  };
  const cloneRequirements = createRustCloneRequirementCollector(input, addUse);
  for (const adapter of input.promiseObjectFacet === true ? [] : records.projectCallableAdapters.get(declaration) ?? []) {
    for (const carrier of rustCallableParameterCloneSources(adapter.parameterAdapters)) {
      const error = addUse(declaration, carrier, ["clone"]);
      if (error !== undefined) return { kind: "rejected", reason: error };
    }
  }
  const generator = input.promiseObjectFacet === true ? undefined : records.generator.get(declaration);
  if (generator !== undefined) {
    if (generator.storage.kind === "static" && generator.ownedReceiver !== undefined) {
      const receiverError = addUse(declaration, generator.ownedReceiver.carrier, ["static"]);
      if (receiverError !== undefined) return { kind: "rejected", reason: receiverError };
    }
    if (generator.storage.kind !== "lifetime") {
      for (const parameter of generator.capturedParameters) {
        const error = addUse(
          parameter,
          records.sourceParameterAbi.get(parameter)?.parameterCarrier,
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
  const asynchronous = records.asyncFunction.get(declaration);
  const rejection = input.errorRegions.get(declaration)?.jsRejection;
  const objectOperation = !input.nativePromiseBody || input.promiseObjectFacet === true;
  for (const carrier of objectOperation ? rejection?.requiredCarriers ?? [] : []) {
    const error = addUse(declaration, carrier, ["js-rejection"]);
    if (error !== undefined) return { kind: "rejected", reason: error };
  }
  if (asynchronous?.kind === "js-promise" && objectOperation) {
    if (rejection === undefined) return { kind: "rejected", reason: "A JS Promise body has no selected rejection region." };
    const lowering = asynchronous.lowering;
    const error = addUse(
      declaration,
      asynchronous.outputCarrier,
      lowering.kind === "factory" ? ["clone", "static"] : ["clone"],
    );
    if (error !== undefined) {
      return { kind: "rejected", reason: error };
    }
    if (lowering.kind === "factory") {
      if (lowering.storage.kind === "receiver") return { kind: "rejected", promiseStorage: true,
        reason: "An owned Promise cannot retain an unowned method receiver." };
      if (lowering.ownedReceiver !== undefined) {
        const receiverError = addUse(declaration, lowering.ownedReceiver.carrier, ["static"]);
        if (receiverError !== undefined) return { kind: "rejected", promiseStorage: true, reason: receiverError };
      }
      for (const carrier of lowering.capturedCarriers) {
        const captureError = addUse(declaration, carrier, ["static"]);
        if (captureError !== undefined) return { kind: "rejected", promiseStorage: true, reason: captureError };
      }
      for (const parameter of lowering.capturedParameters) {
        const physical = input.nativeCallables.inputsFor(declaration).some(value => value.subject.node === parameter)
          ? input.nativeStorage.parameterFor(parameter) : undefined;
        const parameterError = addUse(
          parameter,
          physical?.kind === "unresolved" ? undefined : physical?.carrier ?? records.sourceParameterAbi.get(parameter)?.parameterCarrier,
          ["static"],
        );
        if (parameterError !== undefined) {
          return { kind: "rejected", promiseStorage: true, reason: parameterError };
        }
      }
    }
  }
  const visit = (node: Node): string | undefined => {
    if (rustReadTransferRequirement(input.ownershipFlow, node) === "unavailable")
      return "A native read transfer requires its original physical capture formation before generic requirements can be selected.";
    if (node !== declaration && (isRustIndependentCallable(ast, node) || isRustGenericTypeDeclaration(ast, node))) {
      if (ast.is.IsSourceFile(declaration)) return undefined;
      const nestedId = input.idByDeclaration.get(node);
      if (nestedId !== undefined) {
        dependencies.add(nestedId);
        for (const parameter of input.contractFor(node)?.capturedTypeParameters ?? []) {
          if (parameter.requirements.length === 0) continue;
          const error = addUse(node, { kind: "type-parameter", identity: parameter.identity, name: parameter.name }, parameter.requirements);
          if (error !== undefined) return error;
        }
        for (const parameter of input.contractFor(node)?.nativeInputs ?? []) {
          if (parameter.requirements.length === 0) continue;
          const error = addUse(node, { kind: "type-parameter", identity: parameter.identity, name: parameter.name }, parameter.requirements);
          if (error !== undefined) return error;
        }
        const nestedClass = input.projectTypes.definitionForDeclaration(node);
        for (const parameter of nestedClass?.genericParameters ?? []) {
          if (parameter.kind !== "type" || ast.parent(parameter.declaration) === node) continue;
          const requirements = input.contractFor(node)?.typeParameters.find(candidate => candidate.identity === parameter.identity)?.requirements ?? [];
          const error = addUse(node, { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName }, requirements);
          if (error !== undefined) return error;
        }
        for (const requirement of input.contractFor(node)?.associatedTypes ?? []) {
          if (!rustTargetTypeParameterIdentities(requirement.carrier).every(name => declared.has(name))) continue;
          if (!associated.collect(requirement.carrier)) return "A captured associated output has no enclosing generic contract.";
          if (requirement.fieldAccess !== undefined && !associated.requireField(requirement.carrier, requirement.fieldAccess, requirement.output)) {
            return "A captured field operation has no enclosing native field contract.";
          }
          const error = addUse(node, requirement.carrier, requirement.requirements);
          if (error !== undefined) return error;
        }
        for (const requirement of input.contractFor(node)?.projectProjections ?? []) {
          if (![requirement.sourceCarrier, requirement.targetCarrier].flatMap(rustTargetTypeParameterIdentities).every(name => declared.has(name))) continue;
          if (!projections.require(requirement)) return "A captured projection has no exact enclosing native conversion contract.";
        }
        for (const requirement of input.contractFor(node)?.optionalStorage ?? []) {
          if (!rustTargetTypeParameterIdentities(requirement.carrier).every(name => declared.has(name))) continue;
          const error = addUse(node, requirement.carrier, requirement.requirements);
          if (error !== undefined) return error;
        }
      }
      return undefined;
    }
    const collectType = (carrier: TargetTypeRef): string | undefined => {
      carrier = mapRustTargetTypes(carrier, normalizeFamily);
      if (!optionalStorage.collect(carrier)) return "A native optional storage projection has no exact generic owner.";
      if (!associated.collect(carrier)) return "A dependent Rust type has no exact family implementation or generic obligation.";
      const native = rustNamedTypeCarrierValue(carrier);
      if (native !== undefined) {
        const arguments_ = rustTargetGenericTypeArguments(native.genericArguments);
        for (const requirement of native.typeRequirements) {
          const argument = arguments_[requirement.typeArgumentIndex];
          if (argument === undefined) return "A native type requirement has no exact semantic type argument.";
          const trait = requirement.trait;
          if (trait.genericArguments.length === 0 && trait.associatedConstraints.length === 0 && trait.lifetimeBinder === undefined &&
            (trait.path === "core::clone::Clone" || trait.path === "core::default::Default")) {
            const error = addUse(node, argument, [trait.path === "core::clone::Clone" ? "clone" : "default"]);
            if (error !== undefined) return error;
          } else if (!rustCarrierSatisfiesTraitRef(argument, trait, undefined, input.typeDefinitions)) {
            return "A native type argument does not provide its exact declared well-formedness trait contract.";
          }
        }
      }
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
            if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
          }
          const contract = input.contractFor(definition.declaration);
          for (const requirement of contract?.projectProjections ?? []) {
            if (!projections.require({
              sourceCarrier: substituteRustTargetTypeParameters(requirement.sourceCarrier, substitutions),
              targetCarrier: substituteRustTargetTypeParameters(requirement.targetCarrier, substitutions),
            })) return "A generic class argument does not satisfy its exact native projection contract.";
          }
          for (const parameter of contract?.typeParameters ?? []) {
            if (parameter.requirements.length === 0) continue;
            const argument = substitutions.get(parameter.identity);
            if (argument === undefined) return "A generic class use lost its required type argument.";
            const error = addUse(node, argument, parameter.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of contract?.associatedTypes ?? []) {
            const instantiated = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
            if (!associated.collect(instantiated)) return "A generic class argument does not satisfy its dependent type contract.";
            if (requirement.fieldAccess !== undefined && (instantiated.kind !== "associated-type" ||
              !associated.requireField(instantiated, requirement.fieldAccess, requirement.output === undefined ? undefined :
                substituteRustTargetTypeParameters(requirement.output, substitutions)))) return "A generic class argument does not satisfy its field access contract.";
            const error = addUse(node, instantiated, requirement.requirements);
            if (error !== undefined) return error;
          }
          for (const requirement of contract?.optionalStorage ?? []) {
            const instantiated = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
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
    if (node === declaration && definition !== undefined) {
      for (const inherited of input.projectTypes.directSupertypes(input.projectTypes.openCarrier(definition)) ?? []) {
        const inheritedError = collectType(inherited);
        if (inheritedError !== undefined) return inheritedError;
      }
      for (const view of input.structuralViewsFor(declaration)) {
        const viewError = collectType(view.targetCarrier);
        if (viewError !== undefined) return viewError;
      }
    }
    const carrier = records.runtimeCarrier.get(node)?.carrier;
    const bindingError = cloneRequirements.binding(node, carrier);
    if (bindingError !== undefined) return bindingError;
    const bindingProjection = records.bindingProjection.get(node);
    for (const signatureCarrier of [
      records.sourceCallableReturn.get(node)?.returnCarrier,
      records.sourceParameterAbi.get(node)?.parameterCarrier,
      bindingProjection !== undefined && "storageCarrier" in bindingProjection ? bindingProjection.storageCarrier : undefined,
    ]) {
      if (signatureCarrier === undefined) continue;
      const error = collectType(signatureCarrier);
      if (error !== undefined) return error;
    }
    if (carrier !== undefined && ast.is.IsIdentifier(node) &&
      rustReadTransferRequirement(input.ownershipFlow, node) !== "transfer" &&
      (isRustReturnedValue(node, declaration, ast) || input.isStoredValue(node))) {
      const error = addUse(node, carrier, ["clone"]);
      if (error !== undefined) return error;
    }
    const sourceCall = records.targetOperation.get(node);
    const resultProjection = sourceCall?.kind === "source-call" ? sourceCall.resultProjection : undefined;
    if (resultProjection?.kind === "project-downcast" && !projections.require({
      sourceCarrier: resultProjection.dispatchCarrier, targetCarrier: resultProjection.selectedCarrier,
    })) return "A selected call result has no closed native projection or generic obligation.";
    const downcast = records.projectDowncast.get(node);
    const flowProjection = records.flowReadProjection.get(node);
    const unionProject = flowProjection?.kind === "source-union" || flowProjection?.kind === "runtime-union"
      ? flowProjection.project : undefined;
    const projectProjection = downcast === undefined ? flowProjection?.kind === "project-downcast"
      ? { sourceCarrier: flowProjection.dispatchCarrier, targetCarrier: flowProjection.selectedCarrier } : unionProject
      : { sourceCarrier: downcast.dispatchCarrier, targetCarrier: downcast.targetCarrier };
    if (projectProjection !== undefined) {
      if (!projections.require(projectProjection)) return "A checked project projection has no closed native conversion or generic obligation.";
      if (flowProjection?.kind === "project-downcast" && flowProjection.projection?.kind === "structural") {
        const error = addUse(node, projectProjection.targetCarrier, ["static"]);
        if (error !== undefined) return error;
      }
      for (const projectionCarrier of [projectProjection.sourceCarrier, projectProjection.targetCarrier]) {
        const error = collectType(projectionCarrier);
        if (error !== undefined) return error;
      }
    }
    if (carrier !== undefined && input.readsValue(node) && !isRustDeclarationPathUse(node, ast, records)) {
      const error = collectType(carrier);
      if (error !== undefined) return error;
      const propertyDeclaration = ast.kindName(node) === "KindPropertyDeclaration" || sourceParameterIsProperty(ast, node);
      const owner = propertyDeclaration ? input.projectTypes.definitionContainingDeclaration(node) : undefined;
      const ownedDispatchRead = owner !== undefined && input.projectTypes.isPolymorphic(owner) &&
        input.objectRepresentations.aliasFor(node) === undefined;
      if (propertyDeclaration && (ownedDispatchRead || carrier.kind === "associated-type" ||
        carrier.kind === "type-parameter" && carrier.optionalStorageValue !== undefined)) {
        const fieldError = addUse(node, carrier, ["clone"]);
        if (fieldError !== undefined) return fieldError;
      }
    }
    const indexedField = records.targetOperation.get(node);
    if (indexedField?.kind === "source-field" && indexedField.valueSemantics.kind === "stored" &&
      input.readsValue(node) && rustReadTransferRequirement(input.ownershipFlow, node) !== "transfer" &&
      !isRustBorrowedValueRead(node, ast, records)) {
      const fieldError = addUse(node, indexedField.resultCarrier, ["clone"]);
      if (fieldError !== undefined) return fieldError;
    }
    if (indexedField?.kind === "source-indexed-field" && !associated.requireField(indexedField.projection,
      indexedField.accessMode === "read-write" ? ["read", "write"] : [indexedField.accessMode], indexedField.resultCarrier)) {
      return "A dependent field operation has no exact read/write trait obligation.";
    }
    const location = records.bindingStorage.get(node);
    const frameBinding = input.frameCallables.bindingFor(node);
    if (frameBinding?.storage === "location") {
      const error = addUse(node, frameBinding.carrier, ["clone", "static"], true);
      if (error !== undefined) return error;
    }
    const objectView = records.objectReferenceView.get(node);
    if (objectView !== undefined) {
      const error = addUse(node, objectView.sourceCarrier, ["clone", "static"]);
      if (error !== undefined) return error;
      for (const field of objectView.kind === "structural" ? objectView.fields : []) {
        const fieldError = addUse(node, field.source.resultCarrier, ["clone", "static"]);
        if (fieldError !== undefined) return fieldError;
      }
      if (objectView.kind === "project") {
        for (const view of input.structuralViewsFor(objectView.declaration)) {
          const bindings = rustProjectViewBindings(view, objectView.sourceCarrier, objectView.targetCarrier);
          if (bindings === undefined) continue;
          for (const use of rustStructuralViewRequirementUses(view, bindings)) {
            const fieldError = addUse(node, use.carrier, use.requirements);
            if (fieldError !== undefined) return fieldError;
          }
          break;
        }
      }
    }
    if (location?.storage === "location") {
      const error = addUse(node, location.valueCarrier, ["clone", "static"], true);
      if (error !== undefined) return error;
    }
    const typedLocation = records.typedLocationPlan.get(node);
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
        const identity = records.runtimeCarrier.get(typedLocation.identityExpression)?.carrier;
        if (identity !== undefined) {
          const identityError = addUse(node, identity, ["static"]);
          if (identityError !== undefined) return identityError;
        }
      }
      const callbacks = typedLocation.operation === "project-pointer"
        ? [typedLocation.fromSourceExpression, typedLocation.toSourceExpression]
        : [typedLocation.readExpression, typedLocation.writeExpression];
      for (const callback of callbacks) {
        const captures = records.closureCapture.get(callback);
        for (const capture of captures?.captures ?? []) {
          const captureError = addUse(capture.reference, capture.carrier, ["static"]);
          if (captureError !== undefined) return captureError;
        }
      }
    }
    const operation = records.targetOperation.get(node);
    const operationError = cloneRequirements.operation(node, operation);
    if (operationError !== undefined) return operationError;
    for (const operand of records.genericNumericOperands.get(node) ?? []) {
      const error = addUse(node, operand, ["source-numeric"]);
      if (error !== undefined) return error;
    }
    const readError = cloneRequirements.read(node, operation);
    if (readError !== undefined) return readError;
    if (ast.kindName(node) === "KindAwaitExpression") {
      const awaiting = records.awaitValue.get(node);
      if (awaiting !== undefined) {
        for (const leaf of rustAwaitSelectionLeaves(awaiting.selection)) {
          const requirements = rustAwaitValueRequirements(leaf);
          if (leaf.future === undefined || requirements.length === 0) continue;
          const error = addUse(node, leaf.future.outputCarrier, requirements);
          if (error !== undefined) return error;
        }
      }
    }
    if (operation?.kind === "default-value") {
      const error = addUse(node, operation.resultCarrier, ["default"]);
      if (error !== undefined) return error;
    }
    const sourceValue = records.sourceCallableValue.get(node);
    if (sourceValue !== undefined) {
      const captures = records.closureCapture.get(sourceValue.sourceDeclaration);
      const storage: readonly RustGenericRequirement[] = rustCallableProtocol(sourceValue.carrier)?.lifetime?.kind === "static"
        ? ["static"] : [];
      for (const capture of captures?.receivers ?? []) {
        const error = addUse(capture.reference, capture.carrier, ["clone", ...storage], true);
        if (error !== undefined) return error;
      }
      for (const capture of captures?.captures ?? []) {
        const requirement = input.ownershipFlow.captureRequirements.get(sourceValue.sourceDeclaration)?.find(value =>
          value.capture.declaration === capture.declaration);
        if (requirement === undefined) return "A source callable capture requires its exact physical formation requirement.";
        const formation = rustCaptureReadFormation(requirement, input.ownershipFlow.captureTransfers);
        const error = addUse(capture.reference, requirement.carrier,
          [...(formation.requiresClone ? ["clone" as const] : []), ...storage], true);
        if (error !== undefined) return error;
      }
    }
    if (operation?.kind === "closure") {
      const captures = records.closureCapture.get(node);
      if (captures === undefined) {
        return "A Rust closure has no exact capture classification.";
      }
      const required: readonly RustGenericRequirement[] =
        rustClosureProtocol(operation.resultCarrier) === undefined && rustGenericCallableValue(operation.resultCarrier) === undefined &&
          rustFrameCallableValue(operation.resultCarrier) === undefined
          && rustCallableInputProtocol(operation.resultCarrier) === undefined &&
          rustCallableProtocol(operation.resultCarrier)?.lifetime?.kind === "static"
          ? ["clone", "static"]
          : ["clone"];
      for (const capture of captures.receivers) {
        const error = addUse(capture.reference, capture.carrier, required, true);
        if (error !== undefined) return error;
      }
      for (const capture of captures.receiverFields) {
        const error = addUse(capture.reference, capture.carrier, required.filter(requirement => requirement !== "clone"), true);
        if (error !== undefined) return error;
      }
      for (const capture of captures.captures) {
        const requirement = input.ownershipFlow.captureRequirements.get(node)?.find(value =>
          value.capture.declaration === capture.declaration);
        if (requirement === undefined) return "A native closure capture requires its exact physical formation requirement.";
        const formation = rustCaptureReadFormation(requirement, input.ownershipFlow.captureTransfers);
        const error = addUse(capture.reference, requirement.carrier,
          formation.requiresClone ? required : required.filter(value => value !== "clone"), true);
        if (error !== undefined) return error;
      }
    }
    if (ast.kindName(node) === "KindClassDeclaration" || ast.kindName(node) === "KindClassExpression") {
      for (const capture of records.closureCapture.get(node)?.captures ?? []) {
        const requirement = input.ownershipFlow.captureRequirements.get(node)?.find(value =>
          value.capture.declaration === capture.declaration);
        if (requirement === undefined) return "A native class capture requires its exact physical formation requirement.";
        if (!rustCaptureReadFormation(requirement, input.ownershipFlow.captureTransfers).requiresClone) continue;
        const error = addUse(node, requirement.carrier, ["clone"]);
        if (error !== undefined) return error;
      }
    }
    const yieldFact = records.yield.get(node);
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
      const error = collectRustCallableInvocationRequirements(input, node, operation,
        { dependencies, projections, associated, addUse, collectType });
      if (error !== undefined) return error;
    }
    let childError: string | undefined;
    ast.forEachChild(node, (child) => {
      if (child !== undefined && childError === undefined) {
        childError = visit(child);
      }
    });
    return childError;
  };
  const error = input.promiseObjectFacet === true ? undefined : visit(declaration);
  if (error !== undefined) {
    return { kind: "rejected", reason: error };
  }
  if (definition !== undefined && input.objectRepresentations.representationFor(definition)?.dispatchObjectLifetime?.kind === "static") {
    for (const requirement of optionalStorage.seal()) {
      const storageError = addUse(declaration, requirement.carrier, ["static"]);
      if (storageError !== undefined) return { kind: "rejected", reason: storageError };
    }
  }
  return {
    kind: "resolved",
    dependencies: Object.freeze([...dependencies]),
    contract: Object.freeze({
      declaration,
      associatedTypes: associated.seal(),
      projectProjections: input.inheritedBody?.projectProjections ?? projections.seal(),
      optionalStorage: optionalStorage.seal(),
      typeParameters: Object.freeze(ownParameters.map((parameter) => Object.freeze({
        identity: parameter.identity, name: parameter.name,
        requirements: normalizeRustGenericRequirements([...(byParameter.get(parameter.identity) ?? [])]),
      }))),
      capturedTypeParameters: Object.freeze([...capturedParameters.values()].map((parameter) => Object.freeze({
        identity: parameter.identity, name: parameter.name,
        requirements: normalizeRustGenericRequirements([...(byParameter.get(parameter.identity) ?? [])]),
      }))),
      nativeInputs: Object.freeze([...nativeInputs.values()].map(parameter => Object.freeze({
        identity: parameter.identity, name: parameter.name,
        requirements: normalizeRustGenericRequirements([...(byParameter.get(parameter.identity) ?? [])]),
      }))),
      uses: Object.freeze(uses),
    }),
  };
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
        : requirement === "number-predicate" ? "an exact native numeric predicate contract"
        : requirement === "js-rejection" ? "an error convertible to a JavaScript rejection"
        : "an exact Rust 'static lifetime");
  if (descriptions.length <= 1) return descriptions[0] ?? "an exact Rust carrier contract";
  return `${descriptions.slice(0, -1).join(", ")} and ${descriptions[descriptions.length - 1]}`;
}
