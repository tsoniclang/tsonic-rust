import { ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import type { Node, SourceFile } from "@tsonic/tsts";
import {
  rustUnitTargetType,
} from "../../target-model/types/index.js";
import {
  selectRustProviderObjectLiteralConstruction,
} from "../../policy/types/resolution/providers.js";
import {
  resolveSelectedProviderDeclaration,
} from "../../policy/evidence/selected-source.js";
import {
  rustProviderOperationOwnerMatches,
  selectRustProviderOperation,
} from "../../policy/operations/provider-selection.js";
import {
  providerOperationTemplate,
} from "../operations/provider/result.js";
import {
  instantiateProviderOperationTemplate,
} from "../operations/provider/calls/provider-template-instantiation.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { resolveExpressionCarrier } from "./carriers.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export type ProviderRecordLiteralResolution =
  | { readonly kind: "not-applicable" }
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "rejected" };

export function resolveProviderRecordLiteral(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  properties: readonly Node[],
): ProviderRecordLiteralResolution {
  const resolutionContext = rustResolutionContext(walk, expression);
  const construction = selectRustProviderObjectLiteralConstruction(
    expression,
    expected,
    resolutionContext,
    walk.operationOptions,
  );
  if (construction.kind === "not-applicable") {
    return { kind: "not-applicable" };
  }
  if (construction.kind === "conflict") {
    return rejectProviderRecordLiteral(
      walk,
      expression,
      "Provider object-literal construction conflicts with its exact instantiated target carrier.",
    );
  }
  const { carrier: resultCarrier, typeRow } = construction;
  const targetFields = providerRecordTargetFields(walk, typeRow);
  if (targetFields === undefined) {
    return rejectProviderRecordLiteral(
      walk,
      expression,
      "Provider object-literal construction requires one complete exact readable/writable native field inventory.",
    );
  }
  const fields: Extract<
    RustTargetOperationFact,
    { readonly kind: "provider-record-literal" }
  >["fields"][number][] = [];
  for (const property of properties) {
    const propertySemantics = walk.context.semanticsFor(property);
    const selected = propertySemantics.operations.objectLiteralElement(property);
    if (
      selected === undefined ||
      selected.objectLiteral !== expression ||
      selected.element !== property ||
      (selected.elementKind !== "property" && selected.elementKind !== "shorthand")
    ) {
      return rejectProviderRecordLiteral(
        walk,
        property,
        "Provider object literals require exact selected evidence for each ordinary property or shorthand property.",
      );
    }
    const value = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (value === undefined) {
      return rejectProviderRecordLiteral(
        walk,
        property,
        "Provider object-literal property evidence does not identify one authored value expression.",
      );
    }
    const selectedSubject = selected.sourceSelectedDeclaration ??
      selected.sourceSelectedSymbol;
    const declarationIdentity = resolveSelectedProviderDeclaration(
      walk.context,
      selectedSubject,
      [
        {
          subject: selected.sourceSelectedSymbol,
          precision: "declaration",
        },
        ...selected.sourceSelectedDeclarations.map((declaration) => ({
          subject: declaration,
          precision: "declaration" as const,
        })),
      ],
    );
    if (
      declarationIdentity.kind !== "selected" ||
      declarationIdentity.identity.memberId === undefined ||
      declarationIdentity.identity.exportId !== typeRow.exportId ||
      !rustProviderOperationOwnerMatches(typeRow, declarationIdentity.identity)
    ) {
      return rejectProviderRecordLiteral(
        walk,
        property,
        "Provider object-literal property evidence does not resolve to one exact member owned by the selected provider type.",
      );
    }
    const readSelection = selectRustProviderOperation(
      walk.providerRows,
      declarationIdentity.identity,
      "property",
    );
    const writeSelection = selectRustProviderOperation(
      walk.providerRows,
      declarationIdentity.identity,
      "property-set",
    );
    if (
      readSelection.kind !== "selected" ||
      writeSelection.kind !== "selected"
    ) {
      return rejectProviderRecordLiteral(
        walk,
        property,
        "Provider object-literal members require one exact readable and writable provider relation.",
      );
    }
    const selectedMemberCarrier = resolveRustTargetTypeRef(
      selected.sourceSelectedType,
      resolutionContext,
      walk.operationOptions,
    );
    const read = instantiateProviderOperationTemplate(
      providerOperationTemplate(readSelection.row, "property"),
      {
        sourceReceiverCarrier: resultCarrier,
        sourceResultCarrier: selectedMemberCarrier,
      },
    )?.template;
    const write = instantiateProviderOperationTemplate(
      providerOperationTemplate(writeSelection.row, "property-set"),
      {
        sourceReceiverCarrier: resultCarrier,
        sourceParameterCarriers: [selectedMemberCarrier],
      },
    )?.template;
    const storageCarrier = read?.resultCarrier;
    const targetName = read?.target.form === "field"
      ? read.target.name
      : undefined;
    if (
      selectedMemberCarrier === undefined ||
      read === undefined ||
      write === undefined ||
      read.receiverCarrier === undefined ||
      write.receiverCarrier === undefined ||
      !rustTargetTypeRefEquals(read.receiverCarrier, resultCarrier) ||
      !rustTargetTypeRefEquals(write.receiverCarrier, resultCarrier) ||
      targetName === undefined ||
      write.target.form !== "field" ||
      write.target.name !== targetName ||
      write.parameterCarriers?.length !== 1 ||
      storageCarrier === undefined ||
      !rustTargetTypeRefEquals(write.parameterCarriers[0], storageCarrier) ||
      !rustTargetTypeRefEquals(write.resultCarrier, rustUnitTargetType())
    ) {
      return rejectProviderRecordLiteral(
        walk,
        property,
        "Provider object-literal member relations do not form one exact native field storage contract.",
      );
    }
    if (resolveExpressionCarrier(
      walk,
      value,
      sourceFile,
      storageCarrier,
    ) === undefined) {
      return { kind: "rejected" };
    }
    fields.push({
      property,
      expression: value,
      providerMemberId: declarationIdentity.identity.memberId,
      targetName,
      storageCarrier,
    });
  }
  if (new Set(fields.map((field) => field.targetName)).size !== fields.length) {
    return rejectProviderRecordLiteral(
      walk,
      expression,
      "Provider object-literal relations map multiple source properties to the same native field.",
    );
  }
  const authoredFields = new Set(fields.map((field) => field.targetName));
  if (fields.some((field) => !targetFields.includes(field.targetName))) {
    return rejectProviderRecordLiteral(
      walk,
      expression,
      "Provider object-literal fields conflict with the type's exact native construction inventory.",
    );
  }
  setRustOperationFact(walk, expression, {
    kind: "provider-record-literal",
    operationId: `tsonic.rust.provider-record.${typeRow.providerPackageId}.${typeRow.providerModuleId}.${typeRow.exportId}`,
    resultCarrier,
    completion: authoredFields.size === targetFields.length ? "complete" : "default",
    fields: Object.freeze(fields),
  });
  setCarrierFact(walk, expression, resultCarrier);
  return { kind: "selected", carrier: resultCarrier };
}

function providerRecordTargetFields(
  walk: RustFactWalk,
  typeRow: import("../../providers/packages/model.js").RustProviderTypeRow,
): readonly string[] | undefined {
  const rows = walk.providerRows.filter((row) =>
    row.providerId === typeRow.providerId &&
    row.providerVersion === typeRow.providerVersion &&
    row.providerModuleId === typeRow.providerModuleId &&
    row.exportId === typeRow.exportId &&
    (row.operationKind === "property" || row.operationKind === "property-set"));
  const reads = rows.filter((row) => row.operationKind === "property");
  const writes = rows.filter((row) => row.operationKind === "property-set");
  if (reads.length === 0 || reads.length !== writes.length) {
    return undefined;
  }
  const fields: string[] = [];
  for (const read of reads) {
    const matchingWrites = writes.filter((write) => write.memberId === read.memberId);
    const write = matchingWrites.length === 1 ? matchingWrites[0] : undefined;
    if (read.memberId === undefined || read.target.form !== "field" ||
      read.receiverCarrier === undefined || write === undefined ||
      write.target.form !== "field" || write.target.name !== read.target.name ||
      write.receiverCarrier === undefined ||
      !rustTargetTypeRefEquals(read.receiverCarrier, write.receiverCarrier) ||
      write.parameterCarriers?.length !== 1 ||
      !rustTargetTypeRefEquals(read.resultCarrier, write.parameterCarriers[0]!) ||
      !rustTargetTypeRefEquals(write.resultCarrier, rustUnitTargetType())) {
      return undefined;
    }
    fields.push(read.target.name);
  }
  return new Set(fields).size === fields.length &&
      writes.every((write) => reads.some((read) => read.memberId === write.memberId))
    ? Object.freeze(fields)
    : undefined;
}

function rejectProviderRecordLiteral(
  walk: RustFactWalk,
  node: Node,
  message: string,
): Extract<ProviderRecordLiteralResolution, { readonly kind: "rejected" }> {
  appendRustDiagnostic(
    walk,
    "RUST_PROVIDER_OBJECT_LITERAL_CONTRACT_INVALID",
    message,
    node,
    [
      "target.capability=rust.provider-object-literal.exact-relations",
      "target.construction=struct-default",
    ],
  );
  return { kind: "rejected" };
}
