import { requireRustRecord } from "../program/records/objects/required-records.js";
import { ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import type { Node, SourceFile } from "@tsonic/tsts";
import { rustOptionElementCarrier } from "../../target-model/types/index.js";
import { selectRustProviderObjectLiteralConstruction } from "../source-evidence/types/resolution/providers.js";
import {
  resolveSelectedProviderDeclaration,
} from "../../policy/identities/selected-source.js";
import {
  rustProviderOperationOwnerMatches,
} from "../../policy/operations/provider-selection.js";
import { selectRustProviderRecordField, selectRustProviderRecordFields } from "../../policy/operations/members/record-fields.js";
import type { RustProviderRecordAbsentField } from "../../target-model/conversions/provider-record-absence.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
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
  if (typeRow.objectLiteralConstruction?.kind === "default") {
    if (properties.length !== 0) {
      return rejectProviderRecordLiteral(walk, expression,
        "Opaque provider default construction accepts only an empty object literal.");
    }
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "provider-record-literal", "analysis/objects/provider-records.ts");
    walk.context.records.targetOperations.source(expression, {
      kind: "provider-record-literal", operationId: "tsonic.rust.provider.default",
      resultCarrier, completion: "default", absentFields: [], fields: [],
    });
    setCarrierFact(walk, expression, resultCarrier);
    return { kind: "selected", carrier: resultCarrier };
  }
  const targetFields = selectRustProviderRecordFields(typeRow, resultCarrier, walk.operationOptions, walk.context.typeDefinitions);
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
    const selectedMemberCarrier = resolveRustTargetTypeRef(
      selected.sourceSelectedType,
      resolutionContext,
      walk.operationOptions,
    );
    const field = selectedMemberCarrier === undefined ? undefined : selectRustProviderRecordField(
      declarationIdentity.identity, resultCarrier, walk.operationOptions, walk.context.typeDefinitions, selectedMemberCarrier);
    if (field === undefined) {
      return rejectProviderRecordLiteral(
        walk,
        property,
        "Provider object-literal member relations do not form one exact native field storage contract.",
      );
    }
    const { carrier: storageCarrier, targetName } = field;
    const valueCarrier = resolveExpressionCarrier(
      walk,
      value,
      sourceFile,
      storageCarrier,
      "value",
      "exact",
    );
    if (valueCarrier === undefined) {
      return { kind: "rejected" };
    }
    if (!rustTargetTypeRefEquals(valueCarrier, storageCarrier)) {
      return rejectProviderRecordLiteral(walk, value,
        "Provider object-literal value has no exact conversion to its native field storage.");
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
  if (fields.some((field) => !targetFields.some(target => target.targetName === field.targetName))) {
    return rejectProviderRecordLiteral(
      walk,
      expression,
      "Provider object-literal fields conflict with the type's exact native construction inventory.",
    );
  }
  const absentFields: RustProviderRecordAbsentField[] = [];
  if (typeRow.objectLiteralConstruction?.kind === "struct") {
    const semantics = walk.context.semanticsFor(expression);
    const contextual = semantics.types.contextualValueSelection(expression);
    const authoredType = semantics.types.expressionType(expression);
    const correspondence = contextual.kind !== "selected" || authoredType === undefined ? undefined
      : semantics.types.structuralMembers(authoredType, contextual.component.selectedType, "correspondence");
    if (correspondence?.kind !== "available") return rejectProviderRecordLiteral(walk, expression,
      "Native provider struct construction requires its exact checked member correspondence.");
    const omittedMembers = new Set<string>();
    for (const pair of correspondence.members) {
      if (pair.kind !== "absent" || !pair.destination.property.optional) continue;
      const identity = resolveSelectedProviderDeclaration(walk.context, pair.destination.property.symbol,
        pair.destination.declarations.map(subject => ({ subject, precision: "declaration" as const })));
      if (identity.kind !== "selected" || identity.identity.memberId === undefined ||
        identity.identity.exportId !== typeRow.exportId || !rustProviderOperationOwnerMatches(typeRow, identity.identity))
        return rejectProviderRecordLiteral(walk, expression, "An absent native field requires its exact optional provider identity.");
      omittedMembers.add(identity.identity.memberId);
    }
    for (const field of targetFields) {
      if (authoredFields.has(field.targetName)) continue;
      if (!omittedMembers.has(field.memberId) || rustOptionElementCarrier(field.carrier) === undefined)
        return rejectProviderRecordLiteral(walk, expression, "An omitted native struct field requires checked optional Option storage.");
      absentFields.push(Object.freeze({ targetName: field.targetName, carrier: field.carrier }));
    }
  }
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "provider-record-literal", "analysis/objects/provider-records.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "provider-record-literal",
    operationId: `tsonic.rust.provider-record.${typeRow.providerPackageId}.${typeRow.providerModuleId}.${typeRow.exportId}`,
    resultCarrier,
    completion: typeRow.objectLiteralConstruction?.kind === "struct" || authoredFields.size === targetFields.length ? "complete" : "default",
    absentFields: Object.freeze(absentFields),
    fields: Object.freeze(fields),
  });
  setCarrierFact(walk, expression, resultCarrier);
  return { kind: "selected", carrier: resultCarrier };
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
      "target.construction=native-provider-record",
    ],
  );
  return { kind: "rejected" };
}
