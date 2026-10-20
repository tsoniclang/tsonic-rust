import { requireRustRecord } from "../program/records/required-records.js";
import { KindSpreadAssignment, ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import { rustEmptyObjectTargetId, rustEmptyObjectTargetType, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";

import { resolveExpressionCarrier } from "../expressions/carriers.js";

import { resolveRustIndexedRecordContract, resolveRustIndexedRecordLiteral } from "../objects/indexed-records.js";

import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";

import { selectSourceObjectLiteralAccessors } from "@tsonic/target-api/source";
import { setCarrierFact } from "../operations/project-calls.js";
import { selectRustValueCarrierReconciliation } from "../../policy/types/resolution/value-carrier-reconciliation.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { recordRustValueCarrierReconciliation } from "../program/records/value-carrier-admission.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";

import { resolveProviderRecordLiteral } from "../expressions/provider-records.js";

import { resolveRustClosedRecordLiteral } from "../expressions/closed-records.js";

import { rustRecordPropertySourceName } from "./computed-field-names.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";
import { selectRustRecordLiteralLayout } from "./record-literal-layout.js";
import { collectRustRecordLiteralContributions } from "./record-literal-contributions.js";
export function resolveRecordLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const semantics = walk.context.semanticsFor(expression);
  const sourceType = semantics.types.expressionType(expression);
  if (sourceType === undefined) {
    return undefined;
  }
  const properties = requireDenseSourceNodes(walk, ast.properties(expression), "Object literal contains an undefined or non-data property slot.");
  if (properties === undefined) {
    return undefined;
  }
  const accessorSelection = selectSourceObjectLiteralAccessors(
    ast,
    walk.context.semanticsFor(expression),
    expression,
  );
  if (accessorSelection.kind === "rejected") {
    appendRustDiagnostic(
      walk,
      "RUST_OBJECT_LITERAL_ACCESSOR_EVIDENCE_MISSING",
      accessorSelection.reason,
      accessorSelection.element,
      ["target.capability=rust.object-literal.accessor.selected-evidence"],
    );
    return undefined;
  }
  const accessorsByElement = new Map<Node,
    Extract<typeof accessorSelection, { readonly kind: "resolved" }>[
      "members"
    ][number]
  >();
  if (accessorSelection.kind === "resolved") {
    for (const accessor of accessorSelection.members) {
      if (accessor.getter === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_OBJECT_LITERAL_SETTER_ONLY_UNSUPPORTED",
          `Object-literal setter '${accessor.sourceName}' has no getter and therefore no exact Rust read carrier.`,
          accessor.setter?.element,
          ["target.capability=rust.object-literal.accessor.closed-read-write"],
        );
        return undefined;
      }
      accessorsByElement.set(accessor.getter.element, accessor);
      if (accessor.setter !== undefined) {
        accessorsByElement.set(accessor.setter.element, accessor);
      }
    }
  }
  const providerLiteral = resolveProviderRecordLiteral(
    walk,
    expression,
    sourceFile,
    expected,
    properties,
  );
  if (providerLiteral.kind === "selected") {
    return providerLiteral.carrier;
  }
  if (providerLiteral.kind === "rejected") {
    return undefined;
  }
  const contextualSelection = semantics.types.contextualValueSelection(expression);
  if (contextualSelection.kind !== "selected" && expected === undefined) {
    for (const property of properties) {
      const kind = ast.kindName(property);
      if (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment") continue;
      const value = ObjectLiteralProperty_Value(ast, property);
      if (value === undefined || ast.is.IsArrowFunction(value) || ast.is.IsFunctionExpression(value)) continue;
      resolveExpressionCarrier(walk, value, sourceFile, undefined);
    }
  }
  const selectedSourceType = contextualSelection.kind === "selected"
    ? contextualSelection.type
    : sourceType;
  let selectedExpected = expected ?? (contextualSelection.kind !== "selected" && properties.length === 0
    ? rustEmptyObjectTargetType()
    : resolveRustTargetTypeRef(
        selectedSourceType,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      ));
  if (selectedExpected === undefined) {
    return undefined;
  }
  const closed = resolveRustClosedRecordLiteral(walk, expression, sourceFile, selectedExpected, properties);
  if (closed.kind === "selected") return closed.carrier;
  let contextualReconciliation: import("../../policy/types/resolution/value-carrier-reconciliation.js").RustAppliedValueCarrierReconciliation | undefined;
  if ((expected !== undefined || contextualSelection.kind === "selected") && rustSourceTypeCarrierValue(selectedExpected)?.shape !== "object" &&
    rustSourceUnionCarrierValue(selectedExpected) === undefined &&
    rustStructuralObjectCarrierValue(selectedExpected) === undefined) {
    const sourceCarrier = properties.length === 0
      ? rustEmptyObjectTargetType()
      : resolveRustTargetTypeRef(
          sourceType,
          rustResolutionContext(walk, expression),
          walk.operationOptions,
        );
    const reconciliation = sourceCarrier === undefined
      ? undefined
      : selectRustValueCarrierReconciliation(
          sourceCarrier,
          selectedExpected,
          walk.context.projectTypes, walk.context.typeDefinitions,
        );
    if (reconciliation?.kind === "conversion") {
      selectedExpected = sourceCarrier!;
      contextualReconciliation = reconciliation;
    }
  }
  if (selectedExpected.kind === "target-named" && selectedExpected.id === rustEmptyObjectTargetId) {
    if (properties.length !== 0) return undefined;
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "empty-object-literal", "analysis/expressions/records.ts");
    walk.context.records.targetOperations.source(expression, {
      kind: "empty-object-literal",
      operationId: "tsonic.rust.object.empty-literal",
      resultCarrier: selectedExpected,
    });
    const carrier = setCarrierFact(walk, expression, selectedExpected);
    if (carrier !== undefined && contextualReconciliation !== undefined) {
      recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, contextualReconciliation);
      return rustEffectiveValueCarrier(walk.context.records, expression);
    }
    return carrier;
  }
  const indexed = resolveRustIndexedRecordContract(walk, selectedExpected);
  if (indexed !== undefined) {
    return resolveRustIndexedRecordLiteral(
      walk,
      expression,
      sourceFile,
      selectedExpected,
      properties,
      indexed,
    );
  }
  const explicitPropertiesByName = new Map<string, Node>();
  if (accessorSelection.kind === "resolved") {
    for (const accessor of accessorSelection.members) {
      if (explicitPropertiesByName.has(accessor.sourceName)) {
        return undefined;
      }
      explicitPropertiesByName.set(accessor.sourceName, accessor.getter!.element);
    }
  }
  for (const property of properties) {
    const kind = ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      continue;
    }
    if (kind === "KindMethodDeclaration") {
      continue;
    }
    if (kind === "KindGetAccessor" || kind === "KindSetAccessor") {
      if (!accessorsByElement.has(property)) {
        return undefined;
      }
      continue;
    }
    if (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment") {
      return undefined;
    }
    const nameNode = ast.name(property);
    const fieldName = rustRecordPropertySourceName(walk, nameNode);
    if (fieldName === undefined || explicitPropertiesByName.has(fieldName)) {
      return undefined;
    }
    explicitPropertiesByName.set(fieldName, property);
  }
  const layout = selectRustRecordLiteralLayout(walk, expression, selectedExpected, accessorSelection);
  if (layout === undefined) return undefined;
  const { resultCarrier, storage, selectedFields, selectedMethodDeclarations } = layout;
  const assigned = collectRustRecordLiteralContributions(walk, sourceFile, selectedExpected,
    properties, accessorsByElement, layout);
  if (assigned === undefined) return undefined;
  const { contributions, assignedStorageIndexes, assignedAccessorRoles, assignedMethodDeclarations } = assigned;
  const everyFieldAssigned = selectedFields.every((field) => {
    const roles = assignedAccessorRoles.get(field.storageIndex);
    const accessorComplete = roles?.has("get") === true &&
      (field.readonly || roles.has("set"));
    return field.presence === "optional" ||
      assignedStorageIndexes.has(field.storageIndex) || accessorComplete;
  });
  if (!everyFieldAssigned ||
    selectedMethodDeclarations.some((declaration) => !assignedMethodDeclarations.has(declaration))) {
    return undefined;
  }
  const fields = selectedFields.map((field) => ({
    ...(field.implementationDeclaration === undefined
      ? {}
      : { implementationDeclaration: field.implementationDeclaration }),
    contractDeclarations: Object.freeze([...field.contractDeclarations]),
    sourceName: field.sourceName,
    storageIndex: field.storageIndex,
    carrier: field.carrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
  }));
  if (storage === "structural-object" && selectedFields.some((field) => {
    if (field.method === true) {
      return false;
    }
    const kinds = [
      ...(assignedStorageIndexes.has(field.storageIndex) ? ["stored" as const] : []),
      ...(assignedAccessorRoles.get(field.storageIndex)?.has("get") === true
        ? ["accessor" as const]
        : []),
    ];
    return kinds.some((kind) => !walk.sourceTypes.registerStructuralFieldImplementation({
      carrier: resultCarrier,
      storageIndex: field.storageIndex,
      kind,
    }));
  })) {
    appendRustDiagnostic(
      walk,
      "RUST_STRUCTURAL_PROPERTY_IMPLEMENTATION_CONFLICT",
      "A structural property implementation conflicts with its finalized carrier and storage slot.",
      expression,
      ["target.capability=rust.structural-property.closed-storage"],
    );
    return undefined;
  }
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "record-literal", "analysis/expressions/records.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "record-literal",
    operationId: "tsonic.rust.record.literal",
    storage,
    resultCarrier,
    fields,
    contributions,
  });
  if (storage === "project-object") {
    for (const contribution of contributions) {
      if (contribution.kind !== "accessor") {
        continue;
      }
      const field = fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      if (field === undefined) {
        return undefined;
      }
      walk.context.projectFieldDispatch.recordObjectLiteralAccessor(
        field.contractDeclarations,
        contribution.role,
      );
    }
  }
  if (contributions.some((contribution) => contribution.kind === "method")) {
    walk.objectLiteralMethodExpressions.add(expression);
  }
  if (contributions.some((contribution) =>
    contribution.kind === "spread" && contribution.methods.length > 0)) {
    walk.objectLiteralMethodSpreadExpressions.add(expression);
  }
  const finalizedCarrier = setCarrierFact(walk, expression, resultCarrier);
  if (finalizedCarrier !== undefined && contextualReconciliation !== undefined) {
    recordRustValueCarrierReconciliation(
      walk.context.records, walk.context.requiredRecords,
      expression,
      contextualReconciliation,
    );
    return rustEffectiveValueCarrier(walk.context.records, expression);
  }
  return finalizedCarrier;
}
