import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustDiscardedFutureSpawn } from "../../../target-model/records/callables/promise-results.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../../policy/constraints/native-traits.js";
import { selectRustJsRejectionRegion } from "../../../policy/operations/flow/js-rejection.js";
import { rustFutureValueForOperation } from "./future-values.js";

// A native future discarded on the js surface is spawned on the event loop (JS promises start eagerly). The spawned
// task must own everything the future borrows: this admits a provider method future whose receiver is a cloneable
// local binding (the task owns a clone) and whose arguments are Copy values, with an error that converts into a JS
// rejection value. Any other discarded native future stays refused (TSONIC_NATIVE_ASYNC_RESULT_DISCARDED).
export function selectRustDiscardedFutureSpawn(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
}, call: Node): RustDiscardedFutureSpawn | undefined {
  const { ast, records } = input;
  if (!ast.is.IsCallExpression(call)) return undefined;
  const operation = records.targetOperation.get(call);
  if (operation?.kind !== "provider-operation") return undefined;
  const future = rustFutureValueForOperation(operation, records.sourceCallEffects.get(call), input.definitions);
  if (future === undefined) return undefined;
  const callee = Node_Expression(ast, call);
  const receiver = callee !== undefined && ast.is.IsPropertyAccessExpression(callee) ? Node_Expression(ast, callee) : undefined;
  if (receiver === undefined || !ast.is.IsIdentifier(receiver) ||
    !rustCarrierSupportsClone(records.runtimeCarrier.get(receiver)?.carrier, input.definitions)) return undefined;
  if (!ast.arguments(call).every(argument => argument !== undefined && isRustCopyCarrier(records.runtimeCarrier.get(argument)?.carrier)))
    return undefined;
  if (future.awaiting !== "fallible") return Object.freeze({ receiver, rejection: undefined });
  if (future.errorBoundary !== "provider-native" || future.errorCarrier === undefined) return undefined;
  const conversion = selectRustJsRejectionRegion(undefined, [{ identity: "spawned-future", variant: "Spawned", errorType: future.errorCarrier }])
    ?.sources[0]?.conversion;
  return conversion === undefined || conversion.kind === "program-error" || conversion.kind === "native-join"
    ? undefined : Object.freeze({ receiver, rejection: conversion });
}
