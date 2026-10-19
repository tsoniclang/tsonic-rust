import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFrameBindingEmission, RustFrameDefinitionEmission, RustFrameEmissionRecords, RustFrameInputAdmission } from "../../../target-model/records/frame-emission.js";
import type { RustFrameCallableBinding, RustFrameCallableDefinition, RustFrameCallableImplementation } from "../../../target-model/records/frame-callables.js";

export interface RustFrameEmissionProducer {
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
  return Object.freeze({ records: Object.freeze({
    frameBinding: Object.freeze({ get: (subject: RustFrameCallableBinding) => bindings.get(subject) }),
    frameInput: Object.freeze({ get: (subject: Node) => inputs.get(subject) }),
    frameReceiverOwner: Object.freeze({ get: (subject: Node) => receivers.get(subject) }),
    frameImplementation: Object.freeze({ get: (subject: Node) => implementations.get(subject) }),
    frameScopes: Object.freeze({ get: (subject: Node) => scopes.get(subject) }),
    frameDeclaration: Object.freeze({ get: (subject: RustFrameCallableDefinition) => definitions.get(subject) }),
    frameDeclarations: Object.freeze({ get: (subject: SourceFile) => sources.get(subject) }),
  }),
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
