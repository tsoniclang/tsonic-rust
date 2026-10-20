import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectTypeDefinition, RustProjectInstanceContract } from "../../../target-model/types/project-types.js";
import type { RustProjectClassRecords, RustProjectCallableSignature, RustProjectFieldEmission, RustProjectMethodPropertyEmission, RustProjectClassStateEmission } from "../../../target-model/records/project-classes.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

export interface RustProjectClassProducer {
  contracts(carrier: TargetTypeRef, values: readonly RustProjectInstanceContract[]): void;
  alias(source: TargetTypeRef, target: TargetTypeRef, value: { readonly same: boolean; readonly polymorphic: boolean }): void;
  readonly records: RustProjectClassRecords;
  members(definition: RustProjectTypeDefinition, members: readonly Node[], accessors: readonly { readonly declaration: Node; readonly role: "read" | "write" }[]): void;
  instance(definition: RustProjectTypeDefinition, carrier: TargetTypeRef, fields: readonly RustProjectFieldEmission[], properties: readonly RustProjectMethodPropertyEmission[]): void;
  state(definition: RustProjectTypeDefinition, carrier: TargetTypeRef, layers: readonly RustProjectClassStateEmission[]): void;
  paths(definition: RustProjectTypeDefinition, fields: ReadonlyMap<Node, readonly string[]>, properties: ReadonlyMap<Node, readonly string[]>): void;
  implementations(definition: RustProjectTypeDefinition, members: ReadonlyMap<Node, Node>): void;
  callable(member: Node, value: RustProjectCallableSignature): void;
}

export function createRustProjectClassProducer(assertOpen: () => void): RustProjectClassProducer {
  const members = new WeakMap<RustProjectTypeDefinition, readonly Node[]>();
  const accessors = new WeakMap<RustProjectTypeDefinition, readonly { readonly declaration: Node; readonly role: "read" | "write" }[]>();
  const fields = new WeakMap<RustProjectTypeDefinition, Map<string, readonly RustProjectFieldEmission[]>>();
  const properties = new WeakMap<RustProjectTypeDefinition, Map<string, readonly RustProjectMethodPropertyEmission[]>>();
  const states = new WeakMap<RustProjectTypeDefinition, Map<string, readonly RustProjectClassStateEmission[]>>();
  const fieldPaths = new WeakMap<RustProjectTypeDefinition, ReadonlyMap<Node, readonly string[]>>();
  const propertyPaths = new WeakMap<RustProjectTypeDefinition, ReadonlyMap<Node, readonly string[]>>();
  const implementations = new WeakMap<RustProjectTypeDefinition, ReadonlyMap<Node, Node>>();
  const callables = new WeakMap<Node, RustProjectCallableSignature>();
  const aliases = new Map<string, { readonly same: boolean; readonly polymorphic: boolean }>();
  const contracts = new Map<string, readonly RustProjectInstanceContract[]>();
  return Object.freeze({ records: Object.freeze({
    projectInstanceContracts: Object.freeze({ get: (carrier: TargetTypeRef) => contracts.get(closedMetadataKey(carrier)) }),
    receiverAlias: Object.freeze({ get: (source: TargetTypeRef, target: TargetTypeRef) => aliases.get(closedMetadataKey([source, target])) }),
    projectClassMembers: Object.freeze({ get: (definition: RustProjectTypeDefinition) => members.get(definition) }),
    projectClassAccessors: Object.freeze({ get: (definition: RustProjectTypeDefinition) => accessors.get(definition) }),
    projectClassFields: Object.freeze({ get: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => fields.get(definition)?.get(closedMetadataKey(carrier)) }),
    projectMethodProperties: Object.freeze({ get: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => properties.get(definition)?.get(closedMetadataKey(carrier)) }),
    projectClassState: Object.freeze({ get: (definition: RustProjectTypeDefinition, carrier: TargetTypeRef) => states.get(definition)?.get(closedMetadataKey(carrier)) }),
    projectFieldStoragePath: Object.freeze({ get: (definition: RustProjectTypeDefinition, member: Node) => fieldPaths.get(definition)?.get(member) }),
    projectMethodPropertyPath: Object.freeze({ get: (definition: RustProjectTypeDefinition, member: Node) => propertyPaths.get(definition)?.get(member) }),
    projectMemberImplementation: Object.freeze({ get: (definition: RustProjectTypeDefinition, member: Node) => implementations.get(definition)?.get(member) }),
    projectCallableSignature: Object.freeze({ get: (member: Node) => callables.get(member) }),
  }),
    contracts(carrier: TargetTypeRef, values: readonly RustProjectInstanceContract[]): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (contracts.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native project instance has one exact contract graph owner.");
      contracts.set(key, Object.freeze(values));
    },
    alias(source: TargetTypeRef, target: TargetTypeRef, value: { readonly same: boolean; readonly polymorphic: boolean }): void {
      assertOpen();
      const key = closedMetadataKey([source, target]);
      if (aliases.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native receiver alias has one exact source relationship owner.");
      aliases.set(key, Object.freeze(value));
    },
    members(definition: RustProjectTypeDefinition, values: readonly Node[], selected: readonly { readonly declaration: Node; readonly role: "read" | "write" }[]): void {
      assertOpen();
      if (members.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native class member inventory has one source owner.", definition.declaration);
      members.set(definition, Object.freeze(values));
      accessors.set(definition, Object.freeze(selected));
    },
    instance(definition: RustProjectTypeDefinition, carrier: TargetTypeRef, values: readonly RustProjectFieldEmission[], selected: readonly RustProjectMethodPropertyEmission[]): void {
      assertOpen();
      let instances = fields.get(definition);
      let propertyInstances = properties.get(definition);
      if (instances === undefined) { instances = new Map(); fields.set(definition, instances); }
      if (propertyInstances === undefined) { propertyInstances = new Map(); properties.set(definition, propertyInstances); }
      const key = closedMetadataKey(carrier);
      if (instances.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native class instance has one exact field owner.", definition.declaration);
      instances.set(key, Object.freeze(values));
      propertyInstances.set(key, Object.freeze(selected));
    },
    state(definition: RustProjectTypeDefinition, carrier: TargetTypeRef, layers: readonly RustProjectClassStateEmission[]): void {
      assertOpen();
      let instances = states.get(definition);
      if (instances === undefined) { instances = new Map(); states.set(definition, instances); }
      const key = closedMetadataKey(carrier);
      if (instances.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native class instance has one state lineage owner.", definition.declaration);
      instances.set(key, Object.freeze(layers));
    },
    paths(definition: RustProjectTypeDefinition, values: ReadonlyMap<Node, readonly string[]>, selected: ReadonlyMap<Node, readonly string[]>): void {
      assertOpen();
      if (fieldPaths.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native class has one field-path owner.", definition.declaration);
      fieldPaths.set(definition, values);
      propertyPaths.set(definition, selected);
    },
    implementations(definition: RustProjectTypeDefinition, values: ReadonlyMap<Node, Node>): void {
      assertOpen();
      if (implementations.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native class has one member-correspondence owner.", definition.declaration);
      implementations.set(definition, values);
    },
    callable(member: Node, value: RustProjectCallableSignature): void {
      assertOpen();
      if (callables.has(member)) failTargetAnalysisInvariant("tsonic-rust", "A native project callable has one exact signature owner.", member);
      callables.set(member, Object.freeze(value));
    },
  });
}
