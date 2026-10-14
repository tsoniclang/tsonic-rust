import type { Node } from "@tsonic/tsts";
import type { RustGeneratorFact } from "../../../target-model/records/callables-and-resources.js";
import { rustSuspendedCallableStorageEquals, rustSuspendedOwnedReceiverEquals } from "../../../target-model/records/equality.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustGeneratorStorageTargetType, type RustGeneratorProtocol } from "../../../target-model/types/index.js";
import { createRustRecordFamily } from "./family.js";

type RustGeneratorStorage = Pick<RustGeneratorFact, "capturedParameters" | "storage" | "ownedReceiver">;

export interface RustGeneratorProducer {
  readonly records: RustRecordFamily<RustGeneratorFact>;
  suspend(declaration: Node, protocol: RustGeneratorProtocol, retention: RustGeneratorStorage): void;
}

export function createRustGeneratorProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustGeneratorFact>,
): RustGeneratorProducer {
  const family = createRustRecordFamily<RustGeneratorFact>({ id: "tsonic.rust.generator", equals: (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.returnType, right.returnType) &&
    rustTargetTypeRefEquals(left.nextType, right.nextType) &&
    left.capturedParameters.length === right.capturedParameters.length &&
    left.capturedParameters.every((parameter, index) => parameter === right.capturedParameters[index]) &&
    left.storage.kind === right.storage.kind && rustSuspendedCallableStorageEquals(left.storage, right.storage) &&
    rustSuspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    suspend(declaration: Node, protocol: RustGeneratorProtocol, retention: RustGeneratorStorage): void {
      assertOpen();
      family.writer.set(declaration, Object.freeze({
        kind: protocol.kind,
        resultCarrier: rustGeneratorStorageTargetType(protocol, retention.storage.kind === "static" ? undefined
          : retention.storage.kind === "receiver" ? { kind: "placeholder" } : retention.storage.lifetime),
        yieldType: protocol.yieldType, returnType: protocol.returnType, nextType: protocol.nextType,
        capturedParameters: retention.capturedParameters, storage: retention.storage,
        ...(retention.ownedReceiver === undefined ? {} : { ownedReceiver: retention.ownedReceiver }),
      }));
    },
  });
}
