import type { RustBindingProjectionPolicyInput } from "../../model/binding-projections.js";
import type { RustBindingProjectionEmission, RustBindingProjectionOwnership } from "../../../target-model/records/storage/binding-emission.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustJsArrayCarrier, isRustVecCarrier, rustFixedArrayCarrierValue, rustJsArrayLikeElementTargetType, rustStructuralObjectCarrierValue, rustTargetConstInteger } from "../../../target-model/types/index.js";
import { rustTupleTargetType } from "../../types/collections/tuple-carrier.js";
import { selectRustOptionalDefaultStorage } from "../../conversions/optional-storage.js";

export type RustBindingProjectionSelection =
  | { readonly kind: "selected"; readonly value: RustBindingProjectionEmission }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string };

export function selectRustBindingProjectionEmission(input: RustBindingProjectionPolicyInput): RustBindingProjectionSelection {
  const { fact } = input;
  const projection = fact.projection;
  const base = { fact, retainStorage: selectRustOptionalDefaultStorage(Object.freeze({ storage: fact.storageCarrier, result: fact.bindingCarrier })),
    checkedElement: projection.kind === "js-array-element" ? rustJsArrayLikeElementTargetType(fact.sourceCarrier) : undefined };
  const ownership = (carrier: TargetTypeRef): RustBindingProjectionOwnership | undefined => {
    const traits = input.traits.get(carrier);
    return traits?.copy ? "copy" : traits?.clone ? "clone" : undefined;
  };
  const cloneRefusal: RustBindingProjectionSelection = { kind: "rejected", reason: "Binding projection requires an owned value whose exact carrier is not cloneable." };
  switch (projection.kind) {
    case "object-field":
      return ownership(fact.projectedCarrier) === undefined ? cloneRefusal : { kind: "selected", value: {
        ...base, kind: "object-field", storage: projection.storage, index: projection.storageIndex } };
    case "object-rest": {
      const target = rustStructuralObjectCarrierValue(fact.bindingCarrier);
      const fields = [...projection.fields].sort((left, right) => left.targetStorageIndex - right.targetStorageIndex);
      if (target === undefined || fields.length !== target.fields.length || fields.some((field, index) =>
        field.targetStorageIndex !== index || !rustTargetTypeRefEquals(field.carrier, target.fields[index]!.type)))
        return { kind: "invalid", reason: "Object rest projection conflicts with its exact finalized structural carrier." };
      if (fields.some(field => ownership(field.carrier) === undefined)) return cloneRefusal;
      return { kind: "selected", value: { ...base, kind: "object-rest", storage: projection.storage,
        fields: Object.freeze(fields.map((field, index) => Object.freeze({ sourceIndex: field.sourceStorageIndex,
          carrier: field.carrier, method: target.fields[index]!.method === true }))) } };
    }
    case "tuple-element": case "fixed-array-element": case "vec-element": {
      if (projection.kind === "vec-element" && projection.checked) {
        if (fact.sourceCarrier.kind !== "array" || ownership(fact.sourceCarrier.element) === undefined) return cloneRefusal;
        return { kind: "selected", value: { ...base, kind: "checked-vec-element", index: projection.index } };
      }
      const selected = ownership(fact.projectedCarrier);
      return selected === undefined ? cloneRefusal : { kind: "selected", value: { ...base, kind: projection.kind, index: projection.index, ownership: selected } };
    }
    case "js-array-element": return { kind: "selected", value: { ...base, kind: "js-array-element", index: projection.index } };
    case "tuple-rest": {
      if (fact.sourceCarrier.kind !== "tuple") return { kind: "invalid", reason: "Tuple rest projection has no tuple source carrier." };
      const elements = fact.sourceCarrier.elements.slice(projection.start);
      if (!rustTargetTypeRefEquals(rustTupleTargetType(elements), fact.bindingCarrier))
        return { kind: "invalid", reason: "Tuple rest projection conflicts with its finalized binding carrier." };
      const reads = elements.map(ownership);
      if (reads.some(read => read === undefined)) return cloneRefusal;
      return { kind: "selected", value: { ...base, kind: "tuple-rest", start: projection.start,
        elements: Object.freeze(reads as RustBindingProjectionOwnership[]), syntax: rustFixedArrayCarrierValue(fact.bindingCarrier) === undefined ? "tuple" : "slice" } };
    }
    case "fixed-array-rest": {
      const source = rustFixedArrayCarrierValue(fact.sourceCarrier);
      const target = rustFixedArrayCarrierValue(fact.bindingCarrier);
      const length = source === undefined ? undefined : rustTargetConstInteger(source.length);
      const targetLength = target === undefined ? undefined : rustTargetConstInteger(target.length);
      if (source === undefined || length === undefined || BigInt(projection.start) > length ||
        target === undefined && !isRustVecCarrier(fact.bindingCarrier) || target !== undefined && targetLength === undefined)
        return { kind: "invalid", reason: "Fixed-array rest projection has incompatible finalized carriers." };
      if (target !== undefined && (targetLength !== length - BigInt(projection.start) || !rustTargetTypeRefEquals(target.element, source.element)))
        return { kind: "invalid", reason: "Fixed-array rest length or element carrier is inconsistent." };
      if (target === undefined && ownership(source.element) === undefined) return cloneRefusal;
      if (target !== undefined && input.traits.get(source.element)?.copy !== true)
        return { kind: "rejected", reason: "Fixed-array rest projection requires Copy elements for native slice-to-array conversion." };
      return { kind: "selected", value: { ...base, kind: "fixed-array-rest", start: projection.start, end: length.toString(), output: target === undefined ? "vector" : "array" } };
    }
    case "vec-rest":
      if (!isRustVecCarrier(fact.sourceCarrier) || !isRustVecCarrier(fact.bindingCarrier) ||
        !rustTargetTypeRefEquals(fact.sourceCarrier.element, fact.bindingCarrier.element) || ownership(fact.sourceCarrier.element) === undefined)
        return { kind: "rejected", reason: "Vector rest projection has incompatible or non-cloneable finalized carriers." };
      return { kind: "selected", value: { ...base, kind: "vec-rest", start: projection.start } };
    case "js-array-rest":
      return !isRustJsArrayCarrier(fact.bindingCarrier) ? { kind: "invalid", reason: "JavaScript array rest projection conflicts with its finalized binding carrier." }
        : { kind: "selected", value: { ...base, kind: "js-array-rest", start: projection.start } };
  }
}
