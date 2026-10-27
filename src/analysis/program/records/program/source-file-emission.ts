import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustDefaultExportEmission, RustModuleBindingEmission, RustSourceFileEmission } from "../../../../target-model/records/program/source-file-emission.js";
import { createRustRecordFamily } from "../family.js";

export function createRustSourceFileEmissionProducer(assertOpen: () => void) {
  const files = createRustRecordFamily<RustSourceFileEmission>({
    id: "tsonic.rust.sourceFileEmission", equals: (left, right) => left === right,
  }, assertOpen);
  const hoisted = createRustRecordFamily<{ readonly carrier: TargetTypeRef }>({
    id: "tsonic.rust.moduleHoistedCallable", equals: (left, right) => left === right,
  }, assertOpen);
  const forms = createRustRecordFamily<"ordinary" | "polymorphic">({
    id: "tsonic.rust.moduleTypeForm", equals: (left, right) => left === right,
  }, assertOpen);
  const exports = createRustRecordFamily<RustDefaultExportEmission>({
    id: "tsonic.rust.defaultExport", equals: (left, right) => left === right,
  }, assertOpen);
  const bindings = createRustRecordFamily<RustModuleBindingEmission>({
    id: "tsonic.rust.moduleBindingEmission", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: Object.freeze({ sourceFileEmission: files.reader,
    moduleHoistedCallable: hoisted.reader, moduleTypeForm: forms.reader, defaultExport: exports.reader,
    moduleBindingEmission: bindings.reader }),
    file(node: Node, value: RustSourceFileEmission): void { files.writer.set(node, Object.freeze(value)); },
    hoisted(node: Node, carrier: TargetTypeRef): void { hoisted.writer.set(node, Object.freeze({ carrier })); },
    type(node: Node, value: "ordinary" | "polymorphic"): void { forms.writer.set(node, value); },
    export(node: Node, value: RustDefaultExportEmission): void { exports.writer.set(node, Object.freeze(value)); },
    binding(node: Node, value: RustModuleBindingEmission): void { bindings.writer.set(node, Object.freeze(value)); },
  });
}

export type RustSourceFileEmissionProducer = ReturnType<typeof createRustSourceFileEmissionProducer>;
