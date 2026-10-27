import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustStoredFieldEmission, RustStructuralFieldStorage, RustStructuralMethodInvocation, RustStoredFieldRecords } from "../../../../target-model/records/storage/stored-fields.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import type { RustValueFieldProjection } from "../../../../target-model/records/storage/stored-fields.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";

export interface RustStoredFieldProducer {
  readonly records: RustStoredFieldRecords;
  admit(node: Node, value: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>): void;
  projection(node: Node, value: RustValueFieldProjection): void;
  field(storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number, value: RustStoredFieldEmission): void;
  structural(carrier: TargetTypeRef, fields: readonly RustStructuralFieldStorage[], value: boolean): void;
  invocation(carrier: TargetTypeRef, index: number, arguments_: readonly TargetTypeRef[], value: RustStructuralMethodInvocation): void;
  receiver(node: Node, value: boolean, stable: boolean): void;
  reference(node: Node, value: boolean): void;
}

export function createRustStoredFieldProducer(assertOpen: () => void): RustStoredFieldProducer {
  const fields = new Map<string, RustStoredFieldEmission>();
  const structural = new Map<string, readonly RustStructuralFieldStorage[]>();
  const objects = new Map<string, { readonly value: boolean }>();
  const invocations = new Map<string, RustStructuralMethodInvocation>();
  const receivers = new WeakMap<Node, boolean>();
  const stable = new WeakMap<Node, boolean>();
  const references = new WeakMap<Node, boolean>();
  const admitted = new WeakMap<Node, Extract<RustTargetOperationFact, { readonly kind: "source-field" }>>();
  const projections = new WeakMap<Node, RustValueFieldProjection>();
  return Object.freeze({ records: Object.freeze({
    admittedField: Object.freeze({ get: (node: Node) => admitted.get(node) }),
    valueFieldProjection: Object.freeze({ get: (node: Node) => projections.get(node) }),
    storedField: Object.freeze({ get: (storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number) => fields.get(closedMetadataKey([storage, carrier, index])) }),
    structuralFieldStorage: Object.freeze({ get: (carrier: TargetTypeRef, index: number) => structural.get(closedMetadataKey(carrier))?.[index] }),
    structuralObjectStorage: Object.freeze({ get: (carrier: TargetTypeRef) => objects.get(closedMetadataKey(carrier)) }),
    structuralMethodInvocation: Object.freeze({ get: (carrier: TargetTypeRef, index: number, arguments_: readonly TargetTypeRef[]) => invocations.get(closedMetadataKey([carrier, index, arguments_])) }),
    fieldValueReceiver: Object.freeze({ get: (node: Node) => receivers.get(node) }),
    referenceObjectField: Object.freeze({ get: (node: Node) => references.get(node) }),
    capturedReceiverStable: Object.freeze({ get: (node: Node) => stable.get(node) }),
  }),
    reference(node: Node, value: boolean): void {
      assertOpen();
      if (references.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A native field has one reference-location owner.", node);
      references.set(node, value);
    },
    admit(node: Node, value: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>): void {
      assertOpen();
      if (admitted.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A source field has one exact native operation admission.", node);
      admitted.set(node, value);
    },
    projection(node: Node, value: RustValueFieldProjection): void {
      assertOpen();
      if (projections.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A source field has one native location projection owner.", node);
      projections.set(node, Object.freeze(value));
    },
    field(storage: "project-object" | "structural-object", carrier: TargetTypeRef, index: number, value: RustStoredFieldEmission): void {
      assertOpen();
      const key = closedMetadataKey([storage, carrier, index]);
      if (fields.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A physical field has one exact native storage owner.", value.declaration);
      fields.set(key, Object.freeze(value));
    },
    structural(carrier: TargetTypeRef, values: readonly RustStructuralFieldStorage[], value: boolean): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (structural.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A structural instance has one physical storage owner.");
      structural.set(key, Object.freeze(values));
      objects.set(key, Object.freeze({ value }));
    },
    invocation(carrier: TargetTypeRef, index: number, arguments_: readonly TargetTypeRef[], value: RustStructuralMethodInvocation): void {
      assertOpen();
      const key = closedMetadataKey([carrier, index, arguments_]);
      if (invocations.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A structural method specialization has one native invocation owner.");
      invocations.set(key, Object.freeze(value));
    },
    receiver(node: Node, value: boolean, selectedStable: boolean): void {
      assertOpen();
      if (receivers.has(node)) failTargetAnalysisInvariant("tsonic-rust", "A source field receiver has one native location owner.", node);
      receivers.set(node, value);
      stable.set(node, selectedStable);
    },
  });
}
