import type { Node } from "@tsonic/tsts";
import type { RustAsyncFunctionFact } from "../../../target-model/records/callables-and-resources.js";
import { rustAsyncFunctionFactEquals } from "../../../target-model/records/equality.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { rustFutureTargetType } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { createRustRecordFamily } from "./family.js";

type RustAsyncPromiseStorage = Pick<Extract<RustAsyncFunctionFact, { readonly kind: "js-promise" }>,
  "capturedParameters" | "storage" | "ownedReceiver">;

export function rustNativeAsyncFunctionFact(outputCarrier: TargetTypeRef): Extract<RustAsyncFunctionFact, { readonly kind: "native-future" }> {
  return Object.freeze({ kind: "native-future", isAsync: true, futureCarrier: rustFutureTargetType(outputCarrier), outputCarrier });
}

export function rustPromiseAsyncFunctionFact(
  futureCarrier: TargetTypeRef, outputCarrier: TargetTypeRef, storage: RustAsyncPromiseStorage,
): Extract<RustAsyncFunctionFact, { readonly kind: "js-promise" }> {
  return Object.freeze({ kind: "js-promise", isAsync: true, futureCarrier, outputCarrier,
    capturedParameters: storage.capturedParameters, storage: storage.storage,
    ...(storage.ownedReceiver === undefined ? {} : { ownedReceiver: storage.ownedReceiver }),
  });
}

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
  const family = createRustRecordFamily<RustAsyncFunctionFact>({ id: "tsonic.rust.asyncFunction", equals: rustAsyncFunctionFactEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    native(declaration: Node, outputCarrier: TargetTypeRef): void {
      assertOpen();
      family.writer.set(declaration, rustNativeAsyncFunctionFact(outputCarrier));
    },
    promise(declaration: Node, futureCarrier: TargetTypeRef, outputCarrier: TargetTypeRef,
      storage: RustAsyncPromiseStorage): void {
      assertOpen();
      family.writer.set(declaration, rustPromiseAsyncFunctionFact(futureCarrier, outputCarrier, storage));
    },
  });
}
