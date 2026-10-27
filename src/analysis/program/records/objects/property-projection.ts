import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustPropertyProjectionCase, RustPropertyProjectionFact } from "../../../../target-model/records/objects/property-projections.js";
import type { RustValueConversion } from "../../../../target-model/operations/model.js";
import { createRustRecordFamily } from "../family.js";
import { rustPropertyProjectionFactEquals } from "../../../../target-model/records/operations/operation-equality.js";

export interface RustPropertyProjectionProducer {
  readonly records: RustRecordFamily<RustPropertyProjectionFact>;
  readonly assertOpen: () => void;
  finalize(expression: Node, conversion: RustValueConversion | undefined,
    cases: readonly RustPropertyProjectionCase[]): RustValueConversion | undefined;
}

export function createRustPropertyProjectionProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustPropertyProjectionFact>,
): RustPropertyProjectionProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.propertyProjection", equals: rustPropertyProjectionFactEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    assertOpen,
    finalize(expression: Node, conversion: RustValueConversion | undefined,
      cases: readonly RustPropertyProjectionCase[]): RustValueConversion | undefined {
      assertOpen();
      if (conversion === undefined) return undefined;
      const selected = Object.freeze({ conversion, cases: Object.freeze(cases) });
      family.writer.set(expression, selected);
      return family.reader.get(expression)!.conversion;
    },
  });
}
