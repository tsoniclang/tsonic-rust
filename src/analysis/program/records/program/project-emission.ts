import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition, RustProjectMemberSlotRole } from "../../../../target-model/types/project-types.js";
import type { RustObjectRepresentation } from "../../../../target-model/records/objects/object-representation.js";
import type { RustProjectEmissionRecords, RustProjectGenericEmission } from "../../../../target-model/records/program/project-emission.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/model.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import { rustSourceTypeCarrierValue } from "../../../../target-model/types/index.js";
import type { RustShapeGenericRequirementContract } from "../../../../target-model/records/types/generic-requirements.js";
import type { RustStructuralShapeDefinition } from "../../../../target-model/records/objects/structural-shapes.js";
import type { RustGeneratedUnionDefinition } from "../../../../target-model/records/types/generated-unions.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustCheckedProjectProjectionEmission } from "../../../../target-model/records/program/project-emission.js";
import type { RustProjectProjectionImplementation } from "../../../../target-model/records/objects/project-projections.js";
import type { RustProjectErrorEmission } from "../../../../target-model/records/program/project-emission.js";

export interface RustProjectEmissionProducer {
  optionalType(carrier: TargetTypeRef, indexes: readonly number[] | undefined, values: readonly TargetTypeRef[]): void;
  optionalCall(node: Node, values: readonly TargetTypeRef[]): void;
  sourceType(fileName: string, typeName: string, value: { readonly targetName: string; readonly native: boolean }): void;
  error(definition: RustProjectTypeDefinition, value: RustProjectErrorEmission): void;
  memberSlots(declaration: Node, values: ReadonlyMap<RustProjectMemberSlotRole, string>): void;
  projections(definition: RustProjectTypeDefinition, values: readonly RustProjectProjectionImplementation[]): void;
  stateConstruction(definition: RustProjectTypeDefinition, value: { readonly baseName: string; readonly visibility: "public" | "crate" }): void;
  checkedProjection(carrier: TargetTypeRef, value: RustCheckedProjectProjectionEmission): void;
  structuralShapes(reader: (carrier: TargetTypeRef | undefined) => RustStructuralShapeDefinition | undefined): void;
  structuralDeclarations(component: string, values: readonly RustStructuralShapeDefinition[]): void;
  union(carrier: TargetTypeRef, value: RustGeneratedUnionDefinition): void;
  unionDeclarations(component: string, values: readonly RustGeneratedUnionDefinition[]): void;
  structuralGenerics(reader: (carrier: TargetTypeRef) => RustShapeGenericRequirementContract | undefined): void;
  readonly records: RustProjectEmissionRecords;
  definition(definition: RustProjectTypeDefinition, representation: RustObjectRepresentation | undefined): void;
  member(declaration: Node, definition: RustProjectTypeDefinition): void;
  generics(definition: RustProjectTypeDefinition, indexes: readonly number[], outlives: readonly RustLifetimeRef[], body: true | undefined, value: RustProjectGenericEmission): void;
}

export function createRustProjectEmissionProducer(assertOpen: () => void): RustProjectEmissionProducer {
  let structuralGenerics: ((carrier: TargetTypeRef) => RustShapeGenericRequirementContract | undefined) | undefined;
  let structuralShapes: ((carrier: TargetTypeRef | undefined) => RustStructuralShapeDefinition | undefined) | undefined;
  const definitions = new Map<string, Map<string, RustProjectTypeDefinition>>();
  const declarations = new WeakMap<Node, RustProjectTypeDefinition>();
  const members = new WeakMap<Node, RustProjectTypeDefinition>();
  const representations = new WeakMap<RustProjectTypeDefinition, RustObjectRepresentation>();
  const generics = new WeakMap<RustProjectTypeDefinition, Map<string, RustProjectGenericEmission>>();
  const structuralDeclarations = new Map<string, readonly RustStructuralShapeDefinition[]>();
  const unions = new Map<string, RustGeneratedUnionDefinition>();
  const unionDeclarations = new Map<string, readonly RustGeneratedUnionDefinition[]>();
  const stateConstruction = new WeakMap<RustProjectTypeDefinition, { readonly baseName: string; readonly visibility: "public" | "crate" }>();
  const checkedProjections = new Map<string, RustCheckedProjectProjectionEmission>();
  const projections = new WeakMap<RustProjectTypeDefinition, readonly RustProjectProjectionImplementation[]>();
  const slots = new WeakMap<Node, ReadonlyMap<RustProjectMemberSlotRole, string>>();
  const errors = new WeakMap<RustProjectTypeDefinition, RustProjectErrorEmission>();
  const sourceTypes = new Map<string, Map<string, { readonly targetName: string; readonly native: boolean }>>();
  const optionalTypes = new Map<string, readonly TargetTypeRef[]>();
  const optionalCalls = new WeakMap<Node, readonly TargetTypeRef[]>();
  const genericKey = (indexes: readonly number[], outlives: readonly RustLifetimeRef[], body: true | undefined): string =>
    JSON.stringify([indexes, outlives.map(rustLifetimeKey), body === true]);
  return Object.freeze({ records: Object.freeze({
    optionalStorageTypeArguments: Object.freeze({ get: (carrier: TargetTypeRef, indexes?: readonly number[]) => optionalTypes.get(closedMetadataKey([carrier, indexes ?? null])) }),
    optionalStorageCallArguments: Object.freeze({ get: (node: Node) => optionalCalls.get(node) }),
    sourceTypeIdentity: Object.freeze({ get: (fileName: string, typeName: string) => sourceTypes.get(fileName)?.get(typeName) }),
    projectError: Object.freeze({ get: (definition: RustProjectTypeDefinition) => errors.get(definition) }),
    projectMemberSlot: Object.freeze({ get: (declaration: Node, role: RustProjectMemberSlotRole) => slots.get(declaration)?.get(role) }),
    projectProjectionImplementations: Object.freeze({ get: (definition: RustProjectTypeDefinition) => projections.get(definition) }),
    projectStateConstruction: Object.freeze({ get: (definition: RustProjectTypeDefinition) => stateConstruction.get(definition) }),
    checkedProjectProjection: Object.freeze({ get: (carrier: TargetTypeRef) => checkedProjections.get(closedMetadataKey(carrier)) }),
    structuralShape: Object.freeze({ get: (carrier: TargetTypeRef | undefined) => {
      if (structuralShapes === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native structural lookup requires its sealed canonical publication.");
      return structuralShapes(carrier);
    } }),
    structuralDeclarations: Object.freeze({ get: (component: string) => structuralDeclarations.get(component) }),
    sourceUnion: Object.freeze({ get: (carrier: TargetTypeRef) => unions.get(closedMetadataKey(carrier)) }),
    sourceUnionDeclarations: Object.freeze({ get: (component: string) => unionDeclarations.get(component) }),
    structuralGenerics: Object.freeze({ get: (carrier: TargetTypeRef) => structuralGenerics?.(carrier) }),
    projectType: Object.freeze({ get: (carrier: TargetTypeRef | undefined) => {
      const source = rustSourceTypeCarrierValue(carrier);
      return source === undefined ? undefined : definitions.get(source.fileName)?.get(source.typeName);
    } }),
    projectDeclaration: Object.freeze({ get: (declaration: Node | undefined) => declaration === undefined ? undefined : declarations.get(declaration) }),
    projectMemberOwner: Object.freeze({ get: (declaration: Node | undefined) => declaration === undefined ? undefined : members.get(declaration) }),
    objectRepresentation: Object.freeze({ get: (definition: RustProjectTypeDefinition | undefined) => definition === undefined ? undefined : representations.get(definition) }),
    projectGenerics: Object.freeze({ get: (definition: RustProjectTypeDefinition, indexes?: readonly number[], outlives: readonly RustLifetimeRef[] = [], body?: true) =>
      generics.get(definition)?.get(genericKey(indexes ?? definition.genericParameters.map((_, index) => index), outlives, body)) }),
  }),
    optionalType(carrier: TargetTypeRef, indexes: readonly number[] | undefined, values: readonly TargetTypeRef[]): void {
      assertOpen();
      const key = closedMetadataKey([carrier, indexes ?? null]);
      if (optionalTypes.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native optional storage type argument set has one exact owner.");
      optionalTypes.set(key, Object.freeze(values));
    },
    optionalCall(node: Node, values: readonly TargetTypeRef[]): void {
      assertOpen();
      if (optionalCalls.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A native optional storage call argument set has one exact owner.", node);
      optionalCalls.set(node, Object.freeze(values));
    },
    sourceType(fileName: string, typeName: string, value: { readonly targetName: string; readonly native: boolean }): void {
      assertOpen();
      const selected = sourceTypes.get(fileName) ?? new Map<string, { readonly targetName: string; readonly native: boolean }>();
      if (selected.has(typeName)) failTargetAnalysisInvariant("tsonic-rust", "A checked source type identity has one native emission owner.");
      selected.set(typeName, Object.freeze(value));
      sourceTypes.set(fileName, selected);
    },
    error(definition: RustProjectTypeDefinition, value: RustProjectErrorEmission): void {
      assertOpen();
      if (errors.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native project error has one exact field and inheritance owner.", definition.declaration);
      errors.set(definition, Object.freeze(value));
    },
    memberSlots(declaration: Node, values: ReadonlyMap<RustProjectMemberSlotRole, string>): void {
      assertOpen();
      if (slots.has(declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native member slot inventory has one source owner.", declaration);
      slots.set(declaration, new Map(values));
    },
    projections(definition: RustProjectTypeDefinition, values: readonly RustProjectProjectionImplementation[]): void {
      assertOpen();
      if (projections.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native project projection inventory has one source owner.", definition.declaration);
      projections.set(definition, Object.freeze(values));
    },
    stateConstruction(definition: RustProjectTypeDefinition, value: { readonly baseName: string; readonly visibility: "public" | "crate" }): void {
      assertOpen();
      if (stateConstruction.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native state constructor has one source owner.", definition.declaration);
      stateConstruction.set(definition, Object.freeze(value));
    },
    checkedProjection(carrier: TargetTypeRef, value: RustCheckedProjectProjectionEmission): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (checkedProjections.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native checked projection has one exact carrier owner.");
      checkedProjections.set(key, value);
    },
    structuralShapes(reader: (carrier: TargetTypeRef | undefined) => RustStructuralShapeDefinition | undefined): void {
      assertOpen();
      if (structuralShapes !== undefined) failTargetAnalysisInvariant("tsonic-rust", "The sealed canonical structural lookup is published exactly once.");
      structuralShapes = reader;
    },
    structuralDeclarations(component: string, values: readonly RustStructuralShapeDefinition[]): void {
      assertOpen();
      if (structuralDeclarations.has(component)) failTargetAnalysisInvariant("tsonic-rust", "A source component has one structural declaration inventory.");
      structuralDeclarations.set(component, Object.freeze(values));
    },
    union(carrier: TargetTypeRef, value: RustGeneratedUnionDefinition): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (unions.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An exact source union has one native declaration producer.");
      unions.set(key, value);
    },
    unionDeclarations(component: string, values: readonly RustGeneratedUnionDefinition[]): void {
      assertOpen();
      if (unionDeclarations.has(component)) failTargetAnalysisInvariant("tsonic-rust", "A source component has one union declaration inventory.");
      unionDeclarations.set(component, Object.freeze(values));
    },
    structuralGenerics(reader: (carrier: TargetTypeRef) => RustShapeGenericRequirementContract | undefined): void {
      assertOpen();
      if (structuralGenerics !== undefined) failTargetAnalysisInvariant("tsonic-rust", "The closed structural generic lookup is published exactly once.");
      structuralGenerics = reader;
    },
    definition(definition: RustProjectTypeDefinition, representation: RustObjectRepresentation | undefined): void {
      assertOpen();
      if (declarations.has(definition.declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native project definition is published exactly once.", definition.declaration);
      let source = definitions.get(definition.fileName);
      if (source === undefined) { source = new Map(); definitions.set(definition.fileName, source); }
      if (source.has(definition.sourceName)) failTargetAnalysisInvariant("tsonic-rust", "A native project definition requires one exact carrier identity.", definition.declaration);
      source.set(definition.sourceName, definition);
      declarations.set(definition.declaration, definition);
      if (representation !== undefined) representations.set(definition, representation);
    },
    member(declaration: Node, definition: RustProjectTypeDefinition): void {
      assertOpen();
      if (members.has(declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native project member has one containing definition.", declaration);
      members.set(declaration, definition);
    },
    generics(definition: RustProjectTypeDefinition, indexes: readonly number[], outlives: readonly RustLifetimeRef[], body: true | undefined, value: RustProjectGenericEmission): void {
      assertOpen();
      let requests = generics.get(definition);
      if (requests === undefined) { requests = new Map(); generics.set(definition, requests); }
      const key = genericKey(indexes, outlives, body);
      if (requests.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native project generic context is published exactly once.", definition.declaration);
      requests.set(key, Object.freeze(value));
    },
  });
}
