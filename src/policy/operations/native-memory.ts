import type { AstReader, ExtensionFactSubject, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { countTsonicMemoryLayoutValues, selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact, TsonicRawLocationSelection } from "@tsonic/source-core/facts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeMemoryLayout } from "../../target-model/operations/native-memory.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../types/resolution.js";
import { resolveRustTargetTypeRef } from "../types/resolution.js";
import { resolveProviderTypeIdentity, providerCarrierFromRelations } from "../types/resolution/providers.js";
import { selectRustProviderOperation, rustProviderOperationOwnerMatches } from "./provider-selection.js";
import { isRustCopyCarrier, rustFixedArrayCarrierValue, rustNamedTypeCarrierValue, rustStructuralObjectCarrierValue, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

type RustNativeMemorySelection = RustNativeMemoryLayout | {
  readonly kind: "unsupported-array";
  readonly reason: string;
};

export function readRustRawLocation(ast: AstReader, facts: ReadonlySourceFactResolver, subject: ExtensionFactSubject): TsonicRawLocationSelection | undefined {
  return selectTsonicRawLocationOperation(ast, facts, subject);
}

export function selectRustNativeMemoryLayout(
  layout: TsonicMemoryLayoutFact, context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions,
  selected = new Map<TsonicMemoryLayoutFact, RustNativeMemorySelection | undefined>(),
): RustNativeMemorySelection | undefined {
  if (selected.size === 0 && countTsonicMemoryLayoutValues(layout, 131_072) === undefined) return undefined;
  if (selected.has(layout)) return selected.get(layout);
  selected.set(layout, undefined);
  const pointeeCarrier = resolveRustTargetTypeRef(layout.explicitTypeNode ?? layout.sourceType, context, options);
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
  const sizes: Readonly<Partial<Record<string, number>>> = {
    int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4,
    int64: 8, uint64: 8, int128: 16, uint128: 16, float32: 4, float64: 8,
    "native-int": layout.dataLayout.addressWidth / 8, "native-uint": layout.dataLayout.addressWidth / 8,
  };
  const fields: import("../../target-model/operations/native-memory.js").RustNativeMemoryField[] = [];
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
