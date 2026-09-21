import { createHash } from "node:crypto";
import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustIndexedFieldKey, rustIndexedFieldProjection, rustIndexedFieldTrait } from "../../../target-model/types/carriers/indexed-fields.js";
import { rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustTargetType } from "./target.js";

export interface RustIndexedFieldSelection {
  readonly key: TargetTypeRef;
  readonly result: TargetTypeRef;
}

export function resolveRustIndexedField(
  ownerType: Type,
  keyType: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  selectedOwner?: TargetTypeRef,
): RustIndexedFieldSelection | undefined {
  const selection = context.currentSemantics.types.selectIndexedAccess(ownerType, keyType);
  if (selection === undefined) return undefined;
  const owner = selectedOwner ?? resolveRustTargetType(ownerType, context, options, resolving);
  if (owner === undefined) return undefined;
  const family = { kind: "indexed" as const, trait: rustIndexedFieldTrait };
  if (!options.sourceTypes.typeFamilies.register(family)) return undefined;
  if (selection.kind === "deferred") {
    const key = resolveRustTargetType(keyType, context, options, resolving);
    return key === undefined ? undefined : { key, result: rustIndexedFieldProjection(owner, key) };
  }
  const member = selection.members.length === 1 ? selection.members[0] : undefined;
  if (member?.kind !== "property" || !context.currentSemantics.types.isStringLike(keyType)) return undefined;
  const registration = options.sourceTypes.structuralFieldProjectionForSymbol(member.property.symbol, owner);
  if (registration === undefined || registration.field.method === true) return undefined;
  const { shape, field } = registration;
  const identity = createHash("sha256").update(member.property.name, "utf8").digest("hex").slice(0, 32);
  const key = rustIndexedFieldKey(identity);
  if (!options.sourceTypes.typeFamilies.registerFieldKey(identity, member.property.name)) return undefined;
  const sourceFileName = rustStructuralObjectCarrierValue(owner)?.ownerFileName ?? rustSourceTypeCarrierValue(owner)?.fileName;
  if (sourceFileName === undefined || !options.sourceTypes.typeFamilies.registerImplementation({
    family, arguments: [{ kind: "type", type: key }], owner,
    output: field.resultCarrier, sourceFileName,
    field: { storage: shape.storage, storageIndex: field.storageIndex, readonly: field.readonly },
  })) return undefined;
  return { key, result: field.resultCarrier };
}
