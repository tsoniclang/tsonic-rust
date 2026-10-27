import type { Node } from "@tsonic/tsts";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import { maximumRustFoundation } from "../../../../target-model/foundation/model.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustFutureValueFact } from "../../../../target-model/records/objects/object-methods.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { rustFoundationForFinalizedConversion } from "../../../foundation/conversion-requirements.js";
import { rustFoundationForCarrier } from "../../../foundation/requirements.js";
import { createRustRecordFamily } from "../family.js";

export interface RustFutureValueProducer {
  readonly records: RustRecordFamily<RustFutureValueFact>;
  resolve(subject: Node, select: () => RustFutureValueFact | undefined): RustFutureValueFact | undefined;
}

export function createRustFutureValueProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  definitions: RustTypeDefinitions,
  inherited?: RustFutureValueProducer["records"],
): RustFutureValueProducer {
  const family = createRustRecordFamily<RustFutureValueFact>({ id: "tsonic.rust.futureValue", equals: closedMetadataEquals },
    assertOpen, inherited, fact => {
      const conversion = rustFoundationForFinalizedConversion(fact.awaitedConversion, definitions);
      requireFoundation(fact.errorCarrier === undefined ? conversion : maximumRustFoundation(conversion,
        rustFoundationForCarrier(fact.errorCarrier)));
    });
  const resolving = new Set<Node>();
  return Object.freeze({
    records: family.reader,
    resolve(subject: Node, select: () => RustFutureValueFact | undefined): RustFutureValueFact | undefined {
      assertOpen();
      const existing = family.reader.get(subject);
      if (existing !== undefined || resolving.has(subject)) return existing;
      resolving.add(subject);
      try {
        const fact = select();
        if (fact !== undefined) family.writer.set(subject, fact);
        return fact;
      } finally {
        resolving.delete(subject);
      }
    },
  });
}
