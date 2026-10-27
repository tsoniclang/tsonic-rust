import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition, RustProjectInstanceContract } from "../../../../target-model/types/project-types.js";
import type { RustProjectClassRecords, RustProjectCallableSignature, RustProjectFieldEmission, RustProjectMethodPropertyEmission, RustProjectClassStateEmission } from "../../../../target-model/records/objects/project-classes.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustProjectCallableAdapterIndex } from "../../../../target-model/records/objects/project-classes.js";
import type { RustProjectRootEmission } from "../../../../target-model/records/objects/project-classes.js";
import type { RustProjectDispatchEmission } from "../../../../target-model/records/objects/project-classes.js";
import type { RustProjectPolymorphicEmission } from "../../../../target-model/records/objects/project-classes.js";

export interface RustProjectClassProducer {
  polymorphic(declaration: Node, value: RustProjectPolymorphicEmission): void;
  dispatch(definition: RustProjectTypeDefinition, value: RustProjectDispatchEmission): void;
  root(carrier: TargetTypeRef, value: RustProjectRootEmission): void;
  relationship(receiver: TargetTypeRef, owner: RustProjectTypeDefinition, value: TargetTypeRef): void;
  arguments(member: Node, arguments_: readonly TargetTypeRef[], receiver: TargetTypeRef, values: readonly TargetTypeRef[]): void;
  thisReferences(method: Node, values: ReadonlyMap<Node, readonly Node[]>): void;
  forwarder(contract: Node, implementation: Node, value: "adapter" | "direct"): void;
  adapters(concrete: Node, values: RustProjectCallableAdapterIndex): void;
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
  const adapters = new WeakMap<Node, RustProjectCallableAdapterIndex>();
  const relationships = new WeakMap<RustProjectTypeDefinition, Map<string, TargetTypeRef>>();
  const arguments_ = new WeakMap<Node, Map<string, readonly TargetTypeRef[]>>();
  const thisReferences = new WeakMap<Node, ReadonlyMap<Node, readonly Node[]>>();
  const forwarders = new WeakMap<Node, WeakMap<Node, "adapter" | "direct">>();
  const roots = new Map<string, RustProjectRootEmission>();
  const dispatches = new WeakMap<RustProjectTypeDefinition, RustProjectDispatchEmission>();
  const polymorphic = new WeakMap<Node, RustProjectPolymorphicEmission>();
  return Object.freeze({ records: Object.freeze({
    projectPolymorphicEmission: Object.freeze({ get: (declaration: Node) => polymorphic.get(declaration) }),
    projectDispatchEmission: Object.freeze({ get: (definition: RustProjectTypeDefinition) => dispatches.get(definition) }),
    projectRootEmission: Object.freeze({ get: (carrier: TargetTypeRef) => roots.get(closedMetadataKey(carrier)) }),
    projectRelationship: Object.freeze({ get: (receiver: TargetTypeRef, owner: RustProjectTypeDefinition) => relationships.get(owner)?.get(closedMetadataKey(receiver)) }),
    projectMethodArguments: Object.freeze({ get: (member: Node, selected: readonly TargetTypeRef[], receiver: TargetTypeRef) => arguments_.get(member)?.get(closedMetadataKey([selected, receiver])) }),
    projectThisReferences: Object.freeze({ get: (method: Node) => thisReferences.get(method) }),
    projectForwarder: Object.freeze({ get: (contract: Node, implementation: Node) => forwarders.get(contract)?.get(implementation) }),
    projectCallableAdapter: Object.freeze({ get: (concrete: Node, contract: Node, implementation: Node, slot: string) => adapters.get(concrete)?.get(contract)?.get(implementation)?.get(slot) }),
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
    polymorphic(declaration: Node, value: RustProjectPolymorphicEmission): void {
      assertOpen();
      if (polymorphic.has(declaration)) failTargetAnalysisInvariant("tsonic-rust", "A polymorphic native declaration has one exact emission owner.", declaration);
      polymorphic.set(declaration, Object.freeze(value));
    },
    dispatch(definition: RustProjectTypeDefinition, value: RustProjectDispatchEmission): void {
      assertOpen();
      if (dispatches.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A native project dispatch trait has one exact source owner.", definition.declaration);
      dispatches.set(definition, Object.freeze(value));
    },
    root(carrier: TargetTypeRef, value: RustProjectRootEmission): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (roots.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native class instance has one exact root implementation owner.");
      roots.set(key, Object.freeze(value));
    },
    relationship(receiver: TargetTypeRef, owner: RustProjectTypeDefinition, value: TargetTypeRef): void {
      assertOpen();
      let instances = relationships.get(owner);
      if (instances === undefined) { instances = new Map(); relationships.set(owner, instances); }
      const key = closedMetadataKey(receiver);
      if (instances.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native receiver has one exact instantiated owner relationship.", owner.declaration);
      instances.set(key, value);
    },
    arguments(member: Node, selected: readonly TargetTypeRef[], receiver: TargetTypeRef, values: readonly TargetTypeRef[]): void {
      assertOpen();
      let requests = arguments_.get(member);
      if (requests === undefined) { requests = new Map(); arguments_.set(member, requests); }
      const key = closedMetadataKey([selected, receiver]);
      if (requests.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native method specialization has one exact receiver instantiation owner.", member);
      requests.set(key, Object.freeze(values));
    },
    thisReferences(method: Node, values: ReadonlyMap<Node, readonly Node[]>): void {
      assertOpen();
      if (thisReferences.has(method)) failTargetAnalysisInvariant("tsonic-rust", "A native method has one exact receiver-reference owner.", method);
      thisReferences.set(method, values);
    },
    forwarder(contract: Node, implementation: Node, value: "adapter" | "direct"): void {
      assertOpen();
      let implementations = forwarders.get(contract);
      if (implementations === undefined) { implementations = new WeakMap(); forwarders.set(contract, implementations); }
      if (implementations.has(implementation)) failTargetAnalysisInvariant("tsonic-rust", "A native contract implementation has one error-forwarding owner.", implementation);
      implementations.set(implementation, value);
    },
    adapters(concrete: Node, values: RustProjectCallableAdapterIndex): void {
      assertOpen();
      if (adapters.has(concrete)) failTargetAnalysisInvariant("tsonic-rust", "A concrete native class has one exact callable-adapter index owner.", concrete);
      adapters.set(concrete, values);
    },
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
