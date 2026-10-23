import { rustAsyncGeneratorTargetId, rustBorrowedAsyncGeneratorTargetId, rustBorrowedGeneratorTargetId, rustCallableTargetId, rustCallableInputTargetId, rustGeneratorTargetId, rustIteratorResultTargetId, rustLocationTargetId, rustInfallibleTargetId, rustRawPointerTargetId } from "./source-types.js";
import { rustGeneratorMayReenterTargetId, rustGeneratorNoReentryTargetId } from "./source-types.js";
import { rustOptionElementCarrier } from "./optional.js";

import { rustProgramErrorTargetType } from "./js.js";
import type { TargetTypeRef } from "../model.js";
import { rustLifetimeGenericArgument, rustOnlyTypeGenericArguments, rustTypeGenericArguments } from "../generic-arguments.js";
import { rustPlaceholderLifetime, type RustLifetimeRef } from "../../lifetimes/index.js";
import { rustGenericCallableValue } from "./generic-callables.js";
import { rustFrameCallableProtocol, rustFrameCallableValue } from "./frame-callables.js";

export function rustLocationTargetType(
  pointee: TargetTypeRef,
  error: TargetTypeRef = { kind: "target-named", id: rustInfallibleTargetId },
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustLocationTargetId,
    genericArguments: rustTypeGenericArguments([pointee, error]),
  };
}

export function rustSourceLocationTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return rustLocationTargetType(pointee, rustProgramErrorTargetType());
}

export function rustRawPointerTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustRawPointerTargetId };
}

export function rustCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  lifetime: RustLifetimeRef = rustPlaceholderLifetime,
  error: TargetTypeRef = rustProgramErrorTargetType(),
): TargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: rustCallableTargetId,
    genericArguments: Object.freeze([rustLifetimeGenericArgument(lifetime),
      ...rustTypeGenericArguments([Object.freeze({ kind: "tuple", elements: Object.freeze([...parameters]) }), result, error])]),
  });
}

export function isRustCallableCarrier(
  carrier: TargetTypeRef | undefined,
): boolean {
  return carrier?.kind === "closure" || carrier?.kind === "function-pointer" ||
    rustGenericCallableValue(carrier) !== undefined ||
    rustFrameCallableValue(carrier) !== undefined ||
    rustCallableInputProtocol(carrier) !== undefined ||
    carrier?.kind === "target-named" && carrier.id === rustCallableTargetId;
}

export function rustCallableInputTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  lifetime?: RustLifetimeRef,
): TargetTypeRef {
  return {
    kind: "reference",
    mutable: false,
    ...(lifetime === undefined ? {} : { lifetime }),
    referent: {
      kind: "target-named",
      id: rustCallableInputTargetId,
      genericArguments: rustTypeGenericArguments([{ kind: "tuple", elements: parameters }, result]),
    },
  };
}

export function rustCallableInputProtocol(carrier: TargetTypeRef | undefined):
  { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly error?: TargetTypeRef } | undefined {
  return carrier?.kind === "reference" && !carrier.mutable &&
    carrier.referent.kind === "target-named" && carrier.referent.id === rustCallableInputTargetId
    ? rustCallableProtocol(carrier.referent) : undefined;
}

export function rustCallableProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly lifetime?: RustLifetimeRef;
  readonly error?: TargetTypeRef } | undefined {
  const frame = rustFrameCallableProtocol(carrier);
  if (frame !== undefined) return frame;
  if (carrier?.kind === "reference") return rustCallableInputProtocol(carrier);
  if (carrier?.kind !== "target-named" ||
    carrier.id !== rustCallableTargetId && carrier.id !== rustCallableInputTargetId) {
    return undefined;
  }
  const lifetime = carrier.id === rustCallableTargetId ? carrier.genericArguments?.[0] : undefined;
  if (carrier.id === rustCallableTargetId && lifetime?.kind !== "lifetime") return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(lifetime === undefined ? carrier.genericArguments : carrier.genericArguments?.slice(1));
  if (arguments_?.length !== (lifetime === undefined ? 2 : 3)) return undefined;
  const [argumentsCarrier, result, error] = arguments_;
  return argumentsCarrier?.kind === "tuple" && result !== undefined
    ? { parameters: argumentsCarrier.elements, result, error: error ?? rustProgramErrorTargetType(),
      ...(lifetime?.kind === "lifetime" ? { lifetime: lifetime.lifetime } : {}) }
    : undefined;
}

export function rustStructuralMethodCallableCarrier(
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  const callableCarrier = presence === "optional"
    ? rustOptionElementCarrier(fieldCarrier)
    : fieldCarrier;
  return rustCallableProtocol(callableCarrier) === undefined && rustGenericCallableValue(callableCarrier) === undefined
    ? undefined : callableCarrier;
}

export function rustStructuralPropertyValueCarrier(
  fieldCarrier: TargetTypeRef,
  presence: "required" | "optional",
): TargetTypeRef | undefined {
  return presence === "optional" ? rustOptionElementCarrier(fieldCarrier) : fieldCarrier;
}

export function rustClosureTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  fallible = false,
): TargetTypeRef {
  return { kind: "closure", args: parameters, result, ...(fallible ? { fallible: true } : {}) };
}

export function rustClosureProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly fallible: boolean } | undefined {
  return carrier?.kind === "closure"
    ? { parameters: carrier.args, result: carrier.result, fallible: carrier.fallible === true }
    : undefined;
}

export function rustNativeCallableProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  return carrier?.kind === "function-pointer"
    ? { parameters: carrier.args, result: carrier.result }
    : rustClosureProtocol(carrier);
}

export interface RustGeneratorProtocol {
  readonly kind: "sync" | "async";
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
  readonly physical?: {
    readonly errorCarrier: TargetTypeRef;
    readonly reentry: "excluded" | "possible";
  };
}

export interface RustIteratorResultProtocol {
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
}

export function rustGeneratorTargetType(
  protocol: Pick<RustGeneratorProtocol, "yieldType" | "returnType" | "nextType">,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustGeneratorTargetId,
    genericArguments: rustTypeGenericArguments([
      protocol.yieldType,
      protocol.returnType,
      protocol.nextType,
    ]),
  };
}

export function rustAsyncGeneratorTargetType(
  protocol: Pick<RustGeneratorProtocol, "yieldType" | "returnType" | "nextType">,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustAsyncGeneratorTargetId,
    genericArguments: rustTypeGenericArguments([
      protocol.yieldType,
      protocol.returnType,
      protocol.nextType,
    ]),
  };
}

export function rustIteratorResultTargetType(
  protocol: RustIteratorResultProtocol,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustIteratorResultTargetId,
    genericArguments: rustTypeGenericArguments([protocol.yieldType, protocol.returnType]),
  };
}

export function getRustGeneratorProtocol(
  carrier: TargetTypeRef | undefined,
): RustGeneratorProtocol | undefined {
  if (carrier?.kind !== "target-named") {
    return undefined;
  }
  const borrowed = carrier.id === rustBorrowedGeneratorTargetId ||
    carrier.id === rustBorrowedAsyncGeneratorTargetId;
  const standard = carrier.id === rustGeneratorTargetId ||
    carrier.id === rustAsyncGeneratorTargetId;
  if (!standard && !borrowed) return undefined;
  const genericArguments = borrowed
    ? carrier.genericArguments?.slice(1)
    : carrier.genericArguments;
  if (borrowed && (carrier.genericArguments?.length !== 6 ||
    carrier.genericArguments[0]?.kind !== "lifetime")) {
    return undefined;
  }
  const arguments_ = rustOnlyTypeGenericArguments(genericArguments);
  if (arguments_ === undefined || arguments_.length !== 3 && arguments_.length !== 5 || borrowed && arguments_.length !== 5) return undefined;
  const [yieldType, returnType, nextType] = arguments_;
  const errorCarrier = arguments_[3];
  const policy = arguments_[4];
  const reentry = policy?.kind !== "target-named" || (policy.genericArguments?.length ?? 0) !== 0 ? undefined
    : policy.id === rustGeneratorNoReentryTargetId ? "excluded"
      : policy.id === rustGeneratorMayReenterTargetId ? "possible" : undefined;
  if (arguments_.length === 5 && (errorCarrier === undefined || reentry === undefined)) return undefined;
  return yieldType === undefined || returnType === undefined || nextType === undefined
    ? undefined
    : {
        kind: carrier.id === rustGeneratorTargetId ||
            carrier.id === rustBorrowedGeneratorTargetId
          ? "sync"
          : "async",
        yieldType,
        returnType,
        nextType,
        ...(errorCarrier === undefined || reentry === undefined ? {} : { physical: { errorCarrier, reentry } }),
      };
}

export function getRustIteratorResultProtocol(
  carrier: TargetTypeRef | undefined,
): RustIteratorResultProtocol | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustIteratorResultTargetId) {
    return undefined;
  }
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  if (arguments_?.length !== 2) return undefined;
  const [yieldType, returnType] = arguments_;
  return yieldType === undefined || returnType === undefined
    ? undefined
    : { yieldType, returnType };
}

export function rustLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustLocationTargetId) return undefined;
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  return arguments_?.length === 2 ? arguments_[0] : undefined;
}

export function rustOptionalLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const optionalValue = rustOptionElementCarrier(carrier);
  return rustLocationPointeeCarrier(optionalValue ?? carrier);
}

export function isRustLocationCarrier(
  carrier: TargetTypeRef | undefined,
): boolean {
  return rustLocationPointeeCarrier(carrier) !== undefined;
}
