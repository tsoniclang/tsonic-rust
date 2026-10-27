import type { ExtensionFactSubject } from "@tsonic/tsts";
import { maximumRustFoundation, type RustFoundation } from "../../../../target-model/foundation/model.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustContextualValueConversion } from "../../../../target-model/conversions/contextual.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustContextualValueConversionFact } from "../../../../target-model/records/objects/value-projections.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { rustFoundationForCarrier } from "../../../foundation/requirements.js";
import { rustFoundationForContextualConversion } from "../../../foundation/conversion-requirements.js";
import { createRustRecordFamily } from "../family.js";

export interface RustContextualValueConversionProducer {
  readonly records: RustRecordFamily<RustContextualValueConversionFact>;
  convert(subject: ExtensionFactSubject, source: TargetTypeRef, target: TargetTypeRef, conversion: RustContextualValueConversion): void;
}

export function createRustContextualValueConversionProducer(
  assertOpen: () => void, requireFoundation: (foundation: RustFoundation) => void, definitions: RustTypeDefinitions,
  inherited?: RustContextualValueConversionProducer["records"],
): RustContextualValueConversionProducer {
  const family = createRustRecordFamily<RustContextualValueConversionFact>({ id: "tsonic.rust.contextualValueConversion", equals: closedMetadataEquals },
    assertOpen, inherited, fact => requireFoundation(maximumRustFoundation(rustFoundationForContextualConversion(fact.conversion, definitions),
      maximumRustFoundation(rustFoundationForCarrier(fact.sourceCarrier), rustFoundationForCarrier(fact.targetCarrier)))));
  return Object.freeze({ records: family.reader,
    convert(subject: ExtensionFactSubject, source: TargetTypeRef, target: TargetTypeRef, conversion: RustContextualValueConversion): void {
      assertOpen();
      family.writer.set(subject, Object.freeze({ sourceCarrier: source, targetCarrier: target, conversion }));
    },
  });
}
