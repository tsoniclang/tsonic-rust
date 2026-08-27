import {
  rustAsyncGeneratorTargetId,
  rustBorrowedAsyncGeneratorTargetId,
  rustBorrowedGeneratorTargetId,
  rustCallableTargetId,
  rustGeneratorTargetId,
  rustIteratorResultTargetId,
  rustLocationTargetId,
} from "./source-types.js";
import { rustOptionElementCarrier, rustOptionTargetType } from "./optional.js";
import { rustTupleTargetType, rustUnitTargetType } from "./native.js";
import type { TargetTypeRef } from "../model.js";
import {
  rustLifetimeGenericArgument,
  rustOnlyTypeGenericArguments,
  rustTypeGenericArguments,
} from "../generic-arguments.js";
import type { RustLifetimeRef } from "../../lifetimes/index.js";

export function rustLocationTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustLocationTargetId,
    genericArguments: rustTypeGenericArguments([pointee]),
  };
}

export function rustCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustCallableTargetId,
    genericArguments: rustTypeGenericArguments([rustTupleTargetType(parameters), result]),
  };
}

export function isRustCallableCarrier(
  carrier: TargetTypeRef | undefined,
): boolean {
  return carrier?.kind === "closure" || carrier?.kind === "function-pointer" ||
    carrier?.kind === "target-named" && carrier.id === rustCallableTargetId;
}

export function rustCallableProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustCallableTargetId) {
    return undefined;
  }
  const arguments_ = rustOnlyTypeGenericArguments(carrier.genericArguments);
  if (arguments_?.length !== 2) return undefined;
  const [argumentsCarrier, result] = arguments_;
  return argumentsCarrier?.kind === "tuple" && result !== undefined
    ? { parameters: argumentsCarrier.elements, result }
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
  if (callable === undefined) {
    return undefined;
  }
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

export function rustClosureTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return { kind: "closure", args: parameters, result };
}

export function rustClosureProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  return carrier?.kind === "closure"
    ? { parameters: carrier.args, result: carrier.result }
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
}

export interface RustIteratorResultProtocol {
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
}

export function rustGeneratorTargetType(
  protocol: Omit<RustGeneratorProtocol, "kind">,
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
  protocol: Omit<RustGeneratorProtocol, "kind">,
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

export function rustGeneratorStorageTargetType(
  protocol: RustGeneratorProtocol,
  lifetime: RustLifetimeRef | undefined,
): TargetTypeRef {
  if (lifetime === undefined) {
    return protocol.kind === "sync"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  return {
    kind: "target-named",
    id: protocol.kind === "sync"
      ? rustBorrowedGeneratorTargetId
      : rustBorrowedAsyncGeneratorTargetId,
    genericArguments: Object.freeze([
      rustLifetimeGenericArgument(lifetime),
      ...rustTypeGenericArguments([
        protocol.yieldType,
        protocol.returnType,
        protocol.nextType,
      ]),
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
  if (borrowed && (carrier.genericArguments?.length !== 4 ||
    carrier.genericArguments[0]?.kind !== "lifetime")) {
    return undefined;
  }
  const arguments_ = rustOnlyTypeGenericArguments(genericArguments);
  if (arguments_?.length !== 3) return undefined;
  const [yieldType, returnType, nextType] = arguments_;
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
  return arguments_?.length === 1 ? arguments_[0] : undefined;
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
