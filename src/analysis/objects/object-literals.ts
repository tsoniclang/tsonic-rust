import { requireRustRecord } from "../program/records/required-records.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { KindSpreadAssignment, ObjectLiteralProperty_Value, SpreadAssignment_Expression, sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustEmptyObjectTargetId, rustEmptyObjectTargetType, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { resolveRustIndexedRecordContract, resolveRustIndexedRecordLiteral } from "../objects/indexed-records.js";

import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveRustTypeComponentEvidence } from "../source-evidence/types/resolution/source-evidence.js";

import { selectSourceObjectLiteralAccessors } from "@tsonic/target-api/source";
import { setCarrierFact } from "../operations/project-calls.js";
import { rustCallableTargetForSourceLifetime, selectRustValueCarrierReconciliation } from "../../policy/conversions/value-carrier-reconciliation.js";
import { retainRustStructuralInstantiation } from "../source-evidence/types/resolution/structural-instantiations.js";
import { rustStructuralObjectTargetType } from "../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { recordRustValueCarrierReconciliation } from "../program/records/value-carrier-admission.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";

import { resolveProviderRecordLiteral } from "./provider-records.js";

import { resolveRustClosedRecordLiteral } from "./closed-records.js";

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
    ? contextualSelection.component.selectedType
    : sourceType;
  let selectedExpected = expected ?? (contextualSelection.kind !== "selected" && properties.length === 0
    ? rustEmptyObjectTargetType()
    : contextualSelection.kind === "selected" ? resolveRustTypeComponentEvidence(
      contextualSelection.component, rustResolutionContext(walk, expression), walk.operationOptions, new Set<object>())
    : resolveRustTargetTypeRef(selectedSourceType, rustResolutionContext(walk, expression), walk.operationOptions));
  if (selectedExpected === undefined) {
    return undefined;
  }
  const closed = resolveRustClosedRecordLiteral(walk, expression, sourceFile, selectedExpected, properties);
  if (closed.kind === "selected") return closed.carrier;
  let contextualReconciliation: import("../../policy/conversions/value-carrier-reconciliation.js").RustAppliedValueCarrierReconciliation | undefined;
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
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "empty-object-literal", "analysis/objects/object-literals.ts");
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
  // Method slots copied by spreads whose destination lifetime is still a placeholder keep the copied slots' callable
  // lifetimes; the literal's structural carrier is that registered instantiation of its source type.
  if (rustStructuralObjectCarrierValue(selectedExpected) !== undefined) {
    const adapted = rustSpreadSlotLifetimes(walk, sourceFile, selectedExpected, properties, explicitPropertiesByName);
    if (adapted !== selectedExpected) {
      if (!retainRustStructuralInstantiation(selectedSourceType, selectedExpected, adapted,
        rustResolutionContext(walk, expression), walk.operationOptions)) {
        appendRustDiagnostic(walk, "RUST_STRUCTURAL_PROPERTY_IMPLEMENTATION_CONFLICT",
          "A spread record literal has no exact structural instantiation for its copied method slot lifetimes.", expression,
          ["target.capability=rust.structural-property.closed-storage"]);
        return undefined;
      }
      selectedExpected = adapted;
    }
  }
  const structural = rustStructuralObjectCarrierValue(selectedExpected);
  if (structural !== undefined) {
    const methods = properties.flatMap(property => {
      if (!ast.is.IsMethodDeclaration(property) || ast.body(property) === undefined) return [];
      const sourceName = rustRecordPropertySourceName(walk, ast.name(property));
      const identity = sourceNodeIdentity(ast, property);
      if (identity === undefined) failTargetAnalysisInvariant("tsonic-rust", "A literal method requires its original checked source identity.", property);
      return sourceName === undefined || !structural.fields.some(field => field.sourceName === sourceName && field.method)
        ? [] : [{ sourceName, identity, genericArguments: Object.freeze([]) }];
    }).sort((left, right) => structural.fields.findIndex(field => field.sourceName === left.sourceName) -
      structural.fields.findIndex(field => field.sourceName === right.sourceName));
    if (methods.length !== 0) {
      const bodyCarrier = rustStructuralObjectTargetType(ast.getFileName(sourceFile), structural.fields,
        structural.representation, structural.construction, structural.bases, { kind: "source", methods });
      if (!retainRustStructuralInstantiation(sourceType, selectedExpected, bodyCarrier,
        rustResolutionContext(walk, expression), walk.operationOptions)) {
        appendRustDiagnostic(walk, "RUST_STRUCTURAL_PROPERTY_IMPLEMENTATION_CONFLICT",
          "An object method requires its exact checked literal body and contextual member correspondence.", expression,
          ["target.capability=rust.structural-property.closed-storage"]);
        return undefined;
      }
      selectedExpected = bodyCarrier;
    }
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
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "record-literal", "analysis/objects/object-literals.ts");
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

function rustSpreadSlotLifetimes(walk: RustFactWalk, sourceFile: SourceFile, carrier: TargetTypeRef,
  properties: readonly Node[], explicit: ReadonlyMap<string, Node>): TargetTypeRef {
  const target = rustStructuralObjectCarrierValue(carrier);
  if (target === undefined) return carrier;
  const copied = new Map<string, TargetTypeRef>();
  for (const property of properties) {
    if (walk.context.ast.kindName(property) !== KindSpreadAssignment) continue;
    const operand = SpreadAssignment_Expression(walk.context.ast, property);
    const source = operand === undefined ? undefined : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    const value = source === undefined ? undefined : rustStructuralObjectCarrierValue(rustOptionElementCarrier(source) ?? source);
    for (const field of value?.fields ?? []) if (field.method === true) copied.set(field.sourceName, field.type);
  }
  let changed = false;
  const fields = target.fields.map(field => {
    const source = field.method === true && !explicit.has(field.sourceName) ? copied.get(field.sourceName) : undefined;
    let type = source === undefined ? field.type : rustCallableTargetForSourceLifetime(source, field.type);
    // An explicit property whose value is itself a structural object keeps that value's closed method slot lifetimes
    // (`{ inner: make(7) }`), the same way a spread keeps the copied slots' lifetimes.
    const property = field.method === true ? undefined : explicit.get(field.sourceName);
    const value = property === undefined ? undefined : ObjectLiteralProperty_Value(walk.context.ast, property);
    if (value !== undefined && !walk.context.ast.is.IsArrowFunction(value) && !walk.context.ast.is.IsFunctionExpression(value) &&
      rustStructuralObjectCarrierValue(field.type) !== undefined) {
      const valueCarrier = resolveExpressionCarrier(walk, value, sourceFile, undefined);
      if (valueCarrier !== undefined) type = rustAdoptStructuralSlotLifetimes(type, valueCarrier);
    }
    if (type === field.type) return field;
    changed = true;
    return { ...field, type };
  });
  return changed ? rustStructuralObjectTargetType(target.ownerFileName, fields, target.representation, target.construction, target.bases, target.implementation)
    : carrier;
}

/** The target structural carrier with each placeholder method slot taking the matching slot lifetime of the source. */
function rustAdoptStructuralSlotLifetimes(target: TargetTypeRef, source: TargetTypeRef): TargetTypeRef {
  const targetValue = rustStructuralObjectCarrierValue(target);
  const sourceValue = rustStructuralObjectCarrierValue(source);
  if (targetValue === undefined || sourceValue === undefined || targetValue.fields.length !== sourceValue.fields.length) return target;
  let changed = false;
  const fields = targetValue.fields.map(field => {
    const match = sourceValue.fields.find(candidate => candidate.sourceName === field.sourceName && candidate.method === field.method);
    if (match === undefined) return field;
    const type = field.method === true ? rustCallableTargetForSourceLifetime(match.type, field.type)
      : rustAdoptStructuralSlotLifetimes(field.type, match.type);
    if (type === field.type) return field;
    changed = true;
    return { ...field, type };
  });
  return changed ? rustStructuralObjectTargetType(targetValue.ownerFileName, fields, targetValue.representation,
    targetValue.construction, targetValue.bases, targetValue.implementation) : target;
}
