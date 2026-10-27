import type { Node } from "@tsonic/tsts";
import { rustClosureCaptureEquals } from "../../../../target-model/records/operations/equality.js";
import type { RustClosureCaptureFact } from "../../../../target-model/records/operations/operation-selections.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

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
        receivers: Object.freeze(receivers.map(receiver => Object.freeze({ ...receiver,
          references: Object.freeze([...receiver.references]) }))),
        receiverFields: Object.freeze(receiverFields.map(field => Object.freeze({ ...field,
          references: Object.freeze([...field.references]), storage: Object.freeze({ ...field.storage }) }))),
        captures: Object.freeze(captures.map(capture => Object.freeze({ ...capture }))),
        ...(invocationOwner === undefined ? {} : { invocationOwner }),
        ...(recursion.recursiveDeclaration === undefined ? {} : { recursiveDeclaration: recursion.recursiveDeclaration }),
        ...(recursiveField === undefined ? {} : { recursiveField: Object.freeze({ ...recursiveField,
          references: Object.freeze([...recursiveField.references]) }) }),
      }));
    },
  });
}
