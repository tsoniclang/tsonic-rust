import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFrameBindingEmission, RustFrameDefinitionEmission, RustFrameEmissionRecords, RustFrameInputAdmission } from "../../../../target-model/records/callables/frame-emission.js";
import type { RustFrameCallableBinding, RustFrameCallableDefinition, RustFrameCallableImplementation } from "../../../../target-model/records/callables/frame-callables.js";
import type { RustClassFrameFieldEmission } from "../../../../target-model/records/callables/frame-emission.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustFrameTypeEmission } from "../../../../target-model/records/callables/frame-emission.js";

export interface RustFrameEmissionProducer {
  type(carrier: TargetTypeRef, value: RustFrameTypeEmission): void;
  bindingDeclaration(subject: Node, value: RustFrameCallableBinding): void;
  owner(subject: Node, value: RustFrameCallableDefinition): void;
  classField(subject: Node, carrier: TargetTypeRef, value: RustClassFrameFieldEmission): void;
  readonly records: RustFrameEmissionRecords;
  binding(subject: RustFrameCallableBinding, value: RustFrameBindingEmission): void;
  input(subject: Node, value: ReadonlyMap<RustFrameCallableDefinition, RustFrameInputAdmission>): void;
  receiver(subject: Node, owner: Node): void;
  implementation(subject: Node, value: RustFrameCallableImplementation): void;
  scope(subject: Node, values: readonly RustFrameCallableDefinition[]): void;
  definition(subject: RustFrameCallableDefinition, value: RustFrameDefinitionEmission): void;
  sourceFile(subject: SourceFile, values: readonly RustFrameCallableDefinition[]): void;
}

export function createRustFrameEmissionProducer(assertOpen: () => void): RustFrameEmissionProducer {
  const definitions = new WeakMap<RustFrameCallableDefinition, RustFrameDefinitionEmission>();
  const sources = new WeakMap<SourceFile, readonly RustFrameCallableDefinition[]>();
  const bindings = new WeakMap<RustFrameCallableBinding, RustFrameBindingEmission>();
  const inputs = new WeakMap<Node, ReadonlyMap<RustFrameCallableDefinition, RustFrameInputAdmission>>();
  const receivers = new WeakMap<Node, Node>();
  const implementations = new WeakMap<Node, RustFrameCallableImplementation>();
  const scopes = new WeakMap<Node, readonly RustFrameCallableDefinition[]>();
  const bindingDeclarations = new WeakMap<Node, RustFrameCallableBinding>();
  const owners = new WeakMap<Node, RustFrameCallableDefinition>();
  const fields = new WeakMap<Node, Map<string, RustClassFrameFieldEmission>>();
  const types = new Map<string, RustFrameTypeEmission>();
  return Object.freeze({ records: Object.freeze({
    frameType: Object.freeze({ get: (carrier: TargetTypeRef) => types.get(closedMetadataKey(carrier)) }),
    frameBindingDeclaration: Object.freeze({ get: (subject: Node) => bindingDeclarations.get(subject) }),
    frameOwner: Object.freeze({ get: (subject: Node) => owners.get(subject) }),
    classFrameField: Object.freeze({ get: (subject: Node, carrier: TargetTypeRef) => fields.get(subject)?.get(closedMetadataKey(carrier)) }),
    frameBinding: Object.freeze({ get: (subject: RustFrameCallableBinding) => bindings.get(subject) }),
    frameInput: Object.freeze({ get: (subject: Node) => inputs.get(subject) }),
    frameReceiverOwner: Object.freeze({ get: (subject: Node) => receivers.get(subject) }),
    frameImplementation: Object.freeze({ get: (subject: Node) => implementations.get(subject) }),
    frameScopes: Object.freeze({ get: (subject: Node) => scopes.get(subject) }),
    frameDeclaration: Object.freeze({ get: (subject: RustFrameCallableDefinition) => definitions.get(subject) }),
    frameDeclarations: Object.freeze({ get: (subject: SourceFile) => sources.get(subject) }),
  }),
    type(carrier: TargetTypeRef, value: RustFrameTypeEmission): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (types.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native frame carrier has one exact environment and owner selection.");
      types.set(key, Object.freeze(value));
    },
    bindingDeclaration(subject: Node, value: RustFrameCallableBinding): void {
      assertOpen();
      if (bindingDeclarations.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A canonical native frame binding has one declaration owner.", subject);
      bindingDeclarations.set(subject, value);
    },
    owner(subject: Node, value: RustFrameCallableDefinition): void {
      assertOpen();
      if (owners.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native class activation has one frame owner.", subject);
      owners.set(subject, value);
    },
    classField(subject: Node, carrier: TargetTypeRef, value: RustClassFrameFieldEmission): void {
      assertOpen();
      let receivers = fields.get(subject);
      if (receivers === undefined) { receivers = new Map(); fields.set(subject, receivers); }
      const key = closedMetadataKey(carrier);
      if (receivers.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An instantiated native frame field has one source owner.", subject);
      receivers.set(key, Object.freeze(value));
    },
    binding(subject: RustFrameCallableBinding, value: RustFrameBindingEmission): void {
      assertOpen();
      if (bindings.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame binding emission is written exactly once.", subject.declaration);
      bindings.set(subject, Object.freeze(value));
    },
    input(subject: Node, value: ReadonlyMap<RustFrameCallableDefinition, RustFrameInputAdmission>): void {
      assertOpen();
      if (inputs.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame input admission is written exactly once.", subject);
      inputs.set(subject, value);
    },
    receiver(subject: Node, owner: Node): void {
      assertOpen();
      if (receivers.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame receiver owner is written exactly once.", subject);
      receivers.set(subject, owner);
    },
    implementation(subject: Node, value: RustFrameCallableImplementation): void {
      assertOpen();
      if (implementations.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame implementation is written exactly once.", subject);
      implementations.set(subject, value);
    },
    scope(subject: Node, values: readonly RustFrameCallableDefinition[]): void {
      assertOpen();
      if (scopes.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame scope inventory is written exactly once.", subject);
      scopes.set(subject, Object.freeze(values));
    },
    definition(subject: RustFrameCallableDefinition, value: RustFrameDefinitionEmission): void {
      assertOpen();
      if (definitions.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame emission is written exactly once.");
      definitions.set(subject, Object.freeze(value));
    },
    sourceFile(subject: SourceFile, values: readonly RustFrameCallableDefinition[]): void {
      assertOpen();
      if (sources.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame inventory is written exactly once.", subject);
      sources.set(subject, Object.freeze(values));
    },
  });
}
