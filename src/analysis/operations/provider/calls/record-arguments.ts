import type { Type } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue, rustStructuralObjectCarrierValue, rustUnitTargetType } from "../../../../target-model/types/index.js";
import { resolveSelectedProviderDeclaration } from "../../../../policy/evidence/selected-source.js";
import { rustProviderOperationOwnerMatches, selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { providerCarrierFromRelations } from "../../../../policy/types/resolution/providers.js";
import { rustProviderRecordCopyMatches, type RustProviderRecordCopy } from "../../../../target-model/conversions/provider-record.js";
import { instantiateProviderOperationTemplate } from "./template-instantiation.js";
import { providerOperationTemplate } from "../result.js";

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
    if (row?.objectLiteralConstruction?.kind !== "struct-default" ||
      !rustProviderOperationOwnerMatches(row, identity.identity)) return undefined;
    if (selectedExport !== undefined && selectedExport !== row.exportId) return undefined;
    selectedExport = row.exportId;
    const read = selectRustProviderOperation(options.providerRows, identity.identity, "property");
    const write = selectRustProviderOperation(options.providerRows, identity.identity, "property-set");
    if (read.kind !== "selected" || write.kind !== "selected") return undefined;
    const readTemplate = instantiateProviderOperationTemplate(providerOperationTemplate(read.row, "property"), {
      sourceReceiverCarrier: target,
    })?.template;
    const writeTemplate = instantiateProviderOperationTemplate(providerOperationTemplate(write.row, "property-set"), {
      sourceReceiverCarrier: target,
      sourceParameterCarriers: [readTemplate?.resultCarrier],
    })?.template;
    if (readTemplate?.target.form !== "field" || writeTemplate?.target.form !== "field" ||
      readTemplate.receiverCarrier === undefined || writeTemplate.receiverCarrier === undefined ||
      !rustTargetTypeRefEquals(readTemplate.receiverCarrier, target) ||
      !rustTargetTypeRefEquals(writeTemplate.receiverCarrier, target) ||
      readTemplate.target.name !== writeTemplate.target.name ||
      writeTemplate.parameterCarriers?.length !== 1 ||
      !rustTargetTypeRefEquals(readTemplate.resultCarrier, writeTemplate.parameterCarriers[0]) ||
      !rustTargetTypeRefEquals(writeTemplate.resultCarrier, rustUnitTargetType()) ||
      targetNames.has(readTemplate.target.name)) return undefined;
    targetNames.add(readTemplate.target.name);
    if (pair.kind === "absent") {
      if (!destination.property.optional) return undefined;
      omitted = true;
      continue;
    }
    if (pair.source.read !== "property" || pair.source.property.optional) return undefined;
    const projection = options.sourceTypes.structuralFieldProjectionForSymbol(pair.source.property.symbol, source);
    if (projection === undefined || projection.field.accessor !== undefined ||
      !rustTargetTypeRefEquals(projection.field.resultCarrier, readTemplate.resultCarrier)) return undefined;
    fields.push(Object.freeze({ storageIndex: projection.field.storageIndex,
      carrier: readTemplate.resultCarrier, targetName: readTemplate.target.name }));
  }
  if (selectedExport === undefined) return undefined;
  const ownerRows = options.providerRows.filter(row => row.exportId === selectedExport &&
    (row.operationKind === "property" || row.operationKind === "property-set"));
  if (ownerRows.length !== targetNames.size * 2 || ownerRows.some(row =>
    row.target.form !== "field" || !targetNames.has(row.target.name))) return undefined;
  const conversion: RustProviderRecordCopy = Object.freeze({ kind: "provider-record-copy", source, target,
    completion: omitted ? "default" : "complete", fields: Object.freeze(fields) });
  return rustProviderRecordCopyMatches(conversion, source, target) ? conversion : undefined;
}
