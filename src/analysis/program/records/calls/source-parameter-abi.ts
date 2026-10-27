import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFoundation } from "../../../../target-model/foundation/model.js";
import { maximumRustFoundation } from "../../../../target-model/foundation/model.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustSourceParameterAbiFact } from "../../../../target-model/records/callables/callables-and-resources.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { rustFoundationForValueConversion } from "../../../foundation/conversion-requirements.js";
import { rustFoundationForCarrier } from "../../../foundation/requirements.js";

import { createRustRecordFamily } from "../family.js";

export interface RustSourceParameterAbiProducer {
  readonly records: RustRecordFamily<RustSourceParameterAbiFact>;
  parameter(parameter: Node, selected: RustSourceParameterAbiFact): void;
  use(expression: Node, source: Node): void;
}

export function createRustSourceParameterAbiProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  definitions: RustTypeDefinitions,
  inherited?: RustRecordFamily<RustSourceParameterAbiFact>,
): RustSourceParameterAbiProducer {
  const family = createRustRecordFamily<RustSourceParameterAbiFact>({
    id: "tsonic.rust.sourceParameterAbi", equals: closedMetadataEquals,
  }, assertOpen, inherited, fact => {
    const carriers = maximumRustFoundation(rustFoundationForCarrier(fact.valueCarrier),
      rustFoundationForCarrier(fact.parameterCarrier));
    requireFoundation(fact.entryConversion === undefined ? carriers : maximumRustFoundation(carriers,
      rustFoundationForValueConversion(fact.entryConversion.conversion, definitions)));
  });
  return Object.freeze({
    records: family.reader,
    parameter(parameter: Node, selected: RustSourceParameterAbiFact): void {
      assertOpen();
      family.writer.set(parameter, Object.freeze({
        form: selected.form, valueCarrier: selected.valueCarrier, parameterCarrier: selected.parameterCarrier,
        mode: selected.mode,
        ...(selected.inputLifetime === undefined ? {} : { inputLifetime: selected.inputLifetime }),
        ...(selected.entryConversion === undefined ? {} : { entryConversion: selected.entryConversion }),
      }));
    },
    use(expression: Node, source: Node): void {
      assertOpen();
      const selected = family.reader.get(source);
      if (selected === undefined) return;
      const existing = family.reader.get(expression);
      if (existing !== undefined) {
        if (!closedMetadataEquals(existing, selected)) {
          failTargetAnalysisInvariant("tsonic-rust",
            "Conflicting Rust semantic plan 'tsonic.rust.sourceParameterAbi' for one exact source subject.", expression);
        }
        return;
      }
      family.writer.set(expression, selected);
    },
  });
}
