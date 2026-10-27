import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustSourceCallEmission } from "../../../../target-model/records/calls/source-calls.js";
import type { RustSourceCallableSpecializationVariant } from "../../../../target-model/records/callables/callable-emission.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { createRustRecordFamily } from "../family.js";

export function createRustSourceCallProducer(assertOpen: () => void) {
  const calls = createRustRecordFamily<RustSourceCallEmission>({ id: "tsonic.rust.sourceCall", equals: (left, right) => left === right }, assertOpen);
  const variants = new WeakMap<Node, ReadonlyMap<string, RustSourceCallableSpecializationVariant>>();
  return Object.freeze({ records: Object.freeze({ sourceCall: calls.reader,
    sourceCallSpecialization: Object.freeze({ get: (node: Node, arguments_: readonly TargetTypeRef[]) => variants.get(node)?.get(closedMetadataKey(arguments_)) }),
  }), publish(node: Node, value: RustSourceCallEmission, specializations: readonly RustSourceCallableSpecializationVariant[]): void {
    assertOpen();
    calls.writer.set(node, Object.freeze(value));
    variants.set(node, new Map(specializations.map(variant => [closedMetadataKey(variant.targetTypeArguments), variant])));
  } });
}

export type RustSourceCallProducer = ReturnType<typeof createRustSourceCallProducer>;
