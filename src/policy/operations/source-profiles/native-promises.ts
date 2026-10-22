import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import { rustCallableProtocol, rustClosureProtocol, rustClosureTargetType, rustFutureOutputCarrier, rustFutureTargetType,
  rustProgramErrorTargetType, isRustNativeFutureCarrier } from "../../../target-model/types/index.js";

// `promise.catch(rejected)` / `promise.then(fulfilled, rejected?)` on a native Promise body (native surface). The
// rejection a native body settles with is the program error, so the rejected callback receives the program error and an
// `unknown` reason holds it (RULINGS 2026-10-22). Callbacks are fallible native closures; the continuation is a native
// future of the callbacks' result.
export function selectRustNativePromiseContinuation(memberName: string, receiverCarrier: TargetTypeRef | undefined,
  argumentCarriers: readonly (TargetTypeRef | undefined)[]): RustProviderOperationTemplate | undefined {
  if (memberName !== "catch" && memberName !== "then") return undefined;
  const input = isRustNativeFutureCarrier(receiverCarrier) ? rustFutureOutputCarrier(receiverCarrier) : undefined;
  if (input === undefined || argumentCarriers.length < 1 || argumentCarriers.length > (memberName === "catch" ? 1 : 2)) return undefined;
  const protocol = (carrier: TargetTypeRef | undefined) => rustCallableProtocol(carrier) ?? rustClosureProtocol(carrier);
  const output = memberName === "catch" ? input : protocol(argumentCarriers[0])?.result;
  if (output === undefined || argumentCarriers.some(carrier => protocol(carrier)?.result === undefined)) return undefined;
  const rejected = rustClosureTargetType([rustProgramErrorTargetType()], output, true);
  const parameters = memberName === "catch" ? [rejected]
    : [rustClosureTargetType([input], output, true), ...(argumentCarriers.length === 2 ? [rejected] : [])];
  return { kind: "provider-operation", operationId: `tsonic.rust.native.Promise.${memberName}`, operationKind: "method",
    target: { form: "native-promise-continuation", member: memberName },
    parameterCarriers: parameters, resultCarrier: rustFutureTargetType(output),
    isAsync: false, isFallible: false, errorBoundary: "none",
    // The continuation settles with the callbacks' runtime error (fallible native closures carry rt::TsonicError).
    returnedFuture: { awaiting: "fallible", errorBoundary: "target-runtime" } };
}
