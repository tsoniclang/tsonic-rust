import { stringListsEqual, type RequirementUse, type RequirementContractState } from "./generic-requirement-contract.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustStaticLifetime } from "../../target-model/lifetimes/index.js";

import { rustTypeParameterFromSourceContract } from "../../target-model/types/carriers/generic-references.js";
import type { Node } from "@tsonic/tsts";

import { classifyCarrierRequirements, type RustCarrierRequirementSelection } from "./generic-carrier-requirements.js";
import { normalizeRustErrorType } from "../errors/error-types.js";
import { createRustOptionalStorageCollector } from "./type-projections.js";
import { isRustIndependentCallable, isRustGenericTypeDeclaration } from "./generic-reference-uses.js";
import { createRustAssociatedRequirementCollector } from "./associated-requirements.js";

import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";

import { createRustProjectProjectionRequirementCollector } from "./project-projection-requirements.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustGenericRequirement } from "../../target-model/records/generic-requirements.js";
import { normalizeRustGenericRequirements } from "./generic-requirement-contract.js";

import { rustNativeCallableErrorChannel } from "../../policy/types/callables/native-protocols.js";

import { rustCallableRestCloneSources } from "../../policy/conversions/callable-requirements.js";

import type { RustCallableRequirementInput } from "./generic-callable-requirements-model.js";
import { createRustCallableRequirementVisitor } from "./generic-callable-requirement-uses.js";

export function classifyRustCallableRequirements(input: RustCallableRequirementInput):
  | {
      readonly kind: "resolved";
      readonly contract: RequirementContractState;
      readonly dependencies: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: string; readonly promiseStorage?: true } {
  const { ast, declaration, records } = input;
  const definition = input.projectTypes.definitionForDeclaration(declaration);
  const typeParameterNodes = (definition === undefined ? ast.typeParameters(declaration)
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
  const nativeLifetime = definition === undefined ? undefined : input.objectRepresentations.nativeLifetimeFor(definition);
  if (definition !== undefined && nativeLifetime === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "A project declaration requires its original prepared native lifetime contract.", declaration);
  if (nativeLifetime !== undefined) {
    for (const requirement of nativeLifetime.typeOutlives)
      if (requirement.lifetime.kind === "static") byParameter.get(requirement.identity)!.add("static");
  }
  const uses: RequirementUse[] = [...input.inheritedBody?.uses ?? []];
  const dependencies = new Set<string>();
  const staticEvidence = { lifetimeContract: input.sourceLifetimes.contractFor(declaration),
    genericCallables: input.genericCallables, structuralShapes: input.structuralShapes,
    frameCallables: input.frameCallables, classValues: input.classValues,
    objectRepresentations: input.objectRepresentations, projectTypes: input.projectTypes, records, projectFieldStorage: input.projectFieldStorage,
    errorType: (carrier: TargetTypeRef, node: Node) => normalizeRustErrorType(carrier, input.errorTypes, node) };
  const classifyUse = (node: Node, carrier: TargetTypeRef,
    requirements: readonly RustGenericRequirement[]): RustCarrierRequirementSelection => {
    const normalized = mapRustTargetTypes(carrier, normalizeFamily);
    // A JS-rejection requirement names an error channel, so it is classified on that channel's physical error type.
    const physical = requirements.includes("static") || requirements.includes("js-rejection")
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
      uses.push(Object.freeze({ node, carrier, requirements: normalized,
        ...(rustTargetTypeRefEquals(carrier, requiredCarrier) ? {} : { nativeStorageCarrier: requiredCarrier }),
      }));
    }
    return undefined;
  };
  for (const adapter of input.promiseObjectFacet === true ? [] : records.projectCallableAdapters.get(declaration) ?? []) {
    for (const carrier of rustCallableRestCloneSources(adapter.parameterAdapters)) {
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
    // A factory task owns its settled output; an output that cannot be owned for 'static is the same storage refusal as
    // a retained borrowed capture.
    if (error !== undefined) {
      return lowering.kind === "factory" ? { kind: "rejected", promiseStorage: true, reason: error } : { kind: "rejected", reason: error };
    }
    if (lowering.kind === "factory") {
      const fixed = input.structuralShapes.definitions.flatMap(definition => definition.fields.flatMap(field =>
        field.methodPlan?.kind === "fixed" && field.methodPlan.declaration === declaration
          ? [{ carrier: definition.carrier, method: field.methodPlan }] : []));
      if (lowering.storage.kind === "receiver" && fixed.length !== 0 && fixed.some(selected => selected.method.factoryReceiver !== "value"))
        return { kind: "rejected", promiseStorage: true,
        reason: "An owned Promise cannot retain an unowned method receiver." };
      for (const selected of fixed) if (selected.method.factoryReceiver === "value") {
        const receiverError = addUse(declaration, selected.carrier, ["static"]);
        if (receiverError !== undefined) return { kind: "rejected", promiseStorage: true, reason: receiverError };
      }
      if (fixed.length === 0 && lowering.ownedReceiver !== undefined) {
        const receiverError = addUse(declaration, lowering.ownedReceiver.carrier, ["static"]);
        if (receiverError !== undefined) return { kind: "rejected", promiseStorage: true, reason: receiverError };
      }
      if (fixed.length === 0 && lowering.storage.kind === "receiver" && lowering.ownedReceiver === undefined)
        return { kind: "rejected", promiseStorage: true, reason: "An owned Promise cannot retain an unowned method receiver." };
      for (const carrier of fixed.length === 0 ? lowering.capturedCarriers : []) {
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
  // A JS Promise object returned by a callable body that is not itself suspended outlives that callable's activation; a JS
  // Promise object requires a 'static payload (RULINGS 2026-10-22), so its payload carries the bound in this contract.
  const returnedPromise = asynchronous === undefined && generator === undefined && input.ast.body(declaration) !== undefined
    ? rustJsPromiseOutputTargetType(records.sourceCallableReturn.get(declaration)?.returnCarrier) : undefined;
  if (returnedPromise !== undefined && input.promiseObjectFacet !== true) {
    const error = addUse(declaration, returnedPromise, ["static"]);
    if (error !== undefined) return { kind: "rejected", reason: error };
  }
  const visit = createRustCallableRequirementVisitor(input, {
    declared, dependencies, definition, normalizeFamily, optionalStorage, associated, projections, addUse,
  });
  const error = input.promiseObjectFacet === true ? undefined : visit(declaration);
  if (error !== undefined) {
    return { kind: "rejected", reason: error };
  }
  if (nativeLifetime?.dispatchObjectLifetime?.kind === "static") {
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
