import type { Node } from "@tsonic/tsts";
import type { RustDirectStorageEmission, RustDirectStorageIdentity } from "../../../../target-model/records/storage/direct-storage.js";
import { createRustRecordFamily } from "../family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustUpdateProjectField, RustUpdateProjectionPlan, RustUpdateMember, RustLocationStorageRoot } from "../../../../target-model/records/storage/direct-storage.js";

export function createRustDirectStorageProducer(assertOpen: () => void) {
  const places = createRustRecordFamily<RustDirectStorageEmission>({ id: "tsonic.rust.directStorage", equals: (left, right) => left === right }, assertOpen);
  const identities = createRustRecordFamily<RustDirectStorageIdentity>({ id: "tsonic.rust.directStorageIdentity", equals: (left, right) => left === right }, assertOpen);
  const effects = createRustRecordFamily<boolean>({ id: "tsonic.rust.storageEffectful", equals: (left, right) => left === right }, assertOpen);
  const fields = createRustRecordFamily<RustUpdateProjectField | null>({ id: "tsonic.rust.updateProjectField", equals: (left, right) => left === right }, assertOpen);
  const projections = new WeakMap<Node, RustUpdateProjectionPlan>();
  const members = createRustRecordFamily<RustUpdateMember | null>({ id: "tsonic.rust.updateMember", equals: (left, right) => left === right }, assertOpen);
  const storageRoots = createRustRecordFamily<RustLocationStorageRoot | null>({ id: "tsonic.rust.locationStorageRoot", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ directStorage: places.reader, directStorageIdentity: identities.reader, storageEffectful: effects.reader,
    updateProjectField: fields.reader, updateMember: members.reader, locationStorageRoot: storageRoots.reader,
    updateProjection: Object.freeze({ get: (operand: Node) => projections.get(operand) }) }),
    member: (node: Node, value: RustUpdateMember | null): void => members.writer.set(node, value === null ? null : Object.freeze(value)),
    root: (node: Node, value: RustLocationStorageRoot | null): void => storageRoots.writer.set(node, value === null ? null : Object.freeze(value)),
    field: (node: Node, value: RustUpdateProjectField | null): void => fields.writer.set(node, value === null ? null : Object.freeze(value)),
    projection(operand: Node, value: RustUpdateProjectionPlan): void {
      assertOpen();
      if (projections.has(operand)) failTargetAnalysisInvariant("tsonic-rust", "A source projection chain has one exact native argument owner.", operand);
      projections.set(operand, Object.freeze({ arguments: Object.freeze([...value.arguments]),
        fieldOffsets: new Map(value.fieldOffsets), complete: value.complete }));
    },
    place: (node: Node, value: RustDirectStorageEmission): void => places.writer.set(node, Object.freeze(
      value.kind !== "unavailable" && value.projection !== undefined
        ? { ...value, projection: Object.freeze({ ...value.projection }) } : value)),
    identity: (node: Node, value: RustDirectStorageIdentity): void => identities.writer.set(node, Object.freeze(value)),
    effect: (node: Node, value: boolean): void => effects.writer.set(node, value) });
}
export type RustDirectStorageProducer = ReturnType<typeof createRustDirectStorageProducer>;
