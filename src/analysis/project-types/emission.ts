import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectEmissionProducer } from "../program/records/project-emission.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/model.js";
import { rustSourceTypeCarrierValue, rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import type { prepareRustProjectGenericMembership } from "./generic-membership.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustSourceItemIdentity } from "../../target-model/names/source-output-identities.js";
import type { RustProjectMemberSlotRole } from "../../target-model/types/project-types.js";

export function analyzeRustProjectEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly nodes: readonly Node[];
  readonly producer: RustProjectEmissionProducer;
  readonly memberships: ReturnType<typeof prepareRustProjectGenericMembership>;
}): void {
  const { program, producer } = input;
  producer.structuralGenerics(program.declarationGenericRequirements.contractForCarrier);
  const components = new Set([...program.structuralShapes.definitions.map(shape => shape.componentId),
    ...program.structuralShapes.unionDefinitions.map(union => union.componentId)]);
  for (const component of components) {
    producer.structuralDeclarations(component, program.structuralShapes.definitions.filter(shape => shape.componentId === component));
    producer.unionDeclarations(component, program.structuralShapes.unionDefinitions.filter(union => union.componentId === component));
  }
  const unionCarriers = [...program.structuralShapes.unionDefinitions.flatMap(union => union.sourceCarriers),
    ...program.structuralShapes.instances.map(shape => shape.carrier),
    ...program.projectTypes.definitions.map(definition => program.projectTypes.openCarrier(definition)),
    ...program.classValues.constructorViewImplementations.flatMap(view => [view.sourceCarrier, view.targetCarrier]),
    ...program.classValues.instanceViewImplementations.flatMap(view => [view.sourceCarrier, view.targetCarrier]),
    ...input.nodes.flatMap(node => { const carrier = program.records.runtimeCarrier.get(node)?.carrier; return carrier === undefined ? [] : [carrier]; })];
  const seenCarriers = new Set<string>();
  for (const context of program.physicalEmissionContexts.contexts) unionCarriers.push(...context.operands);
  for (const operand of program.physicalEmissionContexts.operands) unionCarriers.push(operand.carrier,
    ...(operand.destination === undefined ? [] : [operand.destination]));
  for (const protocol of program.callableValues.native.protocols) unionCarriers.push(protocol.trait, ...protocol.method.parameters, protocol.result);
  const sourceTypes = new Map<string, Set<string>>();
  const sourceType = (fileName: string, typeName: string): void => {
    const selected = sourceTypes.get(fileName) ?? new Set<string>();
    if (selected.has(typeName)) return;
    selected.add(typeName);
    sourceTypes.set(fileName, selected);
    const protocol = program.callableValues.native.protocolForSourceItem(fileName, typeName);
    const targetName = protocol === undefined ? program.names.nameForSourceType(fileName, typeName) : protocol.targetName;
    if (targetName !== undefined) producer.sourceType(fileName, typeName, { targetName, native: protocol !== undefined });
  };
  for (let index = 0; index < unionCarriers.length; index++) {
    const carrier = unionCarriers[index]!;
    const key = closedMetadataKey(carrier);
    if (seenCarriers.has(key)) continue;
    seenCarriers.add(key);
    const source = rustSourceTypeCarrierValue(carrier) ?? rustSourceUnionCarrierValue(carrier);
    if (source !== undefined) sourceType(source.fileName, source.typeName);
    if (carrier.kind === "trait-ref" && carrier.sourceItem !== undefined) sourceType(carrier.sourceItem.fileName, carrier.sourceItem.typeName);
    unionCarriers.push(...rustTargetTypeChildren(carrier));
  }
  for (const definition of program.projectTypes.definitions) {
    const representation = program.objectRepresentations.representationFor(definition);
    producer.definition(definition, representation);
    const inheritedError = program.projectTypes.inheritedExternalBaseForDefinition(definition)?.base;
    producer.error(definition, { superTrait: program.projectTypes.externalBaseForDefinition(definition)?.programError === true,
      sourceError: program.projectTypes.sourceErrorDefinitions.includes(definition), variant: program.projectTypes.programErrorVariant(definition),
      carrier: program.projectTypes.openCarrier(definition),
      inherited: inheritedError?.programError === true, fields: inheritedError?.programError !== true ? Object.freeze([])
        : Object.freeze((["name", "message", "stack"] as const).map(name => {
          const field = inheritedError.fields.find(field => field.sourceName === name);
          if (field === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native error requires its exact provider field identity.", definition.declaration);
          return Object.freeze({ name, declaration: field.declaration, read: program.projectTypes.memberSlotName(field.declaration, "read"), write: program.projectTypes.memberSlotName(field.declaration, "write") });
        })) });
    producer.projections(definition, program.declarationGenericRequirements.projectionImplementationsFor(definition));
    const component = program.sourcePackageComponents.componentForFile(definition.fileName);
    const publicState = component !== undefined && (component.publishesImplementationAbi ||
      program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId)
        .includes(rustSourceItemIdentity(definition.fileName, definition.targetPath)));
    producer.stateConstruction(definition, { baseName: program.projectTypes.baseStateFieldName(definition), visibility: publicState ? "public" : "crate" });
    const indexes = new Map<string, readonly number[]>();
    const all = definition.genericParameters.map((_, index) => index);
    indexes.set(JSON.stringify(all), all);
    const environment = program.classValues.forDeclaration(definition.declaration)?.environment;
    if (environment !== undefined) indexes.set(JSON.stringify(environment.genericParameterIndexes), environment.genericParameterIndexes);
    const source = program.declarationGenericRequirements.contractFor(definition.declaration);
    if (source === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native project definition requires its complete generic contract.", definition.declaration);
    const outlives: (readonly RustLifetimeRef[])[] = [[]];
    if (representation?.dispatchObjectLifetime !== undefined) outlives.push([representation.dispatchObjectLifetime]);
    for (const selectedIndexes of indexes.values()) {
      const { parameters, optionalStorage, inScope } = input.memberships.forDeclaration(definition, selectedIndexes);
      for (const body of [undefined, true] as const) {
        const associated = body === undefined ? source : program.declarationGenericRequirements.contractFor(definition.declaration, body);
        if (associated === undefined) continue;
        for (const required of outlives) producer.generics(definition, selectedIndexes, required, body, {
          parameters, optionalStorage, outlives: Object.freeze(required),
          associated: Object.freeze(associated.associatedTypes.filter(requirement => inScope(requirement.carrier))),
          projections: Object.freeze(associated.projectProjections.filter(requirement => inScope(requirement.sourceCarrier) && inScope(requirement.targetCarrier))),
          markerName: program.projectTypes.stateMarkerFieldName(definition),
        });
      }
    }
  }
  for (const node of new Set(input.nodes)) {
    const owner = program.projectTypes.definitionContainingDeclaration(node);
    if (owner !== undefined) producer.member(node, owner);
    const slots = new Map<RustProjectMemberSlotRole, string>();
    for (const role of ["read", "write", "capture", "virtual", "exact", "method-write", "static"] as const) {
      const name = program.projectTypes.memberSlotName(node, role);
      if (name !== undefined) slots.set(role, name);
    }
    producer.memberSlots(node, slots);
  }
}
