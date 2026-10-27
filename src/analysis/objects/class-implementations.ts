import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustClassEmissionProducer } from "../program/records/objects/class-emission.js";
import type { RustClassConstructorViewEmission, RustClassImplementationContext, RustClassStructuralViewEmission } from "../../target-model/records/objects/class-implementations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectGenericEmission } from "../../target-model/records/program/project-emission.js";
import type { RustClassValueCallable } from "../../target-model/records/callables/class-value-callables.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/model.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustCallableProtocol, rustSourceTypeCarrierValue, rustTargetGenericReferences, substituteRustTargetGenerics, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustClassConstructorTargetType } from "../../target-model/types/carriers/class-constructors.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/types/carriers/generic-references.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { selectRustCallableValueAdapter } from "../../policy/conversions/callable-adapters.js";
import { structuralDispatchSignature } from "../../policy/types/objects/structural-emission.js";
import type { RustClassImplementationContextConstruction } from "./class-implementation-contexts.js";

export function analyzeRustClassImplementations(
  program: Omit<RustAnalysisProgram, "reachability">, producer: RustClassEmissionProducer,
  contexts: Pick<RustClassImplementationContextConstruction, "forInstance">,
): void {
  const genericCarriers = new Set<string>();
  const genericsFor = (carrier: TargetTypeRef, selected: RustProjectGenericEmission, context: RustClassImplementationContext, declaration: Node): void => {
    const key = closedMetadataKey(carrier);
    if (genericCarriers.has(key)) return;
    genericCarriers.add(key);
    const references = rustTargetGenericReferences(carrier);
    if (references.constIdentities.length !== 0 || references.lifetimes.some(lifetime => lifetime.kind !== "parameter"))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted native implementation requires its closed type and lifetime parameter inventory.", declaration);
    const parameters = new Map(references.typeParameters.map(parameter => [parameter.identity, parameter]));
    const arguments_ = [...selected.parameters.flatMap(({ parameter }) => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []),
      ...selected.optionalStorage.map(storage => storage.carrier)];
    for (const argument of arguments_) {
      const type = substituteRustTargetGenerics(argument, context.types, context.lifetimes);
      if (type.kind === "type-parameter" && type.optionalStorageValue !== undefined) parameters.set(type.identity, type);
    }
    producer.implementationGenerics(carrier, { parameters: Object.freeze([...parameters.values()]),
      lifetimes: Object.freeze(references.lifetimes.filter((lifetime): lifetime is Extract<RustLifetimeRef, { readonly kind: "parameter" }> => lifetime.kind === "parameter")) });
  };
  const constructors = new Map<Node, Map<string, RustClassConstructorViewEmission[]>>();
  for (const view of program.classValues.constructorViewImplementations) {
    const definition = program.projectTypes.definitionForDeclaration(view.declaration);
    const environment = program.classValues.forDeclaration(view.declaration)?.environment;
    const shape = program.structuralShapes.definitionForCarrier(view.targetCarrier);
    if (definition === undefined || environment === undefined || shape?.dispatchName === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted constructor view requires its native class environment and structural dispatch contract.", view.declaration);
    const arguments_ = rustSourceTypeCarrierValue(view.sourceCarrier)?.genericArguments;
    if (arguments_ === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted constructor view requires its native generic arguments.", view.declaration);
    const bound = arguments_.flatMap((argument, index) => !environment.genericParameterIndexes.includes(index) &&
      (argument.kind === "type" && argument.type.kind === "type-parameter" || argument.kind === "lifetime" && argument.lifetime.kind === "parameter") ? [index] : []);
    const genericCarrier = rustClassConstructorTargetType(view.sourceCarrier, bound);
    const selected = program.records.projectGenerics.get(definition, environment.genericParameterIndexes);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted constructor view requires its complete native generic requirements.", view.declaration);
    genericsFor(genericCarrier, selected, contexts.forInstance(definition, view.sourceCarrier), view.declaration);
    if (view.construction !== undefined && shape.construction === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted constructor view requires its exact native construction slot.", view.declaration);
    const fields = view.fields.map(field => {
      const storage = shape.fields[field.storageIndex];
      if (storage === undefined || field.callable === undefined && storage.property === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted constructor field requires its exact native callable or property slot.", field.declaration);
      return Object.freeze({ declaration: field.declaration, fileName: field.fileName, targetName: field.targetName, storage, callable: field.callable });
    });
    let files = constructors.get(view.declaration);
    if (files === undefined) { files = new Map(); constructors.set(view.declaration, files); }
    const emitted = files.get(view.ownerFileName) ?? [];
    emitted.push(Object.freeze({ sourceCarrier: view.sourceCarrier, targetCarrier: view.targetCarrier, genericCarrier,
      fields: Object.freeze(fields), construction: view.construction === undefined ? undefined
        : Object.freeze({ callable: view.construction, name: shape.construction!.targetName }) }));
    files.set(view.ownerFileName, emitted);
  }
  for (const [declaration, files] of constructors) for (const [file, views] of files) producer.constructorViews(declaration, file, views);
  const instances = new Map<Node, Map<string, RustClassStructuralViewEmission[]>>();
  const polymorphicDeclarations = new Set<Node>();
  const selectedCallables = new Set<RustClassValueCallable>();
  for (const view of program.classValues.instanceViewImplementations) {
    const requirements = program.declarationGenericRequirements.contractForStructuralView(view);
    if (requirements === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted structural view requires its sealed native generic requirements.", view.declaration);
    const shape = program.structuralShapes.definitionForCarrier(view.targetCarrier);
    const signature = shape === undefined ? undefined : structuralDispatchSignature(shape);
    if (shape === undefined || signature === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural view requires its complete physical getter and native dispatch contract.", view.declaration);
    const nativeTargetCarrier = shape.carrier;
    const fields = view.fields.map(member => {
      const result = member.field !== undefined ? member.field.resultCarrier : member.accessor?.read?.resultCarrier;
      if (result === undefined || member.readAdapter === undefined ||
        rustCallableProtocol(rustOptionElementCarrier(result) ?? result) === undefined) return member;
      const stored = member.field !== undefined ? program.callableValues.projectFieldStorage.get(member.declaration)
        : member.accessor?.read === undefined ? undefined
          : program.callableValues.nativeProducers.invocationResultFor(member.accessor.read.declaration);
      const instantiated = stored === undefined ? undefined
        : program.projectTypes.instantiateMemberCarrier(member.declaration, view.sourceCarrier, stored);
      if (instantiated === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted callable field view requires its exact instantiated physical storage.", member.declaration);
      const physical = mapRustTargetTypes(instantiated, carrier => {
        const reference = rustProducerErrorReference(carrier);
        if (reference === undefined) return carrier;
        const error = program.errorRegions.producerError(reference);
        if (error === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "An admitted callable field view requires its closed producer error.", member.declaration);
        return error;
      });
      const destination = shape.fields[member.storageIndex];
      if (destination === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted callable field view requires its canonical physical destination slot.", member.declaration);
      const readAdapter = selectRustCallableValueAdapter(physical, destination.carrier,
        program.projectTypes, program.typeDefinitions);
      if (readAdapter === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted callable field view requires its exact physical-to-getter adaptation.", member.declaration);
      return Object.freeze({ ...member, readAdapter });
    });
    const sourceLifetimes = new Set(rustTargetGenericReferences(view.sourceCarrier).lifetimeIdentities);
    const lifetimeNames = new Set(rustTargetGenericReferences(view.sourceCarrier).lifetimes.map(lifetime => lifetime.name));
    const nativeLifetimes = rustTargetGenericReferences({ kind: "tuple", elements: [...signature.carriers, ...signature.bases] }).lifetimes
      .filter((lifetime): lifetime is Extract<RustLifetimeRef, { readonly kind: "parameter" }> =>
        lifetime.kind === "parameter" && !sourceLifetimes.has(rustLifetimeKey(lifetime))).map(lifetime => {
        let name = lifetime.name;
        for (let index = 0; lifetimeNames.has(name); index += 1) name = `${lifetime.name}${index}`;
        lifetimeNames.add(name);
        return Object.freeze({ ...lifetime, name });
      });
    const nativeOutlives = fields.flatMap(member => {
      const field = shape.fields[member.storageIndex];
      const lifetime = field === undefined ? undefined : rustCallableProtocol(rustOptionElementCarrier(field.carrier) ?? field.carrier)?.lifetime;
      return field?.readonly !== true || member.readAdapter === undefined || lifetime?.kind !== "parameter" ? []
        : [Object.freeze({ carrier: member.readAdapter.sourceCarrier, lifetime })];
    });
    const published = Object.freeze({ ...view, nativeTargetCarrier, fields: Object.freeze(fields),
      nativeLifetimes: Object.freeze(nativeLifetimes), nativeOutlives: Object.freeze(nativeOutlives) });
    producer.structuralViewRequirements(published, requirements);
    const definition = program.projectTypes.definitionForDeclaration(view.declaration);
    const representation = program.objectRepresentations.representationFor(definition);
    if (definition === undefined || representation === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted structural view requires its exact source representation.", view.declaration);
    const polymorphic = program.projectTypes.isPolymorphic(definition);
    if (!polymorphicDeclarations.has(view.declaration)) {
      polymorphicDeclarations.add(view.declaration);
      producer.instanceViewPolymorphic(view.declaration, polymorphic);
    }
    let files = instances.get(view.declaration);
    if (files === undefined) { files = new Map(); instances.set(view.declaration, files); }
    const views = files.get(view.ownerFileName) ?? [];
    views.push(published);
    files.set(view.ownerFileName, views);
    for (const member of view.fields) {
      const callable = member.callable;
      if (callable === undefined || selectedCallables.has(callable)) continue;
      selectedCallables.add(callable);
      const protocol = rustCallableProtocol(callable.carrier);
      const variant = program.projectMethodDispatch.variantForMember(callable.declaration, []);
      const owner = program.projectTypes.definitionContainingDeclaration(callable.declaration);
      const relationship = owner === undefined ? undefined : program.projectTypes.relationship(callable.ownerCarrier, owner);
      if (protocol === undefined || polymorphic && (variant === undefined || relationship?.kind !== "related"))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural callable requires its exact native result and dispatch relationship.", callable.declaration);
      producer.instanceViewCallable(callable, { result: protocol.result, owner: relationship?.kind === "related" ? relationship.targetType : undefined, exactSlot: variant?.exactSlot });
    }
    const selected = program.records.projectGenerics.get(definition, undefined,
      representation.dispatchObjectLifetime === undefined ? [] : [representation.dispatchObjectLifetime]);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted structural view requires its complete native generic requirements.", view.declaration);
    genericsFor(view.sourceCarrier, selected, contexts.forInstance(definition, view.sourceCarrier), view.declaration);
  }
  for (const [declaration, files] of instances) for (const [file, views] of files) producer.instanceViews(declaration, file, views);
}
