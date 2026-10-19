import type { ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustOperationsProviderOptions } from "../model.js";
import type { RustProviderTypeRow } from "../../../../target-model/identities/provider-relations.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustUnitTargetType } from "../../../../target-model/types/index.js";
import { instantiateProviderOperationTemplate } from "./template-instantiation.js";
import { providerOperationTemplate } from "../result.js";

export interface RustProviderRecordField {
  readonly memberId: string;
  readonly targetName: string;
  readonly carrier: TargetTypeRef;
}

export function selectRustProviderRecordField(
  identity: ProviderDeclarationIdentity,
  target: TargetTypeRef,
  options: RustOperationsProviderOptions,
  definitions: RustTypeDefinitions,
  sourceMemberCarrier?: TargetTypeRef,
): RustProviderRecordField | undefined {
  if (identity.memberId === undefined) return undefined;
  const read = selectRustProviderOperation(options.providerRows, identity, "property");
  const write = selectRustProviderOperation(options.providerRows, identity, "property-set");
  if (read.kind !== "selected" || write.kind !== "selected") return undefined;
  const readTemplate = instantiateProviderOperationTemplate(providerOperationTemplate(read.row, "property"), {
    sourceReceiverCarrier: target, sourceResultCarrier: sourceMemberCarrier,
  }, definitions)?.template;
  const writeTemplate = instantiateProviderOperationTemplate(providerOperationTemplate(write.row, "property-set"), {
    sourceReceiverCarrier: target, sourceParameterCarriers: [readTemplate?.resultCarrier],
  }, definitions)?.template;
  if (readTemplate?.target.form !== "field" || writeTemplate?.target.form !== "field" ||
    readTemplate.receiverCarrier === undefined || writeTemplate.receiverCarrier === undefined ||
    !rustTargetTypeRefEquals(readTemplate.receiverCarrier, target) ||
    !rustTargetTypeRefEquals(writeTemplate.receiverCarrier, target) ||
    readTemplate.target.name !== writeTemplate.target.name ||
    writeTemplate.parameterCarriers?.length !== 1 ||
    !rustTargetTypeRefEquals(readTemplate.resultCarrier, writeTemplate.parameterCarriers[0]) ||
    !rustTargetTypeRefEquals(writeTemplate.resultCarrier, rustUnitTargetType())) return undefined;
  return Object.freeze({ memberId: identity.memberId, targetName: readTemplate.target.name, carrier: readTemplate.resultCarrier });
}

export function selectRustProviderRecordFields(
  row: RustProviderTypeRow,
  target: TargetTypeRef,
  options: RustOperationsProviderOptions,
  definitions: RustTypeDefinitions,
): readonly RustProviderRecordField[] | undefined {
  const rows = options.providerRows.filter(candidate => candidate.providerId === row.providerId &&
    candidate.providerVersion === row.providerVersion && candidate.providerModuleId === row.providerModuleId &&
    candidate.exportId === row.exportId && (candidate.operationKind === "property" || candidate.operationKind === "property-set"));
  const reads = rows.filter(candidate => candidate.operationKind === "property");
  if (reads.length === 0 || rows.length !== reads.length * 2) return undefined;
  const fields = reads.map(identity => selectRustProviderRecordField(identity, target, options, definitions));
  if (fields.some(field => field === undefined) || new Set(fields.map(field => field?.targetName)).size !== fields.length)
    return undefined;
  return Object.freeze(fields as RustProviderRecordField[]);
}
