import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustPropertyProjectionCase, RustPropertyProjectionFact } from "../../../target-model/records/property-projections.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { createRustRecordFamily } from "./family.js";

export interface RustPropertyProjectionProducer {
  readonly records: RustRecordFamily<RustPropertyProjectionFact>;
  finalize(expression: Node, conversion: RustValueConversion | undefined,
    cases: readonly RustPropertyProjectionCase[]): RustValueConversion | undefined;
}

export function createRustPropertyProjectionProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustPropertyProjectionFact>,
): RustPropertyProjectionProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.propertyProjection", equals: (
    left: RustPropertyProjectionFact, right: RustPropertyProjectionFact,
  ) => left === right }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(expression: Node, conversion: RustValueConversion | undefined,
      cases: readonly RustPropertyProjectionCase[]): RustValueConversion | undefined {
      assertOpen();
      if (conversion === undefined) return undefined;
      const previous = family.reader.get(expression);
      if (previous !== undefined && !closedMetadataEquals(previous.conversion, conversion)) return undefined;
      if (previous === undefined) family.writer.set(expression, Object.freeze({ conversion, cases: Object.freeze(cases) }));
      return conversion;
    },
  });
}
