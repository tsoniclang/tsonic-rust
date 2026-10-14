import type { Node } from "@tsonic/tsts";
import { rustClosureCaptureEquals } from "../../../target-model/records/equality.js";
import type { RustClosureCaptureFact } from "../../../target-model/records/operation-selections.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

type RustRecursiveCapture = Pick<RustClosureCaptureFact, "recursiveDeclaration" | "recursiveField">;

export interface RustClosureCaptureProducer {
  readonly records: RustRecordFamily<RustClosureCaptureFact>;
  capture(declaration: Node, captures: RustClosureCaptureFact["captures"],
    receivers?: RustClosureCaptureFact["receivers"], receiverFields?: RustClosureCaptureFact["receiverFields"],
    recursion?: RustRecursiveCapture, invocationOwner?: RustClosureCaptureFact["invocationOwner"]): void;
}

export function createRustClosureCaptureProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustClosureCaptureFact>,
): RustClosureCaptureProducer {
  const family = createRustRecordFamily<RustClosureCaptureFact>({
    id: "tsonic.rust.closureCaptures", equals: rustClosureCaptureEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    capture(declaration: Node, captures: RustClosureCaptureFact["captures"],
      receivers: RustClosureCaptureFact["receivers"] = [], receiverFields: RustClosureCaptureFact["receiverFields"] = [],
      recursion: RustRecursiveCapture = {}, invocationOwner?: RustClosureCaptureFact["invocationOwner"]): void {
      assertOpen();
      const recursiveField = recursion.recursiveField;
      family.writer.set(declaration, Object.freeze({
        receivers: Object.freeze(receivers.map(receiver => Object.freeze({ owner: receiver.owner,
          reference: receiver.reference, references: Object.freeze([...receiver.references]), carrier: receiver.carrier }))),
        receiverFields: Object.freeze(receiverFields.map(field => Object.freeze({ declaration: field.declaration,
          reference: field.reference, receiver: field.receiver, references: Object.freeze([...field.references]),
          carrier: field.carrier, storage: Object.freeze({ kind: field.storage.kind, initialization: field.storage.initialization }) }))),
        captures: Object.freeze(captures.map(capture => Object.freeze({ declaration: capture.declaration,
          reference: capture.reference, carrier: capture.carrier, storage: capture.storage,
          ...(capture.mutable === undefined ? {} : { mutable: capture.mutable }) }))),
        ...(invocationOwner === undefined ? {} : { invocationOwner }),
        ...(recursion.recursiveDeclaration === undefined ? {} : { recursiveDeclaration: recursion.recursiveDeclaration }),
        ...(recursiveField === undefined ? {} : { recursiveField: Object.freeze({ declaration: recursiveField.declaration,
          receiver: recursiveField.receiver, reference: recursiveField.reference,
          references: Object.freeze([...recursiveField.references]), carrier: recursiveField.carrier }) }),
      }));
    },
  });
}
