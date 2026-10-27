import type { Node } from "@tsonic/tsts";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import { maximumRustFoundation } from "../../../../target-model/foundation/model.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustAwaitValueFact } from "../../../../target-model/records/callables/await-values.js";
import type { RustFutureValueFact } from "../../../../target-model/records/objects/object-methods.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustValueConversion } from "../../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { rustAwaitSelectionLeaves } from "../../../../target-model/types/await.js";
import { finalizeRustAwaitValueFact } from "../../../callables/async/await-values.js";
import { rustFoundationForFinalizedConversion } from "../../../foundation/conversion-requirements.js";
import { createRustRecordFamily } from "../family.js";

export interface RustAwaitValueProducer {
  readonly records: RustRecordFamily<RustAwaitValueFact>;
  finalize(subject: Node, operandCarrier: TargetTypeRef, resultCarrier: TargetTypeRef,
    futureFor: (carrier: TargetTypeRef) => RustFutureValueFact | undefined,
    selectConversion: (source: TargetTypeRef, target: TargetTypeRef) => RustValueConversion | undefined): RustAwaitValueFact | undefined;
}

export function createRustAwaitValueProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  definitions: RustTypeDefinitions,
  inherited?: RustAwaitValueProducer["records"],
): RustAwaitValueProducer {
  const family = createRustRecordFamily<RustAwaitValueFact>({ id: "tsonic.rust.awaitValue", equals: closedMetadataEquals },
    assertOpen, inherited, fact => {
      let foundation: RustFoundation = "core";
      for (const leaf of rustAwaitSelectionLeaves(fact.selection)) {
        if (leaf.completion.kind === "value") foundation = maximumRustFoundation(foundation,
          rustFoundationForFinalizedConversion(leaf.completion.conversion, definitions));
      }
      requireFoundation(foundation);
    });
  return Object.freeze({
    records: family.reader,
    finalize(subject: Node, operandCarrier: TargetTypeRef, resultCarrier: TargetTypeRef,
      futureFor: (carrier: TargetTypeRef) => RustFutureValueFact | undefined,
      selectConversion: (source: TargetTypeRef, target: TargetTypeRef) => RustValueConversion | undefined): RustAwaitValueFact | undefined {
      assertOpen();
      const fact = finalizeRustAwaitValueFact(operandCarrier, resultCarrier, futureFor, selectConversion, definitions);
      if (fact !== undefined) family.writer.set(subject, fact);
      return fact;
    },
  });
}
