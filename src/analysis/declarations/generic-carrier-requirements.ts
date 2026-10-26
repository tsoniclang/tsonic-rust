import type { Node } from "@tsonic/tsts";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustTargetGenericArgument, RustTargetTraitRef, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement, RustDeclarationGenericRequirementContract } from "../../target-model/records/generic-requirements.js";
import type { RustSourceGenericContract, RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey, rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import { substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustLifetimeOutlives } from "../../policy/constraints/lifetime-outlives.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition } from "../../target-model/records/frame-callables.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustCarrierSupportsNumberPredicate, rustCarrierSupportsSourceNumeric } from "../../target-model/types/carriers/source-numeric.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { rustRetainedErrorTargetType } from "../../target-model/types/carriers/source-error.js";
import { rustCarrierSatisfiesTraitRef } from "../../policy/constraints/native-traits.js";
import { isRustNeverCarrier, rustFixedArrayCarrierValue, rustNamedTypeCarrierValue, rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue, rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import { rustCarrierSupportsTrait } from "../../policy/constraints/native-traits.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustClassConstructorContract } from "../../target-model/types/carriers/class-constructors.js";
import { rustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustNativeErrorJoinReference } from "../../target-model/types/native-error-joins.js";
import { rustGenericCallablePhysicalBindings } from "../../policy/types/callables/generic-bindings.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../project-types/type-family-normalization.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustCallableTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustBuiltInCarrierDefinitions } from "../../target-model/types/carriers/built-ins.js";
import { rustFutureTargetId, rustPrimitiveTypeName } from "../../target-model/types/carriers/primitives.js";

export type RustCarrierRequirementSelection =
  | { readonly kind: "supported" }
  | { readonly kind: "unsatisfied"; readonly reason: string }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustStaticRequirementEvidence {
  readonly lifetimeContract: RustSourceGenericContract | undefined;
  readonly genericCallables: RustGenericCallablePlan | undefined;
  readonly frameCallables: RustFrameCallablePlan | undefined;
  readonly classValues: RustClassValuePlan | undefined;
  readonly objectRepresentations: RustObjectRepresentationPlan | undefined;
  readonly structuralShapes: RustStructuralShapePlan | undefined;
  readonly projectTypes: RustProjectTypePolicy | undefined;
  readonly records: Pick<RustProgramRecords, "runtimeCarrier"> | undefined;
  /** Closes a stored field carrier's logical error channels to their admitted native representation. */
  readonly errorType?: (carrier: TargetTypeRef, declaration: Node) => TargetTypeRef | undefined;
}

const supported: RustCarrierRequirementSelection = Object.freeze({ kind: "supported" });
const unsatisfied = (reason: string): RustCarrierRequirementSelection => Object.freeze({ kind: "unsatisfied", reason });
const unresolved = (reason: string): RustCarrierRequirementSelection => Object.freeze({ kind: "unresolved", reason });

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
  const active = new Set<string>();
  const every = (results: readonly RustCarrierRequirementSelection[]): RustCarrierRequirementSelection =>
    results.find(result => result.kind === "unresolved") ?? results.find(result => result.kind === "unsatisfied") ?? supported;
  const lifetime = (value: RustLifetimeRef | undefined, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    if (value === undefined || value.kind === "placeholder" || value.kind === "call-scoped-elision")
      return unresolved("Native static retention requires an exact physical lifetime identity.");
    if (value.kind === "bound" && bound.has(rustLifetimeKey(value))) return supported;
    if (value.kind === "static") return supported;
    return evidence?.lifetimeContract !== undefined && rustLifetimeOutlives(value, rustStaticLifetime, evidence.lifetimeContract)
      ? supported : unsatisfied("The actual native stored lifetime does not outlive static.");
  };
  const argumentsFor = (arguments_: readonly RustTargetGenericArgument[],
    bound: ReadonlySet<string>): RustCarrierRequirementSelection => every(arguments_.map(argument => argument.kind === "type"
      ? visit(argument.type, bound) : argument.kind === "lifetime" ? lifetime(argument.lifetime, bound)
        : argument.value.kind === "infer" ? unresolved("Native retention requires an exact const argument.") : supported));
  const trait = (value: RustTargetTraitRef, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    const nested = new Set([...bound, ...value.lifetimeBinder?.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)) ?? []]);
    return every([argumentsFor(value.genericArguments, nested), ...value.associatedConstraints.map(constraint =>
      constraint.kind === "equality" ? every([argumentsFor(constraint.genericArguments, nested), visit(constraint.type, nested)])
        : every([argumentsFor(constraint.genericArguments, nested), ...constraint.outlives.map(value => lifetime(value, nested))]))]);
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
    bindings: RustTargetGenericBindings, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    if (!definition.entries.includes(entry) || entry.implementations.length === 0)
      return unresolved("A native frame slot requires its exact admitted entry alternatives.");
    return every(entry.implementations.map(implementation => {
      const selected: TargetTypeRef[] = [];
      for (const [original, retained] of [
        [implementation.capture.captures, implementation.captures],
        [implementation.capture.receiverFields, implementation.receiverFields],
      ] as const) {
        // An entry keeps each capture as a copy that adds its storage carrier, so correspondence is by captured
        // declaration and reference, not object identity.
        const same = (left: { readonly declaration: Node; readonly reference: Node },
          right: { readonly declaration: Node; readonly reference: Node }): boolean =>
          left.declaration === right.declaration && left.reference === right.reference;
        if (retained.some(capture => !original.some(candidate => same(candidate, capture))) || original.some(capture =>
          !retained.some(candidate => same(candidate, capture)) && !definition.bindings.some(binding => binding.declaration === capture.declaration)))
          return unresolved("A native frame entry lost its exact source-to-physical capture correspondence.");
        selected.push(...retained.map(capture => apply(capture.carrier, bindings)));
      }
      const sameReceiver = (left: { readonly owner: Node; readonly reference: Node },
        right: { readonly owner: Node; readonly reference: Node }): boolean =>
        left.owner === right.owner && left.reference === right.reference;
      if (implementation.receivers.some(receiver => !implementation.capture.receivers.some(candidate => sameReceiver(candidate, receiver))) ||
        implementation.capture.receivers.some(receiver => !implementation.receivers.some(candidate => sameReceiver(candidate, receiver)) &&
          (definition.activation.kind !== "class" || receiver.owner !== definition.activation.ownerDeclaration)))
        return unresolved("A native frame entry lost its exact receiver-to-activation correspondence.");
      selected.push(...implementation.receivers.map(receiver => apply(receiver.carrier, bindings)));
      return every(selected.map(carrier => visit(carrier, bound)));
    }));
  };
  const classEnvironment = (carrier: TargetTypeRef, constructor: boolean,
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
    return every([argumentsFor(arguments_ as RustTargetGenericArgument[], bound),
      ...environment.captures.map(capture => visit(apply(capture.carrier, bindings), bound)),
      ...environment.staticFields.map(field => visit(apply(field.carrier, bindings), bound))]);
  };
  const sourceObject = (carrier: TargetTypeRef, bound: ReadonlySet<string>, wrapper: boolean): RustCarrierRequirementSelection => {
    const project = evidence?.projectTypes;
    const source = rustSourceTypeCarrierValue(carrier);
    const definition = project?.definitionForCarrier(carrier);
    const layout = definition === undefined ? undefined : project?.objectLayoutForDefinition(definition);
    if (project === undefined || source === undefined || definition === undefined || layout === undefined || layout.indexSignatures.length !== 0)
      return unresolved("A source object requires its complete physical field and index-storage layout.");
    if (wrapper && project.isPolymorphic(definition)) {
      const representation = evidence?.objectRepresentations?.representationFor(definition);
      const open = rustSourceTypeCarrierValue(project.openCarrier(definition));
      const bindings = open === undefined ? undefined : rustGenericCallablePhysicalBindings(open.genericArguments, source.genericArguments);
      if (representation?.kind !== "open-hierarchy" || representation.dispatchObjectLifetime === undefined || bindings === undefined)
        return unresolved("A native polymorphic wrapper requires its selected dispatch-object lifetime and exact arguments.");
      const selectedLifetime = bindings.lifetimes.get(rustLifetimeKey(representation.dispatchObjectLifetime)) ?? representation.dispatchObjectLifetime;
      return every([lifetime(selectedLifetime, bound), argumentsFor(source.genericArguments, bound)]);
    }
    const bases = project.directSupertypes(carrier);
    if (bases === undefined) return unresolved("A native object requires its exact physical base layout.");
    const lifetimeParameters = definition.genericParameters.some(parameter => parameter.kind === "lifetime");
    return every([argumentsFor(source.genericArguments, bound), ...bases.map(base => {
      const baseDefinition = project.definitionForCarrier(base);
      return baseDefinition === undefined ? visit(base, bound)
        : baseDefinition.kind === "interface" ? supported : sourceObject(base, bound, false);
    }), ...layout.fields.map(field => {
      const frame = evidence?.frameCallables?.bindingFor(field.declaration);
      if (frame?.entry !== undefined) {
        const definition = evidence?.frameCallables?.definitionFor(frame.carrier);
        const instantiated = project.instantiateMemberCarrier(field.declaration, carrier, frame.carrier);
        const bindings = definition === undefined || instantiated === undefined ? undefined : frameBindings(instantiated, definition, frame.entry);
        return definition === undefined || bindings === undefined || !definition.bindings.includes(frame)
          ? unresolved("A native object frame field lacks its exact selected entry storage.")
          : frameEntry(definition, frame.entry, bindings, bound);
      }
      const declaredCarrier = evidence?.records?.runtimeCarrier.get(field.declaration)?.carrier;
      const instantiated = declaredCarrier === undefined ? undefined : project.instantiateMemberCarrier(field.declaration, carrier, declaredCarrier);
      // A native object without lifetime parameters owns its fields, so an elided lifetime in a stored field can only be
      // static (the physical field storage selects the same carrier).
      const owned = instantiated === undefined || lifetimeParameters ? instantiated
        : substituteElidedLifetime(instantiated, rustStaticLifetime);
      const selected = owned === undefined || evidence?.errorType === undefined ? owned : evidence.errorType(owned, field.declaration);
      return selected === undefined ? unresolved("A source field lacks its exact native instance storage carrier.") : visit(selected, bound);
    }), ...(definition.kind === "class" ? [classEnvironment(carrier, false, bound)] : [])]);
  };
  const recursiveProjectObject = (value: TargetTypeRef): boolean => {
    const source = rustSourceTypeCarrierValue(value);
    return source !== undefined && source.shape !== "enum" && evidence?.projectTypes?.definitionForCarrier(value) !== undefined;
  };
  const visit = (value: TargetTypeRef, bound: ReadonlySet<string>): RustCarrierRequirementSelection => {
    const key = closedMetadataKey([value, [...bound]]);
    // A project object that reaches itself through its own fields (class Link { next: Link | undefined }) stores that
    // occurrence behind its native object handle, so the occurrence adds no requirement beyond the rest of the cycle,
    // which this visit already collects. Any other recursive carrier has no completed physical storage contract.
    if (active.has(key)) return recursiveProjectObject(value) ? supported
      : unresolved("Native static retention requires a completed recursive physical storage contract.");
    active.add(key);
    try {
      switch (value.kind) {
        case "source-primitive":
          return rustPrimitiveTypeName(value.name) !== undefined ? supported
            : unresolved("A source primitive has no exact native storage form for static retention.");
        case "type-parameter":
          if (!declared.has(value.identity) || !byParameter.has(value.identity))
            return unresolved("Native static retention refers to a foreign generic identity.");
          byParameter.get(value.identity)!.add("static");
          return supported;
        case "array":
        case "slice":
          return visit(value.element, bound);
        case "tuple":
          return every(value.elements.map(element => visit(element, bound)));
        case "reference":
          return every([lifetime(value.lifetime, bound), visit(value.referent, bound)]);
        case "pointer":
          return visit(value.pointee, bound);
        case "function-pointer": {
          const nested = new Set([...bound, ...value.lifetimeBinder?.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)) ?? []]);
          return every([...value.args.map(argument => visit(argument, nested)), visit(value.result, nested)]);
        }
        case "trait-object":
          return every([lifetime(value.lifetime, bound), trait(value.principal, bound), ...value.autoTraits.map(value => trait(value, bound))]);
        case "associated-type":
          return associatedSupports(value, "static") ? supported : unsatisfied("The exact native associated projection has no static bound.");
        case "impl-trait":
          return value.outlives.some(value => lifetime(value, bound).kind === "supported") ? supported
            : unresolved("An opaque native value requires its actual completed capture storage or an explicit native outlives guarantee; Future output is not capture evidence.");
        case "closure":
          return unresolved("A logical native closure signature does not contain its actual physical captured storage.");
        case "opaque":
          return unresolved("An opaque native identity has no completed physical storage evidence.");
        case "trait-ref":
          return unresolved("A native trait constraint is not a stored value representation.");
        case "target-named": {
          if (value.id === rustFutureTargetId)
            return unresolved("A logical Future result does not prove its physical stored environment.");
          if (!Object.prototype.hasOwnProperty.call(rustBuiltInCarrierDefinitions, value.id))
            return unresolved("Native static retention requires a known physical named carrier, not an unregistered native identity.");
          const definition = rustBuiltInCarrierDefinitions[value.id]!;
          const arguments_ = value.genericArguments ?? [];
          if (arguments_.length !== definition.parameters.length ||
            arguments_.some((argument, index) => argument.kind !== definition.parameters[index]))
            return unresolved("A native carrier requires its exact declared storage argument count and kinds.");
          if (definition.storage === "unavailable")
            return unresolved("This reserved native identity has no admitted physical value representation.");
          if (definition.storage === "opaque")
            return unresolved("An opaque native implementation requires its actual physical environment, not its logical signature.");
          if (definition.storage === "program-error") {
            const errorOwner = rustProgramErrorOwner(value);
            return errorOwner?.kind === "physical" ? supported
              : unresolved("A contextual program error requires its actual admitted native payload representation.");
          }
          if (value.id === rustCallableTargetId && rustCallableProtocol(value) === undefined)
            return unresolved("A native callable requires its exact admitted storage protocol.");
          return argumentsFor(arguments_, bound);
        }
        case "target-specific": {
          if (isRustNeverCarrier(value)) return supported;
          const fixed = rustFixedArrayCarrierValue(value);
          if (fixed !== undefined) return every([visit(fixed.element, bound),
            fixed.length.kind === "infer" ? unresolved("A native fixed array requires its exact const extent.") : supported]);
          const join = rustNativeErrorJoinReference(value);
          if (join !== undefined) return every(join.errors.map(error => visit(error, bound)));
          const named = rustNamedTypeCarrierValue(value);
          if (named !== undefined) return argumentsFor(named.genericArguments, bound);
          const union = rustSourceUnionCarrierValue(value);
          if (union !== undefined) {
            const variants = definitions.sourceUnionVariants(value);
            return variants === undefined ? unresolved("Native union retention requires its actual admitted payload variants.")
              : every(variants.map(variant => visit(variant.carrier, bound)));
          }
          const structural = rustStructuralObjectCarrierValue(value);
          if (structural !== undefined) {
            const owner = logicalProgramErrorCarrier(value);
            const fields = structural.fields.map((field, index) => {
              if (field.method !== true) return visit(field.type, bound);
              const method = evidence?.structuralShapes?.field(owner, index)?.methodPlan;
              if (method?.kind === "fixed") {
                const context = evidence?.errorType === undefined ? method.context : evidence.errorType(method.context, method.declaration);
                return context === undefined ? unresolved("A fixed structural context requires its actual native capture error representation.")
                  : visit(context, bound);
              }
              const selected = method?.carrier;
              const declaration = evidence?.lifetimeContract?.declaration;
              const physical = selected === undefined || evidence?.errorType === undefined || declaration === undefined
                ? selected : evidence.errorType(selected, declaration);
              return physical === undefined
                ? unresolved("A structural method requires its completed physical storage, not its logical call signature.")
                : visit(structuralMethodWithoutSelf(physical, value), bound);
            });
            return every([...structural.bases.map(base => visit(base, bound)), ...fields]);
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
                return visit(substituteRustTargetGenerics(memberCarrier, familyBindings.types, familyBindings.lifetimes, familyBindings.consts), bound);
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
            const entries = definition.entries.map(entry => frameEntry(definition, entry, bindings, bound));
            const fields = definition.bindings.map(binding => binding.entry === undefined ? visit(apply(binding.carrier, bindings), bound)
              : definition.entries.includes(binding.entry) ? supported
                : unresolved("A native frame binding does not belong to its selected entry family."));
            return every([argumentsFor([...bindings.types.values()].map(type => ({ kind: "type", type })), bound),
              ...entries, ...fields, ...(definition.storage.kind === "object" && frame.owner.kind === "class"
                ? [sourceObject(frame.owner.instance, bound, false)] : [])]);
          }
          const constructor = rustClassConstructorContract(value);
          if (constructor !== undefined) return classEnvironment(constructor.instance, true, bound);
          const source = rustSourceTypeCarrierValue(value);
          if (source !== undefined) {
            if (source.shape === "enum") return definitions.sourceEnumDefinition(value) !== undefined
              ? argumentsFor(source.genericArguments, bound) : unresolved("A source enum requires its admitted native definition.");
            return sourceObject(value, bound, true);
          }
          return unresolved("Native static retention requires actual physical storage for this target-specific carrier.");
        }
      }
    } finally {
      active.delete(key);
    }
  };
  return visit(carrier, new Set());
}

// Static retention reads carriers whose program errors are already physical, while structural storage is keyed by the
// logical instance; every error owner of one instance names the same physical method slot.
const logicalProgramErrorCarrier = (type: TargetTypeRef): TargetTypeRef => {
  let changed = false;
  const logical = mapRustTargetTypes(type, current => {
    const owner = rustProgramErrorOwner(current);
    if (owner === undefined || owner.kind === "logical") return current;
    changed = true;
    return rustProgramErrorTargetType();
  });
  return changed ? logical : type;
};
const logicalProgramErrorKey = (type: TargetTypeRef): string => closedMetadataKey(logicalProgramErrorCarrier(type));

// A method slot receives the object that owns it; that receiver is the carrier under classification, so its own
// requirement holds exactly when the rest of the slot's storage holds.
function structuralMethodWithoutSelf(storage: TargetTypeRef, owner: TargetTypeRef): TargetTypeRef {
  const key = logicalProgramErrorKey(owner);
  return mapRustTargetTypes(storage, (current, source) =>
    logicalProgramErrorKey(source) === key ? { kind: "tuple", elements: [] } : current);
}
