import type { Type } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue, rustStructuralObjectCarrierValue, rustOptionElementCarrier } from "../../../../target-model/types/index.js";
import { resolveSelectedProviderDeclaration } from "../../../../policy/evidence/selected-source.js";
import { rustProviderOperationOwnerMatches } from "../../../../policy/operations/provider-selection.js";
import { providerCarrierFromRelations } from "../../../../policy/types/resolution/providers.js";
import { rustProviderRecordCopyMatches, type RustProviderRecordCopy } from "../../../../target-model/conversions/provider-record.js";
import { selectRustProviderRecordField } from "./record-fields.js";
import type { RustProviderRecordAbsentField } from "../../../../target-model/conversions/provider-record-absence.js";
import { selectRustStructuralFieldProjection } from "../../../../policy/types/structural-fields.js";
import { selectRustExactIntegerConversion } from "../../../../target-model/conversions/exact-integer.js";
import { selectRustSourceValueConversion } from "../../../../policy/conversions/selection.js";

export function selectProviderRecordArgument(
  sourceType: Type | undefined,
  destinationType: Type | undefined,
  source: TargetTypeRef,
  target: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustProviderRecordCopy | undefined {
  if (sourceType === undefined || destinationType === undefined ||
    rustStructuralObjectCarrierValue(source) === undefined ||
    rustNamedTypeCarrierValue(target) === undefined) return undefined;
  const correspondence = context.currentSemantics.types.structuralMembers(sourceType, destinationType);
  if (correspondence.kind !== "available" ||
    correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== 0 ||
    correspondence.destination.indexes.length !== 0) return undefined;
  const fields: RustProviderRecordCopy["fields"][number][] = [];
  const absentFields: RustProviderRecordAbsentField[] = [];
  const targetNames = new Set<string>();
  let omitted = false;
  let selectedExport: string | undefined;
  for (const pair of correspondence.members) {
    const destination = pair.destination;
    if (destination.read !== "property") return undefined;
    const identity = resolveSelectedProviderDeclaration(context, destination.property.symbol,
      destination.declarations.map(subject => ({ subject, precision: "declaration" as const })));
    if (identity.kind !== "selected" || identity.identity.memberId === undefined) return undefined;
    const row = providerCarrierFromRelations(identity.identity, options);
    if (row?.objectLiteralConstruction?.kind !== "struct-default" && row?.objectLiteralConstruction?.kind !== "struct" ||
      !rustProviderOperationOwnerMatches(row, identity.identity)) return undefined;
    if (selectedExport !== undefined && selectedExport !== row.exportId) return undefined;
    selectedExport = row.exportId;
    const field = selectRustProviderRecordField(identity.identity, target, options, context.typeDefinitions);
    if (field === undefined || targetNames.has(field.targetName)) return undefined;
    targetNames.add(field.targetName);
    if (pair.kind === "absent") {
      if (!destination.property.optional) return undefined;
      if (row.objectLiteralConstruction.kind === "struct-default") omitted = true;
      else {
        if (rustOptionElementCarrier(field.carrier) === undefined) return undefined;
        absentFields.push(Object.freeze({ targetName: field.targetName, carrier: field.carrier }));
      }
      continue;
    }
    if (pair.source.read !== "property" || pair.source.property.optional) return undefined;
    const projection = selectRustStructuralFieldProjection(options.sourceTypes,
      pair.source.property.symbol, pair.source.declarations, source);
    if (projection === undefined || projection.field.accessor !== undefined) return undefined;
    const sourceCarrier = projection.field.resultCarrier;
    const carrier = field.carrier;
    const identical = rustTargetTypeRefEquals(sourceCarrier, carrier);
    const conversion = identical ? undefined
      : selectRustExactIntegerConversion(sourceCarrier, carrier) ??
        selectRustSourceValueConversion(sourceCarrier, carrier, context.typeDefinitions);
    if (!identical && conversion === undefined) return undefined;
    fields.push(Object.freeze({ storageIndex: projection.field.storageIndex,
      sourceCarrier, carrier, targetName: field.targetName,
      ...(conversion === undefined ? {} : { conversion }) }));
  }
  if (selectedExport === undefined) return undefined;
  const ownerRows = options.providerRows.filter(row => row.exportId === selectedExport &&
    (row.operationKind === "property" || row.operationKind === "property-set"));
  if (ownerRows.length !== targetNames.size * 2 || ownerRows.some(row =>
    row.target.form !== "field" || !targetNames.has(row.target.name))) return undefined;
  const conversion: RustProviderRecordCopy = Object.freeze({ kind: "provider-record-copy", source, target,
    completion: omitted ? "default" : "complete", absentFields: Object.freeze(absentFields), fields: Object.freeze(fields) });
  return rustProviderRecordCopyMatches(conversion, source, target, context.typeDefinitions) ? conversion : undefined;
}
