import {
  rustBorrowedAsyncGeneratorTargetId,
  rustBorrowedGeneratorTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustBorrowedLocalCallableTargetId,
  rustBorrowedLocationTargetId,
  rustIteratorResultTargetId,
  rustOwnedAsyncGeneratorTargetId,
  rustOwnedGeneratorTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustOwnedLocalCallableTargetId,
  rustOwnedLocationTargetId,
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
} from "./source-types.js";
import {
  rustBuiltinGenericPathTargetType,
  rustBuiltinTypeIdentityItemId,
  rustPathGenericArguments,
} from "../constructors.js";
import { rustOptionElementCarrier, rustOptionTargetType } from "./optional.js";
import {
  rustTupleElementCarriers,
  rustTupleTargetType,
  rustUnitTargetType,
} from "./native.js";
import type {
  RustBinder,
  RustGenericArgument,
  RustLifetimeRef,
} from "../../semantics/index.js";
import {
  rustLifetimeSemanticKey,
} from "../../semantics/index.js";
import type { TargetTypeRef } from "../model.js";
import { rustFutureOutputCarrier, rustFutureTargetType } from "./primitives.js";
import {
  rustCallableSignaturesAlphaEquivalent,
} from "../alpha-equivalence.js";
import {
  emptyRustGenericSubstitutions,
  inferRustTargetGenericSubstitutions,
  substituteRustTargetGenerics,
  type RustGenericParameterIdentitySets,
  type RustGenericSubstitutions,
} from "../generic-substitution.js";

function runtimeCallableType(
  id: string,
  path: string,
  argumentsList: readonly RustGenericArgument[],
): TargetTypeRef {
  return rustBuiltinGenericPathTargetType(id, path, argumentsList, "tsonic-runtime");
}

export interface RustLocationProtocol {
  readonly storage: "owned" | "borrowed";
  readonly pointee: TargetTypeRef;
  readonly lifetime?: RustLifetimeRef;
}

export function rustLocationTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return runtimeCallableType(
    rustOwnedLocationTargetId,
    "rt::OwnedLocation",
    [{ kind: "type", value: pointee }],
  );
}

export function rustBorrowedLocationTargetType(
  pointee: TargetTypeRef,
  lifetime: RustLifetimeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustBorrowedLocationTargetId,
    "rt::BorrowedLocation",
    [{ kind: "lifetime", value: lifetime }, { kind: "type", value: pointee }],
  );
}

export interface RustCallableProtocol {
  readonly storage: "owned-local" | "borrowed-local" | "threaded";
  readonly asynchronous: boolean;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly lifetime?: RustLifetimeRef;
}

export interface RustCallableSignature {
  readonly binder?: RustBinder;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
}

export interface RustCallableBoundaryProtocol extends RustCallableSignature {
  readonly callTrait: "fn" | "fn-mut" | "fn-once";
  readonly invocation: "direct" | "runtime-call";
  readonly failureChannel: "none" | "result" | "future-output";
}

export {
  rustBoundSemanticValuesAlphaEquivalent,
  rustCallableBindersAlphaEquivalent,
  rustCallableSignaturesAlphaEquivalent,
} from "../alpha-equivalence.js";

export function rustCallTraitSatisfies(
  actual: RustCallableBoundaryProtocol["callTrait"],
  required: RustCallableBoundaryProtocol["callTrait"],
): boolean {
  return required === "fn-once" ||
    required === "fn-mut" && actual !== "fn-once" ||
    required === "fn" && actual === "fn";
}

export function rustCallableBoundaryCanAdapt(
  actual: TargetTypeRef | undefined,
  required: TargetTypeRef | undefined,
): boolean {
  const actualProtocol = rustCallableBoundaryProtocol(actual);
  const requiredProtocol = rustCallableBoundaryProtocol(required);
  return actualProtocol !== undefined && requiredProtocol !== undefined &&
    rustCallTraitSatisfies(actualProtocol.callTrait, requiredProtocol.callTrait) &&
    rustCallableSignaturesAlphaEquivalent(actualProtocol, requiredProtocol);
}

export function rustCallableBoundaryProtocol(
  carrier: TargetTypeRef | undefined,
): RustCallableBoundaryProtocol | undefined {
  if (carrier?.kind === "closure") {
    return Object.freeze({
      ...(carrier.binder === undefined ? {} : { binder: carrier.binder }),
      callTrait: carrier.callTrait,
      invocation: "direct",
      failureChannel: "none",
      parameters: carrier.parameters,
      result: carrier.result,
    });
  }
  if (carrier?.kind === "function-pointer") {
    return carrier.safety !== "safe" || carrier.abi !== "Rust" || carrier.variadic
      ? undefined
      : Object.freeze({
          ...(carrier.binder === undefined ? {} : { binder: carrier.binder }),
          callTrait: "fn" as const,
          invocation: "direct" as const,
          failureChannel: "none" as const,
          parameters: carrier.parameters,
          result: carrier.result,
        });
  }
  const callable = rustCallableProtocol(carrier);
  return callable === undefined
    ? undefined
    : Object.freeze({
        callTrait: "fn" as const,
        invocation: "runtime-call" as const,
        failureChannel: callable.asynchronous ? "future-output" as const : "result" as const,
        parameters: callable.parameters,
        result: callable.result,
      });
}

export function rustCallableSignature(
  carrier: TargetTypeRef | undefined,
): RustCallableSignature | undefined {
  if (carrier?.kind === "function-pointer" || carrier?.kind === "closure") {
    return Object.freeze({
      ...(carrier.binder === undefined ? {} : { binder: carrier.binder }),
      parameters: carrier.parameters,
      result: carrier.result,
    });
  }
  const callable = rustCallableProtocol(carrier);
  return callable === undefined
    ? undefined
    : Object.freeze({ parameters: callable.parameters, result: callable.result });
}

export function instantiateRustCallableSignature(
  carrier: TargetTypeRef | undefined,
  arguments_: readonly TargetTypeRef[],
): RustCallableSignature | undefined {
  const signature = rustCallableSignature(carrier);
  if (signature === undefined || signature.parameters.length !== arguments_.length) {
    return undefined;
  }
  if (signature.binder === undefined) return signature;
  const lifetimeKeys = rustCallableBinderLifetimeKeys(signature.binder);
  if (lifetimeKeys === undefined) return undefined;
  const parameters: RustGenericParameterIdentitySets = Object.freeze({
    lifetimes: lifetimeKeys,
    types: new Set<string>(),
    consts: new Set<string>(),
    associatedTypes: new Set<string>(),
  });
  let substitutions: RustGenericSubstitutions = emptyRustGenericSubstitutions;
  for (let index = 0; index < signature.parameters.length; index += 1) {
    const inferred = inferRustTargetGenericSubstitutions(
      signature.parameters[index]!,
      arguments_[index]!,
      parameters,
      substitutions,
    );
    if (inferred === undefined) return undefined;
    substitutions = inferred;
  }
  if ([...lifetimeKeys].some((key) => !substitutions.lifetimes.has(key))) return undefined;
  return Object.freeze({
    parameters: Object.freeze(signature.parameters.map((parameter) =>
      substituteRustTargetGenerics(parameter, substitutions))),
    result: substituteRustTargetGenerics(signature.result, substitutions),
  });
}

function rustCallableBinderLifetimeKeys(
  binder: RustBinder,
): ReadonlySet<string> | undefined {
  const keys = new Set<string>();
  for (const parameter of binder.lifetimes) {
    if (parameter.identity.kind !== "bound" || parameter.identity.binderId !== binder.id) {
      return undefined;
    }
    const key = rustLifetimeSemanticKey(parameter.identity);
    if (keys.has(key)) return undefined;
    keys.add(key);
  }
  return keys;
}

export function rustCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustOwnedLocalCallableTargetId,
    "rt::OwnedLocalCallable",
    [
      { kind: "type", value: rustTupleTargetType(parameters) },
      { kind: "type", value: result },
    ],
  );
}

export function rustBorrowedCallableTargetType(
  lifetime: RustLifetimeRef,
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustBorrowedLocalCallableTargetId,
    "rt::BorrowedLocalCallable",
    [
      { kind: "lifetime", value: lifetime },
      { kind: "type", value: rustTupleTargetType(parameters) },
      { kind: "type", value: result },
    ],
  );
}

export function rustThreadedCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustThreadedCallableTargetId,
    "rt::ThreadedCallable",
    [
      { kind: "type", value: rustTupleTargetType(parameters) },
      { kind: "type", value: result },
    ],
  );
}

export function rustAsyncCallableTargetType(
  parameters: readonly TargetTypeRef[],
  output: TargetTypeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustOwnedLocalAsyncCallableTargetId,
    "rt::OwnedLocalAsyncCallable",
    [
      { kind: "type", value: rustTupleTargetType(parameters) },
      { kind: "type", value: output },
    ],
  );
}

export function rustBorrowedAsyncCallableTargetType(
  lifetime: RustLifetimeRef,
  parameters: readonly TargetTypeRef[],
  output: TargetTypeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustBorrowedLocalAsyncCallableTargetId,
    "rt::BorrowedLocalAsyncCallable",
    [
      { kind: "lifetime", value: lifetime },
      { kind: "type", value: rustTupleTargetType(parameters) },
      { kind: "type", value: output },
    ],
  );
}

export function rustThreadedAsyncCallableTargetType(
  parameters: readonly TargetTypeRef[],
  output: TargetTypeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustThreadedAsyncCallableTargetId,
    "rt::ThreadedAsyncCallable",
    [
      { kind: "type", value: rustTupleTargetType(parameters) },
      { kind: "type", value: output },
    ],
  );
}

export function isRustCallableCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "closure" || carrier?.kind === "function-pointer" ||
    rustCallableProtocol(carrier) !== undefined;
}

export function rustCallableProtocol(
  carrier: TargetTypeRef | undefined,
): RustCallableProtocol | undefined {
  const id = rustBuiltinTypeIdentityItemId(carrier, "tsonic-runtime");
  const argumentsList = rustPathGenericArguments(carrier);
  if (id === rustOwnedLocalCallableTargetId || id === rustThreadedCallableTargetId ||
    id === rustOwnedLocalAsyncCallableTargetId || id === rustThreadedAsyncCallableTargetId) {
    const [argumentsCarrier, result] = argumentsList ?? [];
    const parameters = argumentsCarrier?.kind === "type"
      ? rustTupleElementCarriers(argumentsCarrier.value)
      : undefined;
    const asynchronous = id === rustOwnedLocalAsyncCallableTargetId ||
      id === rustThreadedAsyncCallableTargetId;
    return argumentsList?.length === 2 && argumentsCarrier?.kind === "type" &&
        parameters !== undefined && result?.kind === "type"
      ? {
          storage: id === rustThreadedCallableTargetId || id === rustThreadedAsyncCallableTargetId
            ? "threaded"
            : "owned-local",
          asynchronous,
          parameters,
          result: asynchronous ? rustFutureTargetType(result.value) : result.value,
        }
      : undefined;
  }
  if (id === rustBorrowedLocalCallableTargetId || id === rustBorrowedLocalAsyncCallableTargetId) {
    const [lifetime, argumentsCarrier, result] = argumentsList ?? [];
    const parameters = argumentsCarrier?.kind === "type"
      ? rustTupleElementCarriers(argumentsCarrier.value)
      : undefined;
    const asynchronous = id === rustBorrowedLocalAsyncCallableTargetId;
    return argumentsList?.length === 3 && lifetime?.kind === "lifetime" &&
        argumentsCarrier?.kind === "type" && parameters !== undefined &&
        result?.kind === "type"
      ? {
          storage: "borrowed-local",
          asynchronous,
          lifetime: lifetime.value,
          parameters,
          result: asynchronous ? rustFutureTargetType(result.value) : result.value,
        }
      : undefined;
  }
  return undefined;
}

export function rustCallableTargetTypeWithSignature(
  carrier: TargetTypeRef,
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef | undefined {
  if (carrier.kind === "function-pointer" || carrier.kind === "closure") {
    return Object.freeze({ ...carrier, parameters: Object.freeze([...parameters]), result });
  }
  const protocol = rustCallableProtocol(carrier);
  if (protocol === undefined) return undefined;
  if (!protocol.asynchronous) {
    return protocol.storage === "owned-local"
      ? rustCallableTargetType(parameters, result)
      : protocol.storage === "borrowed-local" && protocol.lifetime !== undefined
        ? rustBorrowedCallableTargetType(protocol.lifetime, parameters, result)
        : protocol.storage === "threaded"
          ? rustThreadedCallableTargetType(parameters, result)
          : undefined;
  }
  const output = rustFutureOutputCarrier(result);
  if (output === undefined) return undefined;
  return protocol.storage === "owned-local"
    ? rustAsyncCallableTargetType(parameters, output)
    : protocol.storage === "borrowed-local" && protocol.lifetime !== undefined
      ? rustBorrowedAsyncCallableTargetType(protocol.lifetime, parameters, output)
      : protocol.storage === "threaded"
        ? rustThreadedAsyncCallableTargetType(parameters, output)
        : undefined;
}

export function rustStructuralMethodCallableCarrier(
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const callableCarrier = presence === "optional"
    ? rustOptionElementCarrier(fieldCarrier)
    : fieldCarrier;
  return rustCallableProtocol(callableCarrier) === undefined ? undefined : callableCarrier;
}

export function rustStructuralMethodStorageCarrier(
  receiverCarrier: TargetTypeRef,
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const callableCarrier = rustStructuralMethodCallableCarrier(fieldCarrier, presence);
  const callable = rustCallableProtocol(callableCarrier);
  if (callable === undefined) return undefined;
  const storageCarrier = rustCallableTargetType(
    [receiverCarrier, ...callable.parameters],
    callable.result,
  );
  return presence === "optional" ? rustOptionTargetType(storageCarrier) : storageCarrier;
}

export function rustStructuralPropertyValueCarrier(
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  return presence === "optional" ? rustOptionElementCarrier(fieldCarrier) : fieldCarrier;
}

export function rustStructuralPropertyGetterStorageCarrier(
  receiverCarrier: TargetTypeRef,
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const valueCarrier = rustStructuralPropertyValueCarrier(fieldCarrier, presence);
  return valueCarrier === undefined
    ? undefined
    : rustOptionTargetType(rustCallableTargetType([receiverCarrier], valueCarrier));
}

export function rustStructuralPropertySetterStorageCarrier(
  receiverCarrier: TargetTypeRef,
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const valueCarrier = rustStructuralPropertyValueCarrier(fieldCarrier, presence);
  return valueCarrier === undefined
    ? undefined
    : rustOptionTargetType(rustCallableTargetType(
        [receiverCarrier, valueCarrier],
        rustUnitTargetType(),
      ));
}

export interface RustClosureProtocol {
  readonly binder?: import("../../semantics/index.js").RustBinder;
  readonly callTrait: "fn" | "fn-mut" | "fn-once";
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly captures: readonly import("../../semantics/index.js").RustCapturedGeneric[];
}

export function rustClosureProtocol(
  carrier: TargetTypeRef | undefined,
): RustClosureProtocol | undefined {
  return carrier?.kind === "closure"
    ? {
        ...(carrier.binder === undefined ? {} : { binder: carrier.binder }),
        callTrait: carrier.callTrait,
        parameters: carrier.parameters,
        result: carrier.result,
        captures: carrier.captures,
      }
    : undefined;
}

export interface RustGeneratorProtocol {
  readonly kind: "sync" | "async";
  readonly storage: "owned" | "borrowed";
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
  readonly lifetime?: RustLifetimeRef;
}

export interface RustIteratorResultProtocol {
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
}

type RustGeneratorValueProtocol = Pick<
  RustGeneratorProtocol,
  "yieldType" | "returnType" | "nextType"
>;

export function rustGeneratorTargetType(protocol: RustGeneratorValueProtocol): TargetTypeRef {
  return runtimeCallableType(
    rustOwnedGeneratorTargetId,
    "rt::OwnedGenerator",
    generatorTypeArguments(protocol),
  );
}

export function rustBorrowedGeneratorTargetType(
  protocol: RustGeneratorValueProtocol,
  lifetime: RustLifetimeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustBorrowedGeneratorTargetId,
    "rt::BorrowedGenerator",
    [{ kind: "lifetime", value: lifetime }, ...generatorTypeArguments(protocol)],
  );
}

export function rustAsyncGeneratorTargetType(protocol: RustGeneratorValueProtocol): TargetTypeRef {
  return runtimeCallableType(
    rustOwnedAsyncGeneratorTargetId,
    "rt::OwnedAsyncGenerator",
    generatorTypeArguments(protocol),
  );
}

export function rustBorrowedAsyncGeneratorTargetType(
  protocol: RustGeneratorValueProtocol,
  lifetime: RustLifetimeRef,
): TargetTypeRef {
  return runtimeCallableType(
    rustBorrowedAsyncGeneratorTargetId,
    "rt::BorrowedAsyncGenerator",
    [{ kind: "lifetime", value: lifetime }, ...generatorTypeArguments(protocol)],
  );
}

export function rustIteratorResultTargetType(
  protocol: RustIteratorResultProtocol,
): TargetTypeRef {
  return runtimeCallableType(
    rustIteratorResultTargetId,
    "rt::IteratorResult",
    [
      { kind: "type", value: protocol.yieldType },
      { kind: "type", value: protocol.returnType },
    ],
  );
}

export function getRustGeneratorProtocol(
  carrier: TargetTypeRef | undefined,
): RustGeneratorProtocol | undefined {
  const id = rustBuiltinTypeIdentityItemId(carrier, "tsonic-runtime");
  const kind = id === rustOwnedGeneratorTargetId || id === rustBorrowedGeneratorTargetId
    ? "sync" as const
    : id === rustOwnedAsyncGeneratorTargetId || id === rustBorrowedAsyncGeneratorTargetId
      ? "async" as const
      : undefined;
  if (kind === undefined) return undefined;
  const argumentsList = rustPathGenericArguments(carrier);
  const borrowed = id === rustBorrowedGeneratorTargetId || id === rustBorrowedAsyncGeneratorTargetId;
  const lifetime = borrowed ? argumentsList?.[0] : undefined;
  const offset = borrowed ? 1 : 0;
  const yieldType = argumentsList?.[offset];
  const returnType = argumentsList?.[offset + 1];
  const nextType = argumentsList?.[offset + 2];
  return argumentsList?.length === offset + 3 &&
      (!borrowed || lifetime?.kind === "lifetime") &&
      yieldType?.kind === "type" && returnType?.kind === "type" && nextType?.kind === "type"
    ? {
        kind,
        storage: borrowed ? "borrowed" : "owned",
        yieldType: yieldType.value,
        returnType: returnType.value,
        nextType: nextType.value,
        ...(lifetime?.kind === "lifetime" ? { lifetime: lifetime.value } : {}),
      }
    : undefined;
}

export function getRustIteratorResultProtocol(
  carrier: TargetTypeRef | undefined,
): RustIteratorResultProtocol | undefined {
  const argumentsList = rustBuiltinTypeIdentityItemId(carrier, "tsonic-runtime") === rustIteratorResultTargetId && carrier !== undefined
    ? rustPathGenericArguments(carrier)
    : undefined;
  const [yieldType, returnType] = argumentsList ?? [];
  return argumentsList?.length === 2 && yieldType?.kind === "type" && returnType?.kind === "type"
    ? { yieldType: yieldType.value, returnType: returnType.value }
    : undefined;
}

export function rustLocationProtocol(
  carrier: TargetTypeRef | undefined,
): RustLocationProtocol | undefined {
  const id = rustBuiltinTypeIdentityItemId(carrier, "tsonic-runtime");
  const argumentsList = rustPathGenericArguments(carrier);
  if (id === rustOwnedLocationTargetId) {
    const [pointee] = argumentsList ?? [];
    return argumentsList?.length === 1 && pointee?.kind === "type"
      ? { storage: "owned", pointee: pointee.value }
      : undefined;
  }
  if (id === rustBorrowedLocationTargetId) {
    const [lifetime, pointee] = argumentsList ?? [];
    return argumentsList?.length === 2 && lifetime?.kind === "lifetime" && pointee?.kind === "type"
      ? { storage: "borrowed", lifetime: lifetime.value, pointee: pointee.value }
      : undefined;
  }
  return undefined;
}

export function rustLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return rustLocationProtocol(carrier)?.pointee;
}

export function rustOptionalLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const optionalValue = rustOptionElementCarrier(carrier);
  return rustLocationPointeeCarrier(optionalValue ?? carrier);
}

export function isRustLocationCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustLocationProtocol(carrier) !== undefined;
}

function generatorTypeArguments(
  protocol: RustGeneratorValueProtocol,
): readonly RustGenericArgument[] {
  return Object.freeze([
    { kind: "type" as const, value: protocol.yieldType },
    { kind: "type" as const, value: protocol.returnType },
    { kind: "type" as const, value: protocol.nextType },
  ]);
}
