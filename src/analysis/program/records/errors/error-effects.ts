import type { Node } from "@tsonic/tsts";
import type { RustErrorEffectsFact } from "../../../../target-model/records/errors/error-effects.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustErrorEffectsEqual } from "../../../errors/error-effects.js";
import { createRustRecordFamily } from "../family.js";

export interface RustErrorEffectsProducer {
  readonly records: RustRecordFamily<RustErrorEffectsFact>;
  selected(subject: Node, effects: RustErrorEffectsFact): void;
}

export function createRustErrorEffectsProducer(
  assertOpen: () => void,
  inherited?: RustErrorEffectsProducer["records"],
): RustErrorEffectsProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.errorEffects", equals: rustErrorEffectsEqual },
    assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(subject: Node, effects: RustErrorEffectsFact): void {
      family.writer.set(subject, effects);
    },
  });
}
