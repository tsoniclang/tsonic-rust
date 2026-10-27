import type { Node } from "@tsonic/tsts";
import { rustBindingStorageEquals } from "../../../../target-model/records/operations/equality.js";
import type { RustBindingStorageFact } from "../../../../target-model/records/operations/operation-selections.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCaptureStorage } from "../../../../target-model/records/callables/capture-storage.js";
import type { RustSourcePolicyContext } from "../../../../policy/model/context.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectRustBindingLocationStorage } from "../../../storage/binding-locations.js";
import { createRustRecordFamily } from "../family.js";

export interface RustBindingStorageProducer {
  readonly records: RustRecordFamily<RustBindingStorageFact>;
  capture(declaration: Node, valueCarrier: TargetTypeRef, selected: RustCaptureStorage): void;
  requireLocation(context: Pick<RustSourcePolicyContext, "ast" | "source">,
    declaration: Node, valueCarrier: TargetTypeRef): boolean;
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
    requireLocation(context: Pick<RustSourcePolicyContext, "ast" | "source">,
      declaration: Node, valueCarrier: TargetTypeRef): boolean {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined) return existing.storage === "location" &&
        rustTargetTypeRefEquals(existing.valueCarrier, valueCarrier);
      const selected = selectRustBindingLocationStorage(declaration, context.ast, context.source.navigation);
      family.writer.set(declaration, Object.freeze({ ...selected, valueCarrier }));
      return true;
    },
  });
}
