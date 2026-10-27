import { requireRustRecord } from "./required-records.js";
import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { recordRustInlineModuleCallableUses, selectRustModuleCallableStorage } from "../../callables/values/module-values.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

export interface RustModuleCallableStorageProducer {
  readonly records: RustProgramRecords["moduleCallableStorage"];
  finalize(walk: RustFactWalk): void;
}

export function createRustModuleCallableStorageProducer(
  assertOpen: () => void,
  inherited?: RustProgramRecords["moduleCallableStorage"],
): RustModuleCallableStorageProducer {
  const family = createRustRecordFamily<{ readonly kind: "inline" | "stored" }>({
    id: "tsonic.rust.moduleCallableStorage", equals: (left, right) => left.kind === right.kind,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(walk: RustFactWalk): void {
      assertOpen();
      const visit = (node: Node): void => {
        if (!walk.context.isNativeNode(node)) return;
        const selection = selectRustModuleCallableStorage(walk, node);
        if (selection !== undefined) {
          requireRustRecord(walk.context.requiredRecords, "moduleCallableStorage", node,
            selection.stored ? "stored" : "inline", "moduleCallableStoragePlans.finalize");
          family.writer.set(node, Object.freeze({ kind: selection.stored ? "stored" : "inline" }));
          recordRustInlineModuleCallableUses(walk, selection);
        }
        walk.context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      walk.context.sourceFiles.forEach(visit);
    },
  });
}
