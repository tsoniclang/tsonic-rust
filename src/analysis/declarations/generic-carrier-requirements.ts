import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustTargetGenericArgument, RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement, RustDeclarationGenericRequirementContract } from "./generic-requirements.js";
import type { RustSourceGenericContract, RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey, rustLifetimeOutlives, rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition, RustFrameCallablePlan } from "../callables/frame-values.js";
import type { RustNativeCapturePlan } from "../callables/native-captures.js";
import type { RustClassValuePlan } from "../objects/class-values.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustCarrierSupportsNumberPredicate, rustCarrierSupportsSourceNumeric } from "../../target-model/types/carriers/source-numeric.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { rustRetainedErrorTargetType, rustRetainedErrorTargetId, rustWritableRetainedErrorTargetId,
  rustMutableJsErrorTargetId } from "../../target-model/types/carriers/source-error.js";
import { rustCarrierSatisfiesTraitRef } from "../../target-model/types/carriers/traits.js";
import { isRustNeverCarrier, rustCarrierSupportsTrait, rustFixedArrayCarrierValue,
  rustNamedTypeCarrierValue, rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue,
  rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustClassConstructorContract } from "../../target-model/types/carriers/class-constructors.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { inferRustTargetGenericBindings, type RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustNativeErrorJoinReference } from "../../target-model/types/native-error-joins.js";
import { rustGenericCallablePhysicalBindings } from "../callables/generic-bindings.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../../policy/types/model/type-family-normalization.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import * as nativeIds from "../../target-model/types/carriers/source-types.js";
import { rustFutureTargetId, rustPrimitiveTypeName } from "../../target-model/types/carriers/primitives.js";

export type RustCarrierRequirementSelection =
  | { readonly kind: "supported" }
  | { readonly kind: "unsatisfied"; readonly reason: string }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustStaticRequirementEvidence {
  readonly lifetimeContract: RustSourceGenericContract | undefined;
  readonly genericCallables: RustGenericCallablePlan | undefined;
  readonly frameCallables: RustFrameCallablePlan | undefined;
  readonly nativeCaptures: RustNativeCapturePlan | undefined;
  readonly classValues: RustClassValuePlan | undefined;
  readonly structuralShapes: RustStructuralShapePlan | undefined;
  readonly projectTypes: RustProjectTypePolicy | undefined;
  readonly records: Pick<RustProgramRecords, "runtimeCarrier"> | undefined;
}

const supported: RustCarrierRequirementSelection = Object.freeze({ kind: "supported" });
const unsatisfied = (reason: string): RustCarrierRequirementSelection => Object.freeze({ kind: "unsatisfied", reason });
const unresolved = (reason: string): RustCarrierRequirementSelection => Object.freeze({ kind: "unresolved", reason });

const ownedNativeIds: ReadonlySet<string> = new Set([
  nativeIds.rustAbsenceTargetId, nativeIds.rustStringTargetId, nativeIds.rustStrTargetId,
  nativeIds.rustBigIntTargetId, nativeIds.rustEmptyObjectTargetId, nativeIds.rustObjectIdentityTargetId,
  nativeIds.rustJsNumericTargetId, nativeIds.rustJsStringNumberTargetId, nativeIds.rustTsValueTargetId,
  nativeIds.rustJsValueTargetId, nativeIds.rustJsStringTargetId, nativeIds.rustInfallibleTargetId,
  nativeIds.rustJsErrorTargetId, nativeIds.rustJsDateTargetId, nativeIds.rustJsSymbolTargetId,
  nativeIds.rustJsPromiseRejectedResultTargetId,
  rustRetainedErrorTargetId, rustWritableRetainedErrorTargetId, rustMutableJsErrorTargetId,
  nativeIds.rustJsArrayBufferTargetId, nativeIds.rustJsDataViewTargetId,
  nativeIds.rustJsInt8ArrayTargetId, nativeIds.rustJsUint8ArrayTargetId, nativeIds.rustJsUint8ClampedArrayTargetId,
  nativeIds.rustJsInt16ArrayTargetId, nativeIds.rustJsUint16ArrayTargetId, nativeIds.rustJsInt32ArrayTargetId,
  nativeIds.rustJsUint32ArrayTargetId, nativeIds.rustJsFloat32ArrayTargetId, nativeIds.rustJsFloat64ArrayTargetId,
]);

const nativeContainerArities: ReadonlyMap<string, number> = new Map([
  [nativeIds.rustOptionTargetId, 1], [nativeIds.rustLocationTargetId, 2],
  [nativeIds.rustJsArrayTargetId, 1], [nativeIds.rustJsArrayConcatItemTargetId, 1], [nativeIds.rustJsMapTargetId, 2],
  [nativeIds.rustJsSetTargetId, 1], [nativeIds.rustJsWeakMapTargetId, 2], [nativeIds.rustJsWeakSetTargetId, 1],
  [nativeIds.rustJsPromiseFulfilledResultTargetId, 1], [nativeIds.rustJsPromiseSettledResultTargetId, 1],
  [nativeIds.rustJsPromiseResolutionTargetId, 1], [nativeIds.rustIteratorResultTargetId, 2],
]);

export function rustFinalContractSupportsStatic(
  contract: RustDeclarationGenericRequirementContract,
  carrier: TargetTypeRef,
  families: Pick<RustSourceTypeFamilyRegistry, "implementation">,
  definitions: RustTypeDefinitions,
  evidence: RustStaticRequirementEvidence | undefined,
): RustCarrierRequirementSelection {
  const normalized = mapRustTargetTypes(carrier, rustTypeFamilyNormalizer(families));
  const parameters = [...contract.typeParameters, ...contract.capturedTypeParameters, ...contract.nativeInputs,
    ...contract.optionalStorage.map(entry => ({ identity: entry.carrier.identity, requirements: entry.requirements }))];
  const available = new Map<string, Set<RustGenericRequirement>>();
  for (const parameter of parameters) {
    const requirements = available.get(parameter.identity) ?? new Set<RustGenericRequirement>();
    for (const requirement of parameter.requirements) requirements.add(requirement);
    available.set(parameter.identity, requirements);
  }
  if (rustTargetTypeParameterIdentities(normalized).some(identity => !available.has(identity)))
    return unresolved("Native static retention requires every free generic identity to belong to its actual final contract.");
  const demanded = new Map([...available.keys()].map(identity => [identity, new Set<RustGenericRequirement>()]));
  const selected = classifyCarrierRequirements(normalized, ["static"], new Set(available.keys()), demanded,
    (projection, requirement) => contract.associatedTypes.some(associated =>
      rustTargetTypeRefEquals(associated.carrier, projection) && associated.requirements.includes(requirement)), definitions, evidence);
  if (selected.kind !== "supported") return selected;
  return [...demanded].every(([identity, requirements]) => [...requirements].every(requirement => available.get(identity)!.has(requirement)))
    ? supported : unsatisfied("Native static retention requires an existing static bound in its exact final generic contract.");
}

export function classifyCarrierRequirements(
  carrier: TargetTypeRef,
  required: readonly RustGenericRequirement[],
  declared: ReadonlySet<string>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
  associatedSupports: (carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, requirement: RustGenericRequirement) => boolean,
  definitions: RustTypeDefinitions,
  evidence: RustStaticRequirementEvidence | undefined,
): RustCarrierRequirementSelection {
  if (isRustNeverCarrier(carrier)) return supported;
  for (const requirement of required) {
    if (requirement === "static") {
      const selected = classifyStaticCarrier(carrier, declared, byParameter, associatedSupports, definitions, evidence);
      if (selected.kind !== "supported") return selected;
      continue;
    }
    if (carrier.kind === "associated-type") {
      if (!associatedSupports(carrier, requirement)) return unsatisfied(`The exact native associated type does not provide ${requirement}.`);
      continue;
    }
    if (requirement === "source-numeric" || requirement === "number-predicate" || requirement === "js-rejection") {
      if (carrier.kind === "type-parameter") {
        if (!declared.has(carrier.identity)) return unresolved("A native requirement refers to a foreign generic identity.");
        byParameter.get(carrier.identity)!.add(requirement);
      } else if (!(requirement === "number-predicate" ? rustCarrierSupportsNumberPredicate(carrier)
        : requirement === "js-rejection" ? rustCarrierSatisfiesTraitRef(carrier, {
          kind: "trait-ref", id: "core::convert::Into", path: "core::convert::Into",
          genericArguments: [{ kind: "type", type: rustRetainedErrorTargetType() }], associatedConstraints: [],
        }, undefined, definitions) : rustCarrierSupportsSourceNumeric(carrier)))
        return unsatisfied(`The exact native carrier does not provide ${requirement}.`);
      continue;
    }
    const traitPath = requirement === "clone" ? "core::clone::Clone" : "core::default::Default";
    if (!rustCarrierSupportsTrait(carrier, traitPath, (name, selectedTrait) => {
      if (!declared.has(name) || selectedTrait !== traitPath) return false;
      byParameter.get(name)!.add(requirement);
      return true;
    }, (projection, selectedTrait) => selectedTrait === traitPath && associatedSupports(projection, requirement), definitions))
      return unsatisfied(`The exact native carrier does not provide ${requirement}.`);
  }
  return supported;
}

function classifyStaticCarrier(
  carrier: TargetTypeRef,
  declared: ReadonlySet<string>,
  byParameter: Map<string, Set<RustGenericRequirement>>,
  associatedSupports: (carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, requirement: RustGenericRequirement) => boolean,
  definitions: RustTypeDefinitions,
  evidence: RustStaticRequirementEvidence | undefined,
): RustCarrierRequirementSelection {
  type Variance = "positive" | "negative" | "invariant";
  const active = new Set<string>();
  const flip = (variance: Variance): Variance => variance === "positive" ? "negative" : variance === "negative" ? "positive" : variance;
  const every = (results: readonly RustCarrierRequirementSelection[]): RustCarrierRequirementSelection =>
    results.find(result => result.kind === "unresolved") ?? results.find(result => result.kind === "unsatisfied") ?? supported;
  const lifetime = (value: RustLifetimeRef | undefined, variance: Variance, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    if (value === undefined || value.kind === "placeholder" || value.kind === "call-scoped-elision")
      return unresolved("Native static retention requires an exact physical lifetime identity.");
    if (value.kind === "bound" && bound.has(rustLifetimeKey(value))) return supported;
    if (variance === "negative" || value.kind === "static") return supported;
    return evidence?.lifetimeContract !== undefined && rustLifetimeOutlives(value, rustStaticLifetime, evidence.lifetimeContract)
      ? supported : unsatisfied("The actual native stored lifetime does not outlive static.");
  };
  const argumentsFor = (arguments_: readonly RustTargetGenericArgument[], variance: Variance,
    bound: ReadonlySet<string>): RustCarrierRequirementSelection => every(arguments_.map(argument => argument.kind === "type"
      ? visit(argument.type, variance, bound) : argument.kind === "lifetime" ? lifetime(argument.lifetime, variance, bound)
        : argument.value.kind === "infer" ? unresolved("Native retention requires an exact const argument.") : supported));
  const trait = (value: RustTargetTraitRef, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    const nested = new Set([...bound, ...value.lifetimeBinder?.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)) ?? []]);
    return every([argumentsFor(value.genericArguments, "invariant", nested), ...value.associatedConstraints.map(constraint =>
      constraint.kind === "equality" ? every([argumentsFor(constraint.genericArguments, "invariant", nested), visit(constraint.type, "invariant", nested)])
        : every([argumentsFor(constraint.genericArguments, "invariant", nested), ...constraint.outlives.map(value => lifetime(value, "invariant", nested))]))]);
  };
  const apply = (carrier: TargetTypeRef, bindings: RustTargetGenericBindings): TargetTypeRef =>
    substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts);
  const frameBindings = (carrier: TargetTypeRef, definition: RustFrameCallableDefinition,
    entry: RustFrameCallableEntryDefinition): RustTargetGenericBindings | undefined => {
    const selected = rustFrameCallableValue(carrier);
    if (selected === undefined || selected.environment.length !== entry.environmentIndexes.length) return undefined;
    const arguments_: (TargetTypeRef | undefined)[] = Array.from({ length: definition.environmentParameters.length });
    for (const [index, argument] of selected.environment.entries()) {
      const destination = entry.environmentIndexes[index]!;
      if (destination < 0 || destination >= arguments_.length || arguments_[destination] !== undefined &&
        !rustTargetTypeRefEquals(arguments_[destination], argument)) return undefined;
      arguments_[destination] = argument;
    }
    return arguments_.some(argument => argument === undefined) ? undefined : rustGenericCallablePhysicalBindings(
      definition.environmentParameters.map(type => ({ kind: "type", type })),
      (arguments_ as TargetTypeRef[]).map(type => ({ kind: "type", type })));
  };
  const frameEntry = (definition: RustFrameCallableDefinition, entry: RustFrameCallableEntryDefinition,
    bindings: RustTargetGenericBindings, variance: Variance, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    if (!definition.entries.includes(entry) || entry.implementations.length === 0)
      return unresolved("A native frame slot requires its exact admitted entry alternatives.");
    return every(entry.implementations.map(implementation => {
      const physical = evidence?.nativeCaptures?.forDeclaration(implementation.declaration);
      if (physical?.kind !== "resolved") return unresolved(physical?.reason ?? "A native frame entry lacks its completed physical captures.");
      const selected: TargetTypeRef[] = [];
      for (const [original, retained, carriers] of [
        [implementation.capture.captures, implementation.captures, physical.captures],
        [implementation.capture.receiverFields, implementation.receiverFields, physical.receiverFields],
        [implementation.capture.receivers, implementation.receivers, physical.receivers],
      ] as const) {
        if (original.length !== carriers.length || retained.some(capture => !original.some(candidate => candidate === capture)))
          return unresolved("A native frame entry lost its exact source-to-physical capture correspondence.");
        original.forEach((capture, index) => {
          if (retained.some(candidate => candidate === capture)) selected.push(apply(carriers[index]!, bindings));
        });
      }
      return every(selected.map(carrier => visit(carrier, variance, bound)));
    }));
  };
  const classEnvironment = (carrier: TargetTypeRef, constructor: boolean, variance: Variance,
    bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    const project = evidence?.projectTypes;
    const source = rustSourceTypeCarrierValue(carrier);
    const definition = project?.definitionForCarrier(carrier);
    if (project === undefined || source === undefined || definition?.kind !== "class" || evidence?.classValues === undefined)
      return unresolved("A retained class value requires its sealed native class environment plan.");
    const environment = evidence.classValues.forDeclaration(definition.declaration)?.environment;
    if (environment === undefined) return constructor
      ? unresolved("A retained constructor requires its actual admitted factory environment.") : supported;
    if (!constructor && !environment.instancesUseEnvironment) return supported;
    const open = rustSourceTypeCarrierValue(project.openCarrier(definition));
    const bindings = open === undefined ? undefined : rustGenericCallablePhysicalBindings(open.genericArguments, source.genericArguments);
    if (bindings === undefined) return unresolved("A class environment lost its exact instance argument correspondence.");
    const arguments_ = environment.genericParameterIndexes.map(index => source.genericArguments[index]);
    if (arguments_.some(argument => argument === undefined)) return unresolved("A class environment has an unbound physical parameter.");
    return every([argumentsFor(arguments_ as RustTargetGenericArgument[], "invariant", bound),
      ...environment.captures.map(capture => visit(apply(capture.carrier, bindings), variance, bound)),
      ...environment.staticFields.map(field => visit(apply(field.carrier, bindings), variance, bound))]);
  };
  const sourceObject = (carrier: TargetTypeRef, variance: Variance, bound: ReadonlySet<string>, alternatives: boolean): RustCarrierRequirementSelection => {
    const project = evidence?.projectTypes;
    const source = rustSourceTypeCarrierValue(carrier);
    const definition = project?.definitionForCarrier(carrier);
    const layout = definition === undefined ? undefined : project?.objectLayoutForDefinition(definition);
    if (project === undefined || source === undefined || definition === undefined || layout === undefined || layout.indexSignatures.length !== 0)
      return unresolved("A source object requires its complete physical field and index-storage layout.");
    if (alternatives && project.isPolymorphic(definition)) {
      const concreteClasses = project.concreteClassesFor(definition);
      if (concreteClasses.length === 0) return unresolved("A native polymorphic object requires its actual admitted storage alternatives.");
      return every(concreteClasses.map(concrete => {
        const open = project.openCarrier(concrete);
        const relationship = project.relationship(open, definition);
        const references = rustTargetGenericReferences(open);
        const bindings = relationship.kind !== "related" ? undefined : inferRustTargetGenericBindings(relationship.targetType, carrier,
          { typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
            constIdentities: new Set(references.constIdentities) });
        if (bindings === undefined || bindings.types.size !== references.typeIdentities.length ||
          bindings.lifetimes.size !== references.lifetimeIdentities.length || bindings.consts.size !== references.constIdentities.length)
          return unresolved("A native object alternative requires its exact closed instance arguments.");
        return sourceObject(apply(open, bindings), variance, bound, false);
      }));
    }
    const bases = project.directSupertypes(carrier);
    if (bases === undefined) return unresolved("A native object requires its exact physical base layout.");
    return every([argumentsFor(source.genericArguments, "invariant", bound), ...bases.map(base => {
      const baseDefinition = project.definitionForCarrier(base);
      return baseDefinition === undefined ? visit(base, variance, bound)
        : baseDefinition.kind === "interface" ? supported : sourceObject(base, variance, bound, false);
    }), ...layout.fields.map(field => {
      const frame = evidence?.frameCallables?.bindingFor(field.declaration);
      if (frame?.entry !== undefined) {
        const definition = evidence?.frameCallables?.definitionFor(frame.carrier);
        const instantiated = project.instantiateMemberCarrier(field.declaration, carrier, frame.carrier);
        const bindings = definition === undefined || instantiated === undefined ? undefined : frameBindings(instantiated, definition, frame.entry);
        return definition === undefined || bindings === undefined || !definition.bindings.includes(frame)
          ? unresolved("A native object frame field lacks its exact selected entry storage.")
          : frameEntry(definition, frame.entry, bindings, variance, bound);
      }
      const declaredCarrier = evidence?.records?.runtimeCarrier.get(field.declaration)?.carrier;
      const selected = declaredCarrier === undefined ? undefined : project.instantiateMemberCarrier(field.declaration, carrier, declaredCarrier);
      return selected === undefined ? unresolved("A source field lacks its exact native instance storage carrier.") : visit(selected, variance, bound);
    }), ...(definition.kind === "class" ? [classEnvironment(carrier, false, variance, bound)] : [])]);
  };
  const visit = (value: TargetTypeRef, variance: Variance, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    const key = closedMetadataKey([value, variance, [...bound]]);
    if (active.has(key)) return unresolved("Native static retention requires a completed recursive physical storage contract.");
    active.add(key);
    try {
      switch (value.kind) {
        case "source-primitive":
          return rustPrimitiveTypeName(value.name) !== undefined ? supported
            : unresolved("A source primitive has no exact native storage form for static retention.");
        case "type-parameter":
          if (!declared.has(value.identity) || !byParameter.has(value.identity))
            return unresolved("Native static retention refers to a foreign generic identity.");
          if (variance !== "negative") byParameter.get(value.identity)!.add("static");
          return supported;
        case "array":
        case "slice":
          return visit(value.element, variance, bound);
        case "tuple":
          return every(value.elements.map(element => visit(element, variance, bound)));
        case "reference":
          return every([lifetime(value.lifetime, variance, bound), visit(value.referent, value.mutable ? "invariant" : variance, bound)]);
        case "pointer":
          return value.mutability === "target-defined" ? unresolved("Native pointer variance requires its actual native mutability.")
            : visit(value.pointee, value.mutability === "mut" ? "invariant" : variance, bound);
        case "function-pointer": {
          const nested = new Set([...bound, ...value.lifetimeBinder?.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)) ?? []]);
          return every([...value.args.map(argument => visit(argument, flip(variance), nested)), visit(value.result, variance, nested)]);
        }
        case "trait-object":
          return every([lifetime(value.lifetime, variance, bound), trait(value.principal, bound), ...value.autoTraits.map(value => trait(value, bound))]);
        case "associated-type":
          return associatedSupports(value, "static") ? supported : unsatisfied("The exact native associated projection has no static bound.");
        case "impl-trait":
          return value.outlives.some(value => lifetime(value, variance, bound).kind === "supported") ? supported
            : unresolved("An opaque native value requires its actual completed capture storage or an explicit native outlives guarantee; Future output is not capture evidence.");
        case "closure":
          return unresolved("A logical native closure signature does not contain its actual physical captured storage.");
        case "opaque":
          return unresolved("An opaque native identity has no completed physical storage evidence.");
        case "trait-ref":
          return unresolved("A native trait constraint is not a stored value representation.");
        case "target-named": {
          if (value.id === rustFutureTargetId || value.id === nativeIds.rustJsPromiseTargetId)
            return unresolved("A logical Future or Promise result does not prove its physical stored environment.");
          const errorOwner = rustProgramErrorOwner(value);
          if (errorOwner?.kind === "physical" && errorOwner.domain === "runtime") return supported;
          if (ownedNativeIds.has(value.id)) return (value.genericArguments?.length ?? 0) === 0 ? supported
            : unresolved("A closed native carrier has unexpected generic storage arguments.");
          if (value.id === nativeIds.rustCallableTargetId) return rustCallableProtocol(value) === undefined
            ? unresolved("A native callable requires its exact admitted storage protocol.")
            : argumentsFor(value.genericArguments!, "invariant", bound);
          const arity = nativeContainerArities.get(value.id);
          if (arity !== undefined) return value.genericArguments === undefined || value.genericArguments.length !== arity ||
            value.genericArguments.some(argument => argument.kind !== "type")
            ? unresolved("A native container requires its exact admitted storage arguments.") : argumentsFor(value.genericArguments, "invariant", bound);
          return unresolved("Native static retention requires a known physical named carrier, not an unregistered native identity.");
        }
        case "target-specific": {
          if (isRustNeverCarrier(value)) return supported;
          const fixed = rustFixedArrayCarrierValue(value);
          if (fixed !== undefined) return every([visit(fixed.element, variance, bound),
            fixed.length.kind === "infer" ? unresolved("A native fixed array requires its exact const extent.") : supported]);
          const join = rustNativeErrorJoinReference(value);
          if (join !== undefined) return every(join.errors.map(error => visit(error, variance, bound)));
          const named = rustNamedTypeCarrierValue(value);
          if (named !== undefined) return variance === "negative" && named.genericArguments.length !== 0
            ? unresolved("A native named argument in contravariant position requires its actual native variance metadata.")
            : argumentsFor(named.genericArguments, "invariant", bound);
          const union = rustSourceUnionCarrierValue(value);
          if (union !== undefined) {
            const variants = definitions.sourceUnionVariants(value);
            return variants === undefined ? unresolved("Native union retention requires its actual admitted payload variants.")
              : every(variants.map(variant => visit(variant.carrier, variance, bound)));
          }
          const structural = rustStructuralObjectCarrierValue(value);
          if (structural !== undefined) {
            const fields = structural.fields.map((field, index) => {
              if (field.method !== true) return visit(field.type, variance, bound);
              const selected = evidence?.structuralShapes?.field(value, index);
              return selected?.methodStorageCarrier === undefined
                ? unresolved("A structural method requires its completed physical storage, not its logical call signature.")
                : visit(selected.methodStorageCarrier, variance, bound);
            });
            return every([...structural.bases.map(base => visit(base, variance, bound)), ...fields]);
          }
          const generic = rustGenericCallableValue(value);
          if (generic !== undefined) {
            const physical = evidence?.genericCallables?.physical;
            const selection = physical?.existingSelectionFor(value);
            if (physical === undefined || selection === undefined || generic.physical === undefined)
              return unresolved("A retained generic callable requires its existing admitted physical family and captures.");
            const familyBindings = rustGenericCallablePhysicalBindings([
              ...selection.definition.signature.environmentParameters.map(type => ({ kind: "type" as const, type })),
              ...selection.definition.parameters,
            ], [...generic.environment.map(type => ({ kind: "type" as const, type })), ...selection.arguments]);
            if (familyBindings === undefined) return unresolved("A generic callable lost its actual physical argument correspondence.");
            return every(selection.definition.members.map(member => {
              const environment = physical.environmentFor(member.implementation);
              const bindings = environment === undefined ? undefined : rustGenericCallablePhysicalBindings(environment.parameters, member.arguments);
              if (environment === undefined || bindings === undefined)
                return unresolved("A generic callable member lacks its completed physical captured storage.");
              return every([...environment.captures, ...environment.receiverFields, ...environment.receivers].map(capture => {
                const memberCarrier = substituteRustTargetGenerics(capture.storageCarrier, bindings.types, bindings.lifetimes, bindings.consts);
                return visit(substituteRustTargetGenerics(memberCarrier, familyBindings.types, familyBindings.lifetimes, familyBindings.consts), variance, bound);
              }));
            }));
          }
          const frame = rustFrameCallableValue(value);
          if (frame !== undefined) {
            const definition = evidence?.frameCallables?.definitionFor(value);
            const entry = evidence?.frameCallables?.entryFor(value);
            const bindings = definition === undefined || entry === undefined ? undefined : frameBindings(value, definition, entry);
            if (definition === undefined || entry === undefined || bindings === undefined || !definition.entries.includes(entry))
              return unresolved("A retained frame requires its complete admitted activation, entry and physical arguments.");
            const entries = definition.entries.map(entry => frameEntry(definition, entry, bindings, variance, bound));
            const fields = definition.bindings.map(binding => binding.entry === undefined ? visit(apply(binding.carrier, bindings), variance, bound)
              : definition.entries.includes(binding.entry) ? supported
                : unresolved("A native frame binding does not belong to its selected entry family."));
            return every([argumentsFor([...bindings.types.values()].map(type => ({ kind: "type", type })), "invariant", bound),
              ...entries, ...fields, ...(definition.storage.kind === "object" && frame.owner.kind === "class"
                ? [sourceObject(frame.owner.instance, variance, bound, false)] : [])]);
          }
          const constructor = rustClassConstructorContract(value);
          if (constructor !== undefined) return classEnvironment(constructor.instance, true, variance, bound);
          const source = rustSourceTypeCarrierValue(value);
          if (source !== undefined) {
            if (source.shape === "enum") return definitions.sourceEnumDefinition(value) !== undefined
              ? argumentsFor(source.genericArguments, variance, bound) : unresolved("A source enum requires its admitted native definition.");
            return sourceObject(value, variance, bound, true);
          }
          return unresolved("Native static retention requires actual physical storage for this target-specific carrier.");
        }
      }
    } finally {
      active.delete(key);
    }
  };
  return visit(carrier, "positive", new Set());
}
