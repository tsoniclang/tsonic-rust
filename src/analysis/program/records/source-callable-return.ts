import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSourceCallableReturnFact } from "../../../target-model/records/source-declarations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { selectRustSourceCallableReturn } from "../../callables/signatures.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

export interface RustSourceCallableReturnProducer {
  readonly records: RustRecordFamily<RustSourceCallableReturnFact>;
  resolve(walk: RustFactWalk, declaration: Node, selectedCarrier?: TargetTypeRef): boolean;
  inferred(walk: RustFactWalk, declaration: Node, carrier: TargetTypeRef): void;
  setter(declaration: Node): void;
}

export function createRustSourceCallableReturnProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustSourceCallableReturnFact>,
): RustSourceCallableReturnProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.sourceCallableReturn", equals: (
    left: RustSourceCallableReturnFact, right: RustSourceCallableReturnFact,
  ) => rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier) &&
    left.borrowedParameter === right.borrowedParameter && left.implementationCompletion === right.implementationCompletion &&
    left.undefinedReturn === right.undefinedReturn && left.fallthroughUndefined === right.fallthroughUndefined &&
    left.canFallThrough === right.canFallThrough }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(walk: RustFactWalk, declaration: Node, selectedCarrier?: TargetTypeRef): boolean {
      assertOpen();
      const selection = selectRustSourceCallableReturn(walk, declaration, selectedCarrier);
      if (selection === undefined) return false;
      family.writer.set(declaration, selection);
      return true;
    },
    inferred(walk: RustFactWalk, declaration: Node, carrier: TargetTypeRef): void {
      assertOpen();
      if (family.reader.get(declaration) !== undefined) return;
      const completion = walk.context.semanticsFor(declaration).operations.callableCompletion(declaration);
      family.writer.set(declaration, { returnCarrier: carrier,
        ...(completion === undefined ? {} : { canFallThrough: completion.canFallThrough }) });
    },
    setter(declaration: Node): void {
      assertOpen();
      if (family.reader.get(declaration) === undefined) family.writer.set(declaration, { returnCarrier: rustUnitTargetType() });
    },
  });
}
