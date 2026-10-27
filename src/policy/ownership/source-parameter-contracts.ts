import type { RustSourceParameterAbiFact } from "../../target-model/records/callables/callables-and-resources.js";

import { inferRustTargetGenericBindings, rustTargetGenericReferences, substituteRustTargetGenerics, isRustVecCarrier, isRustStringCarrier, rustFixedArrayCarrierValue, rustSourceOptionalTargetType, rustSliceElementCarrier, rustSliceRefTargetType, rustStructuralObjectCarrierValue, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustArgumentMode } from "../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetGenericBindings } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../constraints/native-traits.js";

export function rustSourceParameterContractCarrier(
  abi: RustSourceParameterAbiFact,
): TargetTypeRef {
  return abi.parameterCarrier.kind === "reference"
    ? abi.parameterCarrier.referent
    : abi.parameterCarrier;
}

export function instantiateRustSourceParameterValueCarrier(
  abi: RustSourceParameterAbiFact,
  selectedParameterCarrier: TargetTypeRef,
  selectedBindings: RustTargetGenericBindings,
  normalize: (carrier: TargetTypeRef) => TargetTypeRef,
): TargetTypeRef | undefined {
  const references = rustTargetGenericReferences(abi.parameterCarrier);
  const substituteSelected = (carrier: TargetTypeRef): TargetTypeRef =>
    substituteRustTargetGenerics(
      carrier,
      selectedBindings.types,
      selectedBindings.lifetimes,
      selectedBindings.consts,
      normalize,
    );
  const bindings = inferRustTargetGenericBindings(
    substituteSelected(abi.parameterCarrier),
    selectedParameterCarrier,
    {
      typeIdentities: new Set(references.typeIdentities.filter((name) => !selectedBindings.types.has(name))),
      lifetimeIdentities: new Set(references.lifetimeIdentities.filter((identity) => !selectedBindings.lifetimes.has(identity))),
      constIdentities: new Set(references.constIdentities.filter((identity) => !selectedBindings.consts.has(identity))),
    },
  );
  return bindings === undefined
    ? undefined
    : substituteRustTargetGenerics(
        substituteSelected(abi.valueCarrier),
        bindings.types,
        bindings.lifetimes,
        bindings.consts,
        normalize,
      );
}

export function rustParameterModeForCarriers(
  valueCarrier: TargetTypeRef,
  parameterCarrier: TargetTypeRef,
  carriersEqual: (
    left: TargetTypeRef | undefined,
    right: TargetTypeRef | undefined,
  ) => boolean = rustTargetTypeRefEquals,
): RustArgumentMode | undefined {
  if (carriersEqual(valueCarrier, parameterCarrier)) {
    return "value";
  }
  if (parameterCarrier.kind !== "reference" ||
    !carriersEqual(parameterCarrier.referent, valueCarrier) &&
    !(isRustVecCarrier(valueCarrier) &&
      carriersEqual(rustSliceElementCarrier(parameterCarrier), valueCarrier.element))) {
    return undefined;
  }
  return parameterCarrier.mutable ? "mut-ref" : "ref";
}

export function selectRustSourceParameterBorrowCarrier(
  base: TargetTypeRef,
  parameterLaneCarrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (parameterLaneCarrier === undefined) return undefined;
  if (isRustVecCarrier(base)) return rustSliceRefTargetType(base.element);
  return rustTargetTypeRefEquals(parameterLaneCarrier, base) &&
    (isRustStringCarrier(base) || rustFixedArrayCarrierValue(base) !== undefined && !isRustCopyCarrier(base) ||
      rustStructuralObjectCarrierValue(base)?.representation === "reference" ||
      rustSourceTypeCarrierValue(base)?.shape === "object")
    ? { kind: "reference", referent: base, mutable: false } : undefined;
}

export function rustSourceParameterSupportsMemberWrites(
  carrier: TargetTypeRef,
  writableFields: ReadonlySet<number>,
): boolean {
  const structural = rustStructuralObjectCarrierValue(carrier);
  return structural !== undefined && [...writableFields].every(index =>
    Number.isSafeInteger(index) && index >= 0 && structural.fields[index] !== undefined &&
    !structural.fields[index]!.readonly && structural.fields[index]!.accessor?.setter !== false);
}

export function selectRustSourceParameterAbi(
  form: RustSourceParameterAbiFact["form"],
  base: TargetTypeRef,
  requiredParameterCarrier: TargetTypeRef | undefined,
): RustSourceParameterAbiFact | undefined {
  const requiredMode = requiredParameterCarrier === undefined
    ? undefined
    : rustParameterModeForCarriers(base, requiredParameterCarrier);
  return form === "optional"
    ? {
        form,
        valueCarrier: rustSourceOptionalTargetType(base),
        parameterCarrier: rustSourceOptionalTargetType(base),
        mode: "value" as const,
      }
    : form === "default"
      ? {
          form,
          valueCarrier: base,
          parameterCarrier: rustSourceOptionalTargetType(base),
          mode: "value" as const,
        }
      : form === "rest"
        ? {
            form,
            valueCarrier: base,
            parameterCarrier: base,
            mode: "value" as const,
          }
      : requiredParameterCarrier !== undefined && requiredMode !== undefined
          ? {
              form,
              valueCarrier: base,
              parameterCarrier: requiredParameterCarrier,
              mode: requiredMode,
            }
          : undefined;

}
