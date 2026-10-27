import type { Node } from "@tsonic/tsts";
import type { RustProviderOperationTemplate } from "../../../../target-model/operations/model.js";
import type { RustPreparedOperationResultFact } from "../../../../target-model/records/operations/operation-selections.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustPreparedOperationResultProducer {
  readonly records: RustRecordFamily<RustPreparedOperationResultFact>;
  prepare(expression: Node, operation: RustProviderOperationTemplate, resultCarrier: TargetTypeRef): void;
}

export function createRustPreparedOperationResultProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustPreparedOperationResultFact>,
): RustPreparedOperationResultProducer {
  const family = createRustRecordFamily<RustPreparedOperationResultFact>({
    id: "tsonic.rust.preparedOperationResult",
    equals: (left, right) => left.operationId === right.operationId &&
      left.operationKind === right.operationKind && rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    prepare(expression: Node, operation: RustProviderOperationTemplate, resultCarrier: TargetTypeRef): void {
      family.writer.set(expression, Object.freeze({ operationId: operation.operationId,
        operationKind: operation.operationKind, resultCarrier }));
    },
  });
}
