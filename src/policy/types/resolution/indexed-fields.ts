import { createHash } from "node:crypto";
import type { Symbol, Type, TypePropertyInfo } from "@tsonic/tsts";
import { sourcePropertyTypeEvidenceNodes } from "@tsonic/target-api/source";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
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
  return registerRustIndexedProperty(owner, member.property, ownerType, options);
}

export function resolveRustIndexedProperty(
  ownerType: Type,
  selected: string | Symbol,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  owner: TargetTypeRef,
): { readonly key: TargetTypeRef; readonly projection: Extract<TargetTypeRef, { readonly kind: "associated-type" }>; readonly result: TargetTypeRef } | undefined {
  const properties = context.currentSemantics.types.propertyInfos(ownerType).filter(property =>
    typeof selected === "string" ? property.name === selected :
      property.symbol === selected || property.rootSymbols.includes(selected));
  if (properties.length !== 1) return undefined;
  const property = properties[0]!;
  if (owner.kind !== "type-parameter") {
    const selected = registerRustIndexedProperty(owner, property, ownerType, options);
    return selected === undefined ? undefined : {
      ...selected, projection: rustIndexedFieldProjection(owner, selected.key),
    };
  }
  const evidence = sourcePropertyTypeEvidenceNodes(context.ast, context.currentSemantics, property);
  const carriers = evidence.length === 0 ? [resolveRustTargetType(property.type, context, options, new Set())]
    : evidence.map(authoredTypeNode => resolveRustTypeComponentEvidence({ authoredTypeNode,
      selectedType: property.type }, context, options, new Set()));
  const result = carriers[0];
  if (result === undefined || carriers.some(carrier => !rustTargetTypeRefEquals(carrier, result))) return undefined;
  const key = registerRustIndexedPropertyKey(property.name, options);
  return key === undefined ? undefined : { key, projection: rustIndexedFieldProjection(owner, key), result };
}

function registerRustIndexedPropertyKey(name: string, options: RustTargetTypeResolutionOptions): TargetTypeRef | undefined {
  const identity = createHash("sha256").update(name, "utf8").digest("hex").slice(0, 32);
  return options.sourceTypes.typeFamilies.register({ kind: "indexed", trait: rustIndexedFieldTrait }) &&
    options.sourceTypes.typeFamilies.registerFieldKey(identity, name) ? rustIndexedFieldKey(identity) : undefined;
}

function registerRustIndexedProperty(
  owner: TargetTypeRef, property: TypePropertyInfo, ownerType: Type,
  options: RustTargetTypeResolutionOptions,
): RustIndexedFieldSelection | undefined {
  const registration = options.sourceTypes.structuralFieldProjectionForSymbol(property.symbol, owner);
  if (registration?.field.method === true) return undefined;
  const selected = registration === undefined ? options.projectFieldProjection(property, owner, ownerType) : {
    output: registration.field.resultCarrier,
    field: { storage: registration.shape.storage, storageIndex: registration.field.storageIndex,
      readonly: registration.field.readonly,
      sharedWrite: !registration.field.readonly && (registration.shape.storage === "structural-object"
        ? rustStructuralObjectCarrierValue(owner)?.representation === "reference"
        : options.projectCarrierSupportsObjectIdentity(owner)),
    },
  };
  if (selected === undefined) return undefined;
  const family = { kind: "indexed" as const, trait: rustIndexedFieldTrait };
  const key = registerRustIndexedPropertyKey(property.name, options);
  if (key === undefined) return undefined;
  const sourceFileName = rustStructuralObjectCarrierValue(owner)?.ownerFileName ?? rustSourceTypeCarrierValue(owner)?.fileName;
  if (sourceFileName === undefined || !options.sourceTypes.typeFamilies.registerImplementation({
    family, arguments: [{ kind: "type", type: key }], owner,
    output: selected.output, sourceFileName, field: selected.field,
  })) return undefined;
  return { key, result: selected.output };
}
