import type { Node } from "@tsonic/tsts";
import { rustSourceCallableValueEquals } from "../../../../target-model/records/operations/equality.js";
import type { RustSourceCallableValueFact } from "../../../../target-model/records/operations/operation-selections.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSourceCallableValueProducer {
  readonly records: RustRecordFamily<RustSourceCallableValueFact>;
  function(reference: Node, declaration: Node, fileName: string, name: string,
    carrier: TargetTypeRef, parameters: readonly TargetTypeRef[], result: TargetTypeRef): void;
}

export function createRustSourceCallableValueProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustSourceCallableValueFact>,
): RustSourceCallableValueProducer {
  const family = createRustRecordFamily<RustSourceCallableValueFact>({
    id: "tsonic.rust.sourceCallableValue", equals: rustSourceCallableValueEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    function(reference: Node, declaration: Node, fileName: string, name: string,
      carrier: TargetTypeRef, parameters: readonly TargetTypeRef[], result: TargetTypeRef): void {
      family.writer.set(reference, Object.freeze({ form: "function", sourceDeclaration: declaration,
        fileName, name, carrier, parameterCarriers: Object.freeze([...parameters]), resultCarrier: result }));
    },
  });
}
