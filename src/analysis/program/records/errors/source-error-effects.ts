import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustSourceErrorEffectEdge, RustSourceErrorEffectsFact } from "../../../../target-model/records/errors/source-error-effects.js";
import { rustSourceErrorEffectEdgeEquals } from "../../../errors/source-error-effects.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSourceErrorEffectsProducer {
  readonly records: RustRecordFamily<RustSourceErrorEffectsFact>;
  invocation(subject: Node, edges: readonly RustSourceErrorEffectEdge[]): void;
}

export function createRustSourceErrorEffectsProducer(
  assertOpen: () => void,
  inherited?: RustSourceErrorEffectsProducer["records"],
): RustSourceErrorEffectsProducer {
  const family = createRustRecordFamily<RustSourceErrorEffectsFact>({ id: "tsonic.rust.sourceErrorEffects",
    equals: (left, right) => left.edges.length === right.edges.length &&
      left.edges.every((edge, index) => rustSourceErrorEffectEdgeEquals(edge, right.edges[index]!)),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    invocation(subject: Node, edges: readonly RustSourceErrorEffectEdge[]): void {
      assertOpen();
      family.writer.set(subject, Object.freeze({ edges: Object.freeze(edges) }));
    },
  });
}
