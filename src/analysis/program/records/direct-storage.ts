import type { Node } from "@tsonic/tsts";
import type { RustDirectStorageEmission, RustDirectStorageIdentity } from "../../../target-model/records/direct-storage.js";
import { createRustRecordFamily } from "./family.js";

export function createRustDirectStorageProducer(assertOpen: () => void) {
  const places = createRustRecordFamily<RustDirectStorageEmission>({ id: "tsonic.rust.directStorage", equals: (left, right) => left === right }, assertOpen);
  const identities = createRustRecordFamily<RustDirectStorageIdentity>({ id: "tsonic.rust.directStorageIdentity", equals: (left, right) => left === right }, assertOpen);
  const effects = createRustRecordFamily<boolean>({ id: "tsonic.rust.storageEffectful", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ directStorage: places.reader, directStorageIdentity: identities.reader, storageEffectful: effects.reader }),
    place: (node: Node, value: RustDirectStorageEmission): void => places.writer.set(node, Object.freeze(value)),
    identity: (node: Node, value: RustDirectStorageIdentity): void => identities.writer.set(node, Object.freeze(value)),
    effect: (node: Node, value: boolean): void => effects.writer.set(node, value) });
}
export type RustDirectStorageProducer = ReturnType<typeof createRustDirectStorageProducer>;
