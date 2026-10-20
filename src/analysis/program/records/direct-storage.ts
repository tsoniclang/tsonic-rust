import type { Node } from "@tsonic/tsts";
import type { RustDirectStorageEmission, RustDirectStorageIdentity } from "../../../target-model/records/direct-storage.js";
import { createRustRecordFamily } from "./family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustUpdateProjectField, RustUpdateProjectionArgument } from "../../../target-model/records/direct-storage.js";

export function createRustDirectStorageProducer(assertOpen: () => void) {
  const places = createRustRecordFamily<RustDirectStorageEmission>({ id: "tsonic.rust.directStorage", equals: (left, right) => left === right }, assertOpen);
  const identities = createRustRecordFamily<RustDirectStorageIdentity>({ id: "tsonic.rust.directStorageIdentity", equals: (left, right) => left === right }, assertOpen);
  const effects = createRustRecordFamily<boolean>({ id: "tsonic.rust.storageEffectful", equals: (left, right) => left === right }, assertOpen);
  const fields = createRustRecordFamily<RustUpdateProjectField | null>({ id: "tsonic.rust.updateProjectField", equals: (left, right) => left === right }, assertOpen);
  const projections = new WeakMap<Node, Map<Node, readonly RustUpdateProjectionArgument[]>>();
  return Object.freeze({ records: Object.freeze({ directStorage: places.reader, directStorageIdentity: identities.reader, storageEffectful: effects.reader,
    updateProjectField: fields.reader, updateProjection: Object.freeze({ get: (operand: Node, field: Node) => projections.get(operand)?.get(field) }) }),
    field: (node: Node, value: RustUpdateProjectField | null): void => fields.writer.set(node, value === null ? null : Object.freeze(value)),
    projection(operand: Node, field: Node, arguments_: readonly RustUpdateProjectionArgument[]): void {
      assertOpen();
      const values = projections.get(operand) ?? new Map<Node, readonly RustUpdateProjectionArgument[]>();
      if (values.has(field)) failTargetAnalysisInvariant("tsonic-rust", "A source projection chain has one exact native argument owner.", operand);
      values.set(field, Object.freeze([...arguments_]));
      projections.set(operand, values);
    },
    place: (node: Node, value: RustDirectStorageEmission): void => places.writer.set(node, Object.freeze(value)),
    identity: (node: Node, value: RustDirectStorageIdentity): void => identities.writer.set(node, Object.freeze(value)),
    effect: (node: Node, value: boolean): void => effects.writer.set(node, value) });
}
export type RustDirectStorageProducer = ReturnType<typeof createRustDirectStorageProducer>;
