import type { Node } from "@tsonic/tsts";
import type { RustAsyncFunctionFact, RustJsPromiseLowering } from "../../../../target-model/records/callables/callables-and-resources.js";
import { rustAsyncFunctionFactEquals } from "../../../../target-model/records/operations/equality.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustFutureTargetType } from "../../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export function rustNativeAsyncFunctionFact(outputCarrier: TargetTypeRef): Extract<RustAsyncFunctionFact, { readonly kind: "native-future" }> {
  return Object.freeze({ kind: "native-future", isAsync: true, futureCarrier: rustFutureTargetType(outputCarrier), outputCarrier });
}

export function rustPromiseAsyncFunctionFact(
  futureCarrier: TargetTypeRef, outputCarrier: TargetTypeRef, lowering: RustJsPromiseLowering,
): Extract<RustAsyncFunctionFact, { readonly kind: "js-promise" }> {
  const selected: RustJsPromiseLowering = lowering.kind === "settled"
    ? Object.freeze({ kind: "settled", settledAwaits: lowering.settledAwaits })
    : Object.freeze({ kind: "factory", storage: lowering.storage, capturedParameters: lowering.capturedParameters,
      capturedCarriers: Object.freeze([...lowering.capturedCarriers]),
      ...(lowering.ownedReceiver === undefined ? {} : { ownedReceiver: lowering.ownedReceiver }) });
  return Object.freeze({ kind: "js-promise", isAsync: true, futureCarrier, outputCarrier, lowering: selected });
}

export interface RustAsyncFunctionProducer {
  readonly records: RustRecordFamily<RustAsyncFunctionFact>;
  native(declaration: Node, outputCarrier: TargetTypeRef): void;
  promise(declaration: Node, futureCarrier: TargetTypeRef, outputCarrier: TargetTypeRef,
    lowering: RustJsPromiseLowering): void;
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
      lowering: RustJsPromiseLowering): void {
      assertOpen();
      family.writer.set(declaration, rustPromiseAsyncFunctionFact(futureCarrier, outputCarrier, lowering));
    },
  });
}
