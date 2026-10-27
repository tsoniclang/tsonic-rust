import type { Node } from "@tsonic/tsts";
import type { RustTemplateStringEmission, RustTemplateStringRecords } from "../../../../target-model/records/operations/template-strings.js";
import { createRustRecordFamily } from "../family.js";

export function createRustTemplateStringProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustTemplateStringEmission>({ id: "tsonic.rust.templateString", equals: (left, right) => left === right }, assertOpen);
  const records: RustTemplateStringRecords = Object.freeze({ templateString: family.reader });
  return Object.freeze({ records, publish: (node: Node, value: RustTemplateStringEmission): void => family.writer.set(node, Object.freeze(value)) });
}

export type RustTemplateStringProducer = ReturnType<typeof createRustTemplateStringProducer>;
