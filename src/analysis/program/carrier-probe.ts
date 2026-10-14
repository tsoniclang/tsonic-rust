import { createRustProgramRecordBuilder } from "./records/create.js";
import type { RustFactWalk } from "./walk.js";
import { createRustSourceCallableAbiResolver } from "../../policy/ownership/source-callable-abi.js";

export function createRustCarrierProbe(walk: RustFactWalk): RustFactWalk {
  walk.context.records.assertOpen();
  const records = createRustProgramRecordBuilder(walk.context.typeDefinitions, walk.context.records);
  const sourceCallableAbi = createRustSourceCallableAbiResolver({
    isNativeCallableExpression: walk.moduleBindings.isNativeCallableExpression,
    parameterAbiFor: parameter => records.sourceParameterAbi.get(parameter),
  });
  const probe: RustFactWalk = {
    ...walk,
    context: { ...walk.context, records, diagnostics: [] },
    operationAttempts: new WeakMap(),
    postCheckOperations: new WeakMap(),
    rejectedExpressions: new WeakSet(),
    resolving: new Set(),
    resolvingCallableSignatures: new Set(),
    finalizedParameters: new WeakSet(),
    capturedBindingStorage: new Map(),
    deferredCallbackCalls: new WeakMap(),
    preparedCallbackCalls: new Map(),
    objectLiteralMethodExpressions: new Set(),
    objectLiteralMethodSpreadExpressions: new Set(),
    sourceCallableAbi,
    operationOptions: {
      ...walk.operationOptions,
      sourceCallableAbi,
      callableSignatureCarrier: declaration => probe.callableSignatureCarrierFor(probe, declaration),
    },
  };
  return probe;
}
