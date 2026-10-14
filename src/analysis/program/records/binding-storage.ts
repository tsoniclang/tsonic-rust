import type { Node } from "@tsonic/tsts";
import { rustBindingStorageEquals } from "../../../target-model/records/equality.js";
import type { RustBindingStorageFact } from "../../../target-model/records/operation-selections.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCaptureStorage } from "../../callables/capture-storage.js";
import { createRustRecordFamily } from "./family.js";

export interface RustBindingStorageProducer {
  readonly records: RustRecordFamily<RustBindingStorageFact>;
  capture(declaration: Node, valueCarrier: TargetTypeRef, selected: RustCaptureStorage): void;
  location(declaration: Node, valueCarrier: TargetTypeRef): void;
}

export function createRustBindingStorageProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustBindingStorageFact>,
): RustBindingStorageProducer {
  const family = createRustRecordFamily({
    id: "tsonic.rust.bindingStorage", equals: rustBindingStorageEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    capture(declaration: Node, valueCarrier: TargetTypeRef, selected: RustCaptureStorage): void {
      assertOpen();
      if (selected.storage === "value") return;
      family.writer.set(declaration, Object.freeze({ storage: selected.storage, valueCarrier,
        ...(selected.initialization === undefined ? {} : { initialization: selected.initialization }),
        ...(selected.iterationScope === undefined ? {} : { iterationScope: selected.iterationScope }),
      }));
    },
    location(declaration: Node, valueCarrier: TargetTypeRef): void {
      family.writer.set(declaration, Object.freeze({ storage: "location", valueCarrier }));
    },
  });
}
