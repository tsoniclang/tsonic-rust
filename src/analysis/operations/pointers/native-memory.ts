import { countTsonicMemoryLayoutValues } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact } from "@tsonic/source-core/facts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustNativeMemoryLayout } from "../../../target-model/operations/native-memory.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../../types/resolution/model.js";
import { resolveRustTargetTypeRef } from "../../types/resolution/source.js";
import { resolveRustFixedArrayTargetType } from "../../types/resolution/target.js";
import { providerCarrierFromRelations } from "../../../policy/types/project/provider-instantiation.js";
import { resolveProviderTypeIdentity } from "../../../policy/identities/provider-types.js";
import { selectRustProviderOperation, rustProviderOperationOwnerMatches } from "../../../policy/operations/provider-selection.js";
import { rustFixedArrayCarrierValue, rustNamedTypeCarrierValue, rustStructuralObjectCarrierValue, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../../policy/constraints/native-traits.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

type RustNativeMemorySelection = RustNativeMemoryLayout | {
  readonly kind: "unsupported-array";
  readonly reason: string;
};

export function resolveRustMemoryLayoutPointee(
  layout: TsonicMemoryLayoutFact, context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const layoutContext = { ...context, currentSemantics: context.semanticsFor(layout.call),
    currentSourceFile: context.ast.getSourceFile(layout.call)! };
  return layout.kind === "array"
    ? resolveRustFixedArrayTargetType(layout.fixedArray, layoutContext, options, new Set<object>())
    : resolveRustTargetTypeRef(layout.explicitTypeNode ?? layout.sourceType, layoutContext, options);
}

export function selectRustNativeMemoryLayout(
  layout: TsonicMemoryLayoutFact, context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions,
  selected = new Map<TsonicMemoryLayoutFact, RustNativeMemorySelection | undefined>(),
): RustNativeMemorySelection | undefined {
  if (selected.size === 0 && countTsonicMemoryLayoutValues(layout, 131_072) === undefined) return undefined;
  if (selected.has(layout)) return selected.get(layout);
  selected.set(layout, undefined);
  const pointeeCarrier = resolveRustMemoryLayoutPointee(layout, context, options);
  if (pointeeCarrier === undefined) return undefined;
  if (layout.kind === "array") {
    const array = rustFixedArrayCarrierValue(pointeeCarrier);
    const element = selectRustNativeMemoryLayout(layout.elementLayout, context, options, selected);
    if (element?.kind === "unsupported-array") { selected.set(layout, element); return element; }
    if (array === undefined || array.length.kind !== "integer" ||
      BigInt(array.length.value) !== layout.fixedArray.length || element === undefined ||
      !isRustCopyCarrier(pointeeCarrier) || !rustTargetTypeRefEquals(array.element, element.pointeeCarrier) ||
      element.width !== layout.dataLayout.addressWidth || element.littleEndian !== (layout.dataLayout.byteOrder === "little")) return undefined;
    if (layout.fixedArray.length > (1n << BigInt(layout.dataLayout.addressWidth)) - 1n) {
      const rejected = Object.freeze({ kind: "unsupported-array" as const,
        reason: "The exact fixed-array extent exceeds the selected native address-width range." });
      selected.set(layout, rejected);
      return rejected;
    }
    const result: RustNativeMemoryLayout = Object.freeze({
      kind: "array", pointeeCarrier, length: layout.fixedArray.length.toString(),
      stride: layout.elementLayout.stride, element,
      size: layout.byteSize, alignment: layout.byteAlignment,
      width: layout.dataLayout.addressWidth, littleEndian: layout.dataLayout.byteOrder === "little",
    });
    selected.set(layout, result);
    return result;
  }
  for (const field of layout.fields) {
    const child = selectRustNativeMemoryLayout(field.fieldLayout, context, options, selected);
    if (child?.kind === "unsupported-array") {
      selected.set(layout, child);
      return child;
    }
  }
  const sizes: Readonly<Partial<Record<string, bigint>>> = {
    int8: 1n, uint8: 1n, int16: 2n, uint16: 2n, int32: 4n, uint32: 4n,
    int64: 8n, uint64: 8n, int128: 16n, uint128: 16n, float32: 4n, float64: 8n,
    "native-int": BigInt(layout.dataLayout.addressWidth) / 8n, "native-uint": BigInt(layout.dataLayout.addressWidth) / 8n,
  };
  const fields: import("../../../target-model/operations/native-memory.js").RustNativeMemoryField[] = [];
  const structural = rustStructuralObjectCarrierValue(pointeeCarrier);
  if (pointeeCarrier.kind === "source-primitive") {
    if (layout.fields.length !== 0 || sizes[pointeeCarrier.name] !== layout.byteSize) return undefined;
  } else if (structural !== undefined) {
    if (structural.representation !== "value" || !isRustCopyCarrier(pointeeCarrier) ||
      structural.fields.length !== layout.fields.length) return undefined;
    const usedFields = new Set<number>();
    for (const field of layout.fields) {
      const declaration = options.sourceTypes.structuralFieldProjectionForDeclaration(field.selectedDeclaration, pointeeCarrier);
      const symbol = field.selectedSymbol === undefined ? undefined :
        options.sourceTypes.structuralFieldProjectionForSymbol(field.selectedSymbol, pointeeCarrier);
      const selectedField = declaration ?? symbol;
      if (selectedField === undefined || declaration !== undefined && symbol !== undefined &&
        declaration.field.storageIndex !== symbol.field.storageIndex) return undefined;
      const index = selectedField.field.storageIndex;
      const member = structural.fields[index];
      const child = selectRustNativeMemoryLayout(field.fieldLayout, context, options, selected);
      if (child?.kind === "unsupported-array") { selected.set(layout, child); return child; }
      if (member === undefined || usedFields.has(index) || member.accessor !== undefined || member.method === true ||
        member.presence !== "required" || child === undefined ||
        !rustTargetTypeRefEquals(selectedField.shape.carrier, pointeeCarrier) ||
        !rustTargetTypeRefEquals(member.type, child.pointeeCarrier) ||
        !rustTargetTypeRefEquals(selectedField.field.resultCarrier, child.pointeeCarrier)) return undefined;
      usedFields.add(index);
      fields.push(Object.freeze({ projection: Object.freeze({ kind: "value-field", storageIndex: index }),
        offset: field.byteOffset, alignment: field.byteAlignment, layout: child }));
    }
  } else {
    const named = rustNamedTypeCarrierValue(pointeeCarrier);
    if (named === undefined || !isRustCopyCarrier(pointeeCarrier)) return undefined;
    const identity = resolveProviderTypeIdentity(context.currentSemantics.facts.typeSubjects(layout.sourceType), context);
    const typeRow = identity === undefined ? undefined : providerCarrierFromRelations(identity, options);
    const fieldIds = typeRow?.nativeMemoryFieldIds;
    if (typeRow === undefined || fieldIds === undefined || new Set(fieldIds).size !== fieldIds.length ||
      fieldIds.length !== layout.fields.length) return undefined;
    const substitutions = rustTargetGenericBindingsForArguments(typeRow.genericParameters ?? [], named.genericArguments);
    if (substitutions === undefined) return undefined;
    const usedFields = new Set<string>();
    for (const field of layout.fields) {
      const memberIdentity = resolveProviderTypeIdentity([field.selectedDeclaration, ...(field.selectedSymbol === undefined ? [] : [field.selectedSymbol])], context);
      if (memberIdentity?.memberId === undefined || !fieldIds.includes(memberIdentity.memberId) ||
        usedFields.has(memberIdentity.memberId) || memberIdentity.exportId !== typeRow.exportId ||
        !rustProviderOperationOwnerMatches(typeRow, memberIdentity)) return undefined;
      const property = selectRustProviderOperation(options.providerRows, memberIdentity, "property");
      const setter = selectRustProviderOperation(options.providerRows, memberIdentity, "property-set");
      if (property.kind !== "selected" || setter.kind !== "selected" || property.row.target.form !== "field" ||
        setter.row.target.form !== "field" || property.row.target.name !== setter.row.target.name) return undefined;
      const name = property.row.target.name;
      if (fields.some(field => field.projection.kind === "native-field" && field.projection.name === name)) return undefined;
      const instantiate = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => carrier === undefined ? undefined :
        substituteRustTargetGenerics(carrier, substitutions.types, substitutions.lifetimes, substitutions.consts);
      const child = selectRustNativeMemoryLayout(field.fieldLayout, context, options, selected);
      if (child?.kind === "unsupported-array") {
        selected.set(layout, child);
        return child;
      }
      if (child === undefined || !rustTargetTypeRefEquals(instantiate(property.row.receiverCarrier), pointeeCarrier) ||
        !rustTargetTypeRefEquals(instantiate(setter.row.receiverCarrier), pointeeCarrier) ||
        !rustTargetTypeRefEquals(instantiate(property.row.resultCarrier), child.pointeeCarrier) ||
        setter.row.parameterCarriers?.length !== 1 || !rustTargetTypeRefEquals(instantiate(setter.row.parameterCarriers[0]), child.pointeeCarrier)) return undefined;
      usedFields.add(memberIdentity.memberId);
      fields.push(Object.freeze({ projection: Object.freeze({ kind: "native-field", name }), offset: field.byteOffset,
        alignment: field.byteAlignment, layout: child }));
    }
  }
  const result: RustNativeMemoryLayout = Object.freeze({ kind: pointeeCarrier.kind === "source-primitive" ? "scalar" : "record",
    pointeeCarrier, size: layout.byteSize, alignment: layout.byteAlignment,
    width: layout.dataLayout.addressWidth, littleEndian: layout.dataLayout.byteOrder === "little", fields: Object.freeze(fields) });
  selected.set(layout, result);
  return result;
}
