import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustObjectRepresentation } from "../../../target-model/records/object-representation.js";
import type { RustProjectEmissionRecords, RustProjectGenericEmission } from "../../../target-model/records/project-emission.js";
import type { RustLifetimeRef } from "../../../target-model/lifetimes/model.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";
import type { RustShapeGenericRequirementContract } from "../../../target-model/records/generic-requirements.js";

export interface RustProjectEmissionProducer {
  structuralGenerics(reader: (carrier: TargetTypeRef) => RustShapeGenericRequirementContract | undefined): void;
  readonly records: RustProjectEmissionRecords;
  definition(definition: RustProjectTypeDefinition, representation: RustObjectRepresentation | undefined): void;
  member(declaration: Node, definition: RustProjectTypeDefinition): void;
  generics(definition: RustProjectTypeDefinition, indexes: readonly number[], outlives: readonly RustLifetimeRef[], body: true | undefined, value: RustProjectGenericEmission): void;
}

export function createRustProjectEmissionProducer(assertOpen: () => void): RustProjectEmissionProducer {
  let structuralGenerics: ((carrier: TargetTypeRef) => RustShapeGenericRequirementContract | undefined) | undefined;
  const definitions = new Map<string, Map<string, RustProjectTypeDefinition>>();
  const declarations = new WeakMap<Node, RustProjectTypeDefinition>();
  const members = new WeakMap<Node, RustProjectTypeDefinition>();
  const representations = new WeakMap<RustProjectTypeDefinition, RustObjectRepresentation>();
  const generics = new WeakMap<RustProjectTypeDefinition, Map<string, RustProjectGenericEmission>>();
  const genericKey = (indexes: readonly number[], outlives: readonly RustLifetimeRef[], body: true | undefined): string =>
    JSON.stringify([indexes, outlives.map(rustLifetimeKey), body === true]);
  return Object.freeze({ records: Object.freeze({
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
      if (source.has(definition.targetPath)) failTargetAnalysisInvariant("tsonic-rust", "A native project definition requires one exact carrier identity.", definition.declaration);
      source.set(definition.targetPath, definition);
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
