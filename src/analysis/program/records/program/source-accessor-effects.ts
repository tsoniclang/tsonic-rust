import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustSourceAccessorEffectsFact } from "../../../../target-model/records/objects/object-methods.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSourceAccessorEffectsProducer {
  readonly records: RustRecordFamily<RustSourceAccessorEffectsFact>;
  selected(subject: Node, read: boolean | undefined, write: boolean | undefined): void;
}

export function createRustSourceAccessorEffectsProducer(
  assertOpen: () => void,
  inherited?: RustSourceAccessorEffectsProducer["records"],
): RustSourceAccessorEffectsProducer {
  const family = createRustRecordFamily<RustSourceAccessorEffectsFact>({
    id: "tsonic.rust.sourceAccessorEffects", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(subject: Node, read: boolean | undefined, write: boolean | undefined): void {
      assertOpen();
      family.writer.set(subject, {
        ...(read === undefined ? {} : { read: read ? "fallible" : "infallible" }),
        ...(write === undefined ? {} : { write: write ? "fallible" : "infallible" }),
      });
    },
  });
}
