import { createRustProgramRecordBuilder } from "./records/create.js";
import type { RustFactWalk } from "./walk.js";
import { createRustSourceCallableAbiResolver } from "../callables/source-callable-abi.js";
import { finalizeRustCallableParameterAbis } from "../callables/signature-query.js";
import { resolveRustCallableOwnershipCarrier } from "../callables/ownership-carriers.js";
import { rustRetainedValueLifetime } from "../callables/retained-values.js";

export function createRustCarrierProbe(walk: RustFactWalk): RustFactWalk {
  walk.context.records.assertOpen();
  const records = createRustProgramRecordBuilder(walk.context.typeDefinitions, walk.context.records);
  const sourceCallableAbi = createRustSourceCallableAbiResolver({
    isNativeCallableExpression: walk.moduleBindings.isNativeCallableExpression,
    parameterAbiFor: parameter => records.sourceParameterAbi.get(parameter),
  });
  const probe: RustFactWalk = {
    ...walk,
    context: { ...walk.context, records, requiredRecords: [], diagnostics: [] },
    operationAttempts: new WeakMap(),
    postCheckOperations: new WeakMap(),
    rejectedExpressions: new WeakSet(),
    resolving: new Set(),
    callableSignatures: new WeakMap(),
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
      callableParameterCarriers: declaration => finalizeRustCallableParameterAbis(probe, declaration)?.map(parameter => parameter.parameterCarrier),
      callableValueLifetime: (declaration, captures, role) => rustRetainedValueLifetime(declaration, captures, probe,
        role === "signature" ? { kind: "signature" } : { kind: "construction", projectTypes: probe.context.projectTypes,
          objectRepresentations: probe.context.objectRepresentations }),
      callableStorageCarrier: (source, selection, logicalCarrier, environmentFor, classFrameFor) =>
        resolveRustCallableOwnershipCarrier(probe, source, selection, logicalCarrier, environmentFor, classFrameFor),
    },
  };
  return probe;
}
