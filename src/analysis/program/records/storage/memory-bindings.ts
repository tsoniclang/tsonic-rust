import type { Node } from "@tsonic/tsts";
import type { RustMemoryBindingPlan } from "../../../../target-model/records/storage/memory-bindings.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustMemoryBindingProducer {
  readonly records: RustRecordFamily<RustMemoryBindingPlan>;
  field(subject: Node, carrier: TargetTypeRef, expression: Node): void;
  record(subject: Node, carrier: TargetTypeRef,
    fields: Extract<RustMemoryBindingPlan, { readonly kind: "record" }>["fields"]): void;
}

export function createRustMemoryBindingProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustMemoryBindingPlan>,
): RustMemoryBindingProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.memoryBinding", equals: (
    left: RustMemoryBindingPlan, right: RustMemoryBindingPlan,
  ) => rustTargetTypeRefEquals(left.carrier, right.carrier) && (left.kind === "field"
    ? right.kind === "field" && left.expression === right.expression
    : right.kind === "record" && left.fields.length === right.fields.length && left.fields.every((field, index) => {
      const other = right.fields[index]!;
      return field.expression === other.expression && field.storageIndex === other.storageIndex &&
        rustTargetTypeRefEquals(field.carrier, other.carrier);
    })) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    field(subject: Node, carrier: TargetTypeRef, expression: Node): void {
      family.writer.set(subject, Object.freeze({ kind: "field", carrier, expression }));
    },
    record(subject: Node, carrier: TargetTypeRef,
      fields: Extract<RustMemoryBindingPlan, { readonly kind: "record" }>["fields"]): void {
      family.writer.set(subject, Object.freeze({ kind: "record", carrier, fields: Object.freeze(fields) }));
    },
  });
}
