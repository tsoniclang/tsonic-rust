import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustGenericCallableInvocationFact } from "../../../../target-model/records/callables/generic-callable-effects.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustGenericCallableInvocationProducer {
  readonly records: RustRecordFamily<RustGenericCallableInvocationFact>;
  selected(subject: Node, invocation: RustGenericCallableInvocationFact): void;
}

export function createRustGenericCallableInvocationProducer(
  assertOpen: () => void,
  inherited?: RustGenericCallableInvocationProducer["records"],
): RustGenericCallableInvocationProducer {
  const family = createRustRecordFamily<RustGenericCallableInvocationFact>({
    id: "tsonic.rust.genericCallableInvocation", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(subject: Node, invocation: RustGenericCallableInvocationFact): void {
      family.writer.set(subject, invocation);
    },
  });
}
