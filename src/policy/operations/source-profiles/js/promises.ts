import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { JsOperationRequest, JsOperationSelection } from "./model.js";
import {
  rustCallableTargetType, rustClosureProtocol, rustCallableProtocol,
  rustJsPromiseOutputTargetType, rustJsPromiseTargetTypeWithLifetime,
  rustOptionTargetType, rustProgramErrorTargetType, rustUnitTargetType,
} from "../../../../target-model/types/index.js";
import { rustJsPromiseResolutionTargetType } from "../../../../target-model/types/carriers/promises.js";
import { rustStaticLifetime } from "../../../../target-model/lifetimes/index.js";
import { rustInferCarrier } from "./rows.js";

export function selectRustJsPromiseConstructor(
  typeArguments: readonly (TargetTypeRef | undefined)[],
  arguments_: readonly (TargetTypeRef | undefined)[],
): JsOperationSelection | undefined {
  const output = typeArguments.length === 1 ? typeArguments[0] : undefined;
  if (output === undefined || arguments_.length !== 1) return undefined;
  const resolve = rustCallableTargetType([rustJsPromiseResolutionTargetType(output)], rustUnitTargetType());
  const reject = rustCallableTargetType([rustProgramErrorTargetType()], rustUnitTargetType());
  const parameters = [rustCallableTargetType([resolve, reject], rustUnitTargetType())];
  const result = rustJsPromiseTargetTypeWithLifetime(output, rustStaticLifetime);
  return {
    resultCarrier: result, parameterCarriers: parameters,
    fact: { kind: "provider-operation", operationId: "tsonic.rust.js.Promise.constructor", operationKind: "constructor",
      target: { form: "call", path: "js_abi::JsPromise::create" },
      parameterCarriers: parameters, resultCarrier: result, isAsync: false, isFallible: false, errorBoundary: "none",
      returnedFuture: { awaiting: "fallible", errorBoundary: "source-program" } },
  };
}

export function selectRustJsPromiseContinuation(request: JsOperationRequest): JsOperationSelection | undefined {
  if (request.ownerName !== "Promise" || request.operationKind !== "call" ||
    request.memberName !== "then" && request.memberName !== "catch") return undefined;
  const input = rustJsPromiseOutputTargetType(request.receiverCarrier);
  const arguments_ = request.argumentCarriers ?? [];
  const callback = rustCallableProtocol(arguments_[0]) ?? rustClosureProtocol(arguments_[0]);
  if (input === undefined || arguments_.length === 0 ||
    arguments_.length > (request.memberName === "catch" ? 1 : 2)) return undefined;
  const asynchronous = request.memberName === "then" && rustJsPromiseOutputTargetType(callback?.result) !== undefined;
  const output = request.memberName === "catch" ? input : request.authoredMethodTypeArgumentCarriers?.[0] ?? rustInferCarrier;
  const result = rustJsPromiseTargetTypeWithLifetime(output, rustStaticLifetime);
  const callbackResult = asynchronous && output !== rustInferCarrier ? result : output;
  const rejected = rustCallableTargetType([rustProgramErrorTargetType()], callbackResult);
  const parameters = request.memberName === "catch" ? [rejected] : [
    rustCallableTargetType([input], callbackResult), rustOptionTargetType(rejected),
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
      returnedFuture: { awaiting: "fallible", errorBoundary: "source-program" } },
  };
}
