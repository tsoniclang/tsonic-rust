import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { JsOperationRequest, JsOperationSelection } from "./model.js";
import { rustCallableTargetType, rustClosureProtocol, rustCallableProtocol, rustJsPromiseOutputTargetType, rustJsPromiseResolutionTargetType, rustJsPromiseTargetType, rustJsValueTargetType, rustOptionTargetType, rustUnitTargetType } from "../../../../target-model/types/index.js";
import { rustInferCarrier } from "./rows.js";
import { rustStaticLifetime } from "../../../../target-model/lifetimes/index.js";

const callbackCarrier = (parameters: readonly TargetTypeRef[], result: TargetTypeRef): TargetTypeRef =>
  rustCallableTargetType(parameters, result, rustStaticLifetime, rustJsValueTargetType());

export function selectRustJsPromiseConstructor(
  typeArguments: readonly (TargetTypeRef | undefined)[],
  arguments_: readonly (TargetTypeRef | undefined)[],
): JsOperationSelection | undefined {
  const output = typeArguments.length === 1 ? typeArguments[0] : undefined;
  if (output === undefined || arguments_.length !== 1) return undefined;
  const resolve = callbackCarrier([rustJsPromiseResolutionTargetType(output)], rustUnitTargetType());
  const reject = callbackCarrier([rustJsValueTargetType()], rustUnitTargetType());
  const parameters = [callbackCarrier([resolve, reject], rustUnitTargetType())];
  const result = rustJsPromiseTargetType(output);
  return {
    resultCarrier: result, parameterCarriers: parameters,
    fact: { kind: "provider-operation", operationId: "tsonic.rust.js.Promise.constructor", operationKind: "constructor",
      target: { form: "call", path: "js_abi::JsPromise::create" },
      parameterCarriers: parameters, resultCarrier: result, isAsync: false, isFallible: false, errorBoundary: "none",
      returnedFuture: { awaiting: "fallible", errorBoundary: "js-rejection" } },
  };
}

export function isRustJsPromiseContinuation(request: Pick<JsOperationRequest, "ownerName" | "operationKind" | "memberName">): boolean {
  return request.operationKind === "call" && (request.ownerName === "Promise" &&
    (request.memberName === "then" || request.memberName === "catch") ||
    request.ownerName === "PromiseLike" && request.memberName === "then");
}

export function selectRustJsPromiseContinuation(request: JsOperationRequest): JsOperationSelection | undefined {
  if (!isRustJsPromiseContinuation(request)) return undefined;
  const input = rustJsPromiseOutputTargetType(request.receiverCarrier);
  const arguments_ = request.argumentCarriers ?? [];
  const callback = rustCallableProtocol(arguments_[0]) ?? rustClosureProtocol(arguments_[0]);
  if (input === undefined || arguments_.length === 0 ||
    arguments_.length > (request.memberName === "catch" ? 1 : 2)) return undefined;
  const asynchronous = request.memberName === "then" && rustJsPromiseOutputTargetType(callback?.result) !== undefined;
  const output = request.memberName === "catch" ? input : request.authoredMethodTypeArgumentCarriers?.[0] ?? rustInferCarrier;
  const result = rustJsPromiseTargetType(output);
  const callbackResult = asynchronous && output !== rustInferCarrier ? result : output;
  const rejected = callbackCarrier([rustJsValueTargetType()], callbackResult);
  const parameters = request.memberName === "catch" ? [rejected] : [
    callbackCarrier([input], callbackResult), rustOptionTargetType(rejected),
  ];
  return {
    resultCarrier: result, parameterCarriers: parameters,
    ...(request.memberName === "then" ? { callback: {
      shape: "map" as const, sourceArgumentIndex: 0,
      ...(asynchronous ? { resultProjection: "awaited" as const } : {}),
      failure: { kind: "returned-future" as const },
    } } : {}),
    fact: { kind: "provider-operation", operationId: `tsonic.rust.js.Promise.${request.memberName}`, operationKind: "method",
      target: { form: "receiver-method", name: request.memberName === "catch" ? "catch" : asynchronous ? "then_async" : "then" },
      parameterCarriers: parameters, resultCarrier: result, isAsync: false, isFallible: false, errorBoundary: "none",
      returnedFuture: { awaiting: "fallible", errorBoundary: "js-rejection" } },
  };
}
