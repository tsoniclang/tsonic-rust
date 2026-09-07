import type { AstReader, ExtensionFactSubject, ReadonlySourceFactResolver } from "@tsonic/tsts";
import { countTsonicMemoryLayoutValues, selectTsonicRawLocationOperation } from "@tsonic/source-core/facts";
import type { TsonicMemoryLayoutFact, TsonicRawLocationSelection } from "@tsonic/source-core/facts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustNativeMemoryLayout } from "../../target-model/operations/native-memory.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../types/resolution.js";
import { resolveRustTargetTypeRef } from "../types/resolution.js";
import { resolveProviderTypeIdentity, providerCarrierFromRelations } from "../types/resolution/providers.js";
import { selectRustProviderOperation, rustProviderOperationOwnerMatches } from "./provider-selection.js";
import { isRustCopyCarrier, rustNamedTypeCarrierValue, rustTargetGenericBindingsForArguments, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function readRustRawLocation(ast: AstReader, facts: ReadonlySourceFactResolver, subject: ExtensionFactSubject): TsonicRawLocationSelection | undefined {
  return selectTsonicRawLocationOperation(ast, facts, subject);
}

export function selectRustNativeMemoryLayout(
  layout: TsonicMemoryLayoutFact, context: RustTargetTypeResolutionContext, options: RustTargetTypeResolutionOptions,
  selected = new Map<TsonicMemoryLayoutFact, RustNativeMemoryLayout | undefined>(),
): RustNativeMemoryLayout | undefined {
  if (selected.size === 0 && countTsonicMemoryLayoutValues(layout, 131_072) === undefined) return undefined;
  if (selected.has(layout)) return selected.get(layout);
  selected.set(layout, undefined);
  const pointeeCarrier = resolveRustTargetTypeRef(layout.explicitTypeNode ?? layout.sourceType, context, options);
  if (pointeeCarrier === undefined) return undefined;
  const sizes: Readonly<Partial<Record<string, number>>> = {
    int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4,
    int64: 8, uint64: 8, int128: 16, uint128: 16, float32: 4, float64: 8,
    "native-int": layout.dataLayout.addressWidth / 8, "native-uint": layout.dataLayout.addressWidth / 8,
  };
  const fields: import("../../target-model/operations/native-memory.js").RustNativeMemoryField[] = [];
  if (pointeeCarrier.kind === "source-primitive") {
    if (layout.fields.length !== 0 || sizes[pointeeCarrier.name] !== layout.byteSize) return undefined;
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
      if (fields.some(field => field.name === name)) return undefined;
      const instantiate = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => carrier === undefined ? undefined :
        substituteRustTargetGenerics(carrier, substitutions.types, substitutions.lifetimes, substitutions.consts);
      const child = selectRustNativeMemoryLayout(field.fieldLayout, context, options, selected);
      if (child === undefined || !rustTargetTypeRefEquals(instantiate(property.row.receiverCarrier), pointeeCarrier) ||
        !rustTargetTypeRefEquals(instantiate(setter.row.receiverCarrier), pointeeCarrier) ||
        !rustTargetTypeRefEquals(instantiate(property.row.resultCarrier), child.pointeeCarrier) ||
        setter.row.parameterCarriers?.length !== 1 || !rustTargetTypeRefEquals(instantiate(setter.row.parameterCarriers[0]), child.pointeeCarrier)) return undefined;
      usedFields.add(memberIdentity.memberId);
      fields.push(Object.freeze({ name: property.row.target.name, offset: field.byteOffset,
        alignment: field.byteAlignment, layout: child }));
    }
  }
  const result: RustNativeMemoryLayout = Object.freeze({ kind: pointeeCarrier.kind === "source-primitive" ? "scalar" : "record",
    pointeeCarrier, size: layout.byteSize, alignment: layout.byteAlignment,
    width: layout.dataLayout.addressWidth, littleEndian: layout.dataLayout.byteOrder === "little", fields: Object.freeze(fields) });
  selected.set(layout, result);
  return result;
}
