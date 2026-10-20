import type { RustProviderFactOperationKind, RustProviderOperationTemplate, RustRuntimeSetOperationKind } from "../../../target-model/operations/model.js";

import type { RustProviderOperationRow } from "../../../target-model/identities/provider-relations.js";

export function providerOperationFact(
  row: RustProviderOperationRow<RustProviderFactOperationKind>,
): RustProviderOperationTemplate {
  return providerOperationTemplate(row, row.operationKind);
}

export function providerOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  row: RustProviderOperationRow<OperationKind>,
  operationKind: OperationKind,
): RustProviderOperationTemplate<OperationKind> {
  return {
    kind: "provider-operation",
    operationId: providerOperationId(row),
    operationKind,
    target: row.target,
    ...(row.dispatchInputs === undefined ? {} : { dispatchInputs: row.dispatchInputs }),
    resultCarrier: row.resultCarrier,
    ...(row.parameterCarriers === undefined ? {} : { parameterCarriers: row.parameterCarriers }),
    ...(row.receiverCarrier === undefined ? {} : { receiverCarrier: row.receiverCarrier }),
    ...(row.genericParameters === undefined ? {} : { genericParameters: row.genericParameters }),
    ...(row.typeRequirements === undefined ? {} : { typeRequirements: row.typeRequirements }),
    ...(row.targetGenericArguments === undefined ? {} : { targetGenericArguments: row.targetGenericArguments }),
    ...(row.resultConversion === undefined ? {} : { resultConversion: row.resultConversion }),
    isAsync: row.isAsync === true,
    isFallible: row.isFallible === true,
    ...(row.evaluation === undefined ? {} : { evaluation: row.evaluation }),
    errorBoundary: row.isFallible === true ? row.errorBoundary : "none",
    ...(row.errorCarrier === undefined ? {} : { errorCarrier: row.errorCarrier }),
    ...(row.nativeErrorCarriers === undefined ? {} : { nativeErrorCarriers: row.nativeErrorCarriers }),
    isUnsafe: row.isUnsafe === true,
  };
}

function providerOperationId(row: RustProviderOperationRow): string {
  const identity = row.signatureId ?? row.memberId ?? row.exportId;
  const segment = (value: string): string => `${value.length}:${value}`;
  return `tsonic.rust.provider.${[
    row.providerPackageId,
    row.providerId,
    row.providerVersion,
    row.providerModuleId,
    row.moduleSpecifier,
    identity,
  ].map(segment).join("")}`;
}
