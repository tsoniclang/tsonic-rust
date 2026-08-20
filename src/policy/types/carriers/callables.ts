import { rustAsyncGeneratorTargetId, rustCallableTargetId, rustGeneratorTargetId, rustIteratorResultTargetId, rustLocationTargetId, rustOptionTargetId } from "./source-types.js";
import { rustOptionElementCarrier } from "./js.js";
import { rustTupleTargetType, rustUnitTargetType } from "./native.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function rustOptionTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustOptionTargetId, typeArguments: [value] };
}

export function rustLocationTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustLocationTargetId, typeArguments: [pointee] };
}

export function rustCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustCallableTargetId,
    typeArguments: [rustTupleTargetType(parameters), result],
  };
}

export function rustCallableProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustCallableTargetId ||
    carrier.typeArguments?.length !== 2) {
    return undefined;
  }
  const [argumentsCarrier, result] = carrier.typeArguments;
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
    typeArguments: [protocol.yieldType, protocol.returnType, protocol.nextType],
  };
}

export function rustAsyncGeneratorTargetType(
  protocol: Omit<RustGeneratorProtocol, "kind">,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustAsyncGeneratorTargetId,
    typeArguments: [protocol.yieldType, protocol.returnType, protocol.nextType],
  };
}

export function rustIteratorResultTargetType(
  protocol: RustIteratorResultProtocol,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustIteratorResultTargetId,
    typeArguments: [protocol.yieldType, protocol.returnType],
  };
}

export function getRustGeneratorProtocol(
  carrier: TargetTypeRef | undefined,
): RustGeneratorProtocol | undefined {
  if (carrier?.kind !== "target-named" ||
    (carrier.id !== rustGeneratorTargetId && carrier.id !== rustAsyncGeneratorTargetId) ||
    carrier.typeArguments?.length !== 3) {
    return undefined;
  }
  const [yieldType, returnType, nextType] = carrier.typeArguments;
  return yieldType === undefined || returnType === undefined || nextType === undefined
    ? undefined
    : {
        kind: carrier.id === rustGeneratorTargetId ? "sync" : "async",
        yieldType,
        returnType,
        nextType,
      };
}

export function getRustIteratorResultProtocol(
  carrier: TargetTypeRef | undefined,
): RustIteratorResultProtocol | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustIteratorResultTargetId ||
    carrier.typeArguments?.length !== 2) {
    return undefined;
  }
  const [yieldType, returnType] = carrier.typeArguments;
  return yieldType === undefined || returnType === undefined
    ? undefined
    : { yieldType, returnType };
}

export function rustLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" &&
      carrier.id === rustLocationTargetId &&
      carrier.typeArguments?.length === 1
    ? carrier.typeArguments[0]
    : undefined;
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
