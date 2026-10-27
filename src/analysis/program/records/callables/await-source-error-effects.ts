import type { Node } from "@tsonic/tsts";
import type { RustAwaitSourceErrorBranch, RustAwaitSourceErrorEffectsFact } from "../../../../target-model/records/callables/await-source-error-effects.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustSourceErrorEffectEdgeEquals } from "../../../errors/source-error-effects.js";
import { createRustRecordFamily } from "../family.js";

export interface RustAwaitSourceErrorEffectsProducer {
  readonly records: RustRecordFamily<RustAwaitSourceErrorEffectsFact>;
  selected(subject: Node, branches: readonly RustAwaitSourceErrorBranch[]): void;
}

export function createRustAwaitSourceErrorEffectsProducer(
  assertOpen: () => void,
  inherited?: RustAwaitSourceErrorEffectsProducer["records"],
): RustAwaitSourceErrorEffectsProducer {
  const family = createRustRecordFamily<RustAwaitSourceErrorEffectsFact>({ id: "tsonic.rust.awaitSourceErrorEffects",
    equals: (left, right) => left.branches.length === right.branches.length &&
      left.branches.every((branch, index) => rustTargetTypeRefEquals(branch.carrier, right.branches[index]!.carrier) &&
        rustSourceErrorEffectEdgeEquals(branch.edge, right.branches[index]!.edge)),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(subject: Node, branches: readonly RustAwaitSourceErrorBranch[]): void {
      assertOpen();
      family.writer.set(subject, Object.freeze({ branches }));
    },
  });
}
