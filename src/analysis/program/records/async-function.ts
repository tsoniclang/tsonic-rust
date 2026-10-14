import type { Node } from "@tsonic/tsts";
import type { RustAsyncFunctionFact } from "../../../target-model/records/callables-and-resources.js";
import { rustSuspendedCallableStorageEquals, rustSuspendedOwnedReceiverEquals } from "../../../target-model/records/equality.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustFutureTargetType } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { createRustRecordFamily } from "./family.js";

type RustAsyncPromiseStorage = Pick<Extract<RustAsyncFunctionFact, { readonly kind: "js-promise" }>,
  "capturedParameters" | "storage" | "ownedReceiver">;

export interface RustAsyncFunctionProducer {
  readonly records: RustRecordFamily<RustAsyncFunctionFact>;
  native(declaration: Node, outputCarrier: TargetTypeRef): void;
  promise(declaration: Node, futureCarrier: TargetTypeRef, outputCarrier: TargetTypeRef,
    storage: RustAsyncPromiseStorage): void;
}

export function createRustAsyncFunctionProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustAsyncFunctionFact>,
): RustAsyncFunctionProducer {
  const family = createRustRecordFamily<RustAsyncFunctionFact>({ id: "tsonic.rust.asyncFunction", equals: (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.futureCarrier, right.futureCarrier) &&
    rustTargetTypeRefEquals(left.outputCarrier, right.outputCarrier) &&
    (left.kind === "native-future" || right.kind === "native-future" ||
      left.capturedParameters.length === right.capturedParameters.length &&
      left.capturedParameters.every((parameter, index) => parameter === right.capturedParameters[index]) &&
      rustSuspendedCallableStorageEquals(left.storage, right.storage) &&
      rustSuspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver)),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    native(declaration: Node, outputCarrier: TargetTypeRef): void {
      assertOpen();
      family.writer.set(declaration, {
        kind: "native-future", isAsync: true, futureCarrier: rustFutureTargetType(outputCarrier), outputCarrier,
      });
    },
    promise(declaration: Node, futureCarrier: TargetTypeRef, outputCarrier: TargetTypeRef,
      storage: RustAsyncPromiseStorage): void {
      assertOpen();
      family.writer.set(declaration, {
        kind: "js-promise", isAsync: true, futureCarrier, outputCarrier,
        capturedParameters: storage.capturedParameters, storage: storage.storage,
        ...(storage.ownedReceiver === undefined ? {} : { ownedReceiver: storage.ownedReceiver }),
      });
    },
  });
}
