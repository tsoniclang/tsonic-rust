import { KindFunctionExpression, KindSpreadAssignment, ObjectLiteralProperty_Value, SpreadAssignment_Expression, sourceObjectLiteralDestinationMember } from "@tsonic/target-api/source";
import { rustOptionElementCarrier, rustCallableProtocol, rustStructuralMethodCallableCarrier, rustClosureProtocol, rustCallableTargetType, rustStructuralPropertyValueCarrier, rustClosureTargetType, rustUnitTargetType } from "../../target-model/types/index.js";
import { rustStructuralMethodStorageCarrier } from "../../policy/types/objects/member-storage.js";

import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { resolveFunctionExpressionCarrier } from "../callables/values/closures.js";
import { resolveObjectLiteralMethodCarrier, resolveProjectMethodPropertyCarrier, resolveRustRecordShape } from "./shapes/record-shapes.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectSourceObjectLiteralAccessors } from "@tsonic/target-api/source";

import { rustCallableTargetForSourceLifetime, selectRustValueCarrierReconciliation } from "../../policy/conversions/value-carrier-reconciliation.js";
import { recordRustValueCarrierReconciliation } from "../program/records/types/value-carrier-admission.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { projectRecordMemberImplementation, selectedProjectMethodContracts } from "./record-member-contracts.js";

import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustTypeParameterFromSourceContract } from "../../target-model/types/carriers/generic-references.js";

import { retainRustStructuralInstantiation } from "../source-evidence/types/resolution/structural-instantiations.js";

import { rustRecordPropertySourceName } from "./computed-field-names.js";
import type { selectRustRecordLiteralLayout } from "./record-literal-layout.js";
export function collectRustRecordLiteralContributions(
  walk: RustFactWalk, sourceFile: SourceFile, selectedExpected: TargetTypeRef,
  properties: readonly Node[], accessorsByElement: ReadonlyMap<Node, Extract<ReturnType<typeof selectSourceObjectLiteralAccessors>, { readonly kind: "resolved" }>["members"][number]>,
  layout: NonNullable<ReturnType<typeof selectRustRecordLiteralLayout>>,
) {
  const { ast } = walk.context;
  const { sourceValue, resultCarrier, storage, selectedFields, selectedMethodDeclarations } = layout;
  const selectedFieldByName = new Map(selectedFields.map((field) => [field.sourceName, field]));
  if (selectedFieldByName.size !== selectedFields.length) {
    return undefined;
  }
  const contributions: Extract<
    RustTargetOperationFact,
    { readonly kind: "record-literal" }
  >["contributions"][number][] = [];
  const assignedStorageIndexes = new Set<number>();
  const assignedAccessorRoles = new Map<number, Set<"get" | "set">>();
  const assignedMethodDeclarations = new Set<Node>();
  for (const property of properties) {
    const kind = ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      const spreadExpression = SpreadAssignment_Expression(ast, property);
      const sourceCarrier = spreadExpression === undefined
        ? undefined
        : resolveExpressionCarrier(walk, spreadExpression, sourceFile, undefined);
      const sourceValueCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
      const sourceShape = sourceValueCarrier === undefined
        ? undefined
        : resolveRustRecordShape(walk, sourceValueCarrier, false);
      if (spreadExpression === undefined || sourceCarrier === undefined ||
        sourceValueCarrier === undefined || sourceShape === undefined) {
        return undefined;
      }
      if (sourceShape.storage === "structural-object") {
        const subject = walk.context.sourceStorage.subjectFor(spreadExpression);
        if (subject.kind === "unresolved") return undefined;
        const selected = walk.context.sourceStorage.typeFor(subject.subject);
        if (selected.kind === "unresolved") return undefined;
        const sourceType = walk.context.source.semantics.forFile(selected.sourceFile).types.nonNullableType(selected.type);
        if (sourceType === undefined || !retainRustStructuralInstantiation(sourceType,
          sourceValueCarrier, sourceValueCarrier, rustResolutionContext(walk, spreadExpression), walk.operationOptions)) return undefined;
      }
      const spreadFields: {
        readonly sourceName: string;
        readonly sourceStorageIndex: number;
        readonly targetStorageIndex: number;
        readonly carrier: TargetTypeRef;
        readonly accessor?: {
          readonly getter: true;
          readonly setter: boolean;
        };
        readonly method?: true;
      }[] = [];
      for (const sourceField of sourceShape.fields) {
        const targetField = selectedFieldByName.get(sourceField.sourceName);
        if (targetField === undefined) {
          continue;
        }
        // A destination method slot whose callable lifetime is still a placeholder takes the copied slot's lifetime.
        if (!rustTargetTypeRefEquals(sourceField.carrier, rustCallableTargetForSourceLifetime(sourceField.carrier, targetField.carrier)) ||
          sourceField.method !== targetField.method ||
          sourceField.method === true && (
            sourceShape.storage !== "structural-object" ||
            storage !== "structural-object"
          )) {
          return undefined;
        }
        spreadFields.push({
          sourceName: sourceField.sourceName,
          sourceStorageIndex: sourceField.storageIndex,
          targetStorageIndex: targetField.storageIndex,
          carrier: targetField.carrier,
          ...(sourceField.accessor === undefined
            ? {}
            : { accessor: sourceField.accessor }),
          ...(sourceField.method === true ? { method: true as const } : {}),
        });
        assignedStorageIndexes.add(targetField.storageIndex);
      }
      const sourceDefinition = walk.context.projectTypes.definitionForCarrier(sourceValueCarrier);
      const spreadMethods: {
        readonly contractDeclaration: Node;
        readonly sourceDeclaration: Node;
        readonly callableCarrier: TargetTypeRef;
      }[] = [];
      if (storage === "project-object") {
        for (const contractDeclaration of selectedMethodDeclarations) {
          const implementation = projectRecordMemberImplementation(
            walk,
            sourceDefinition,
            contractDeclaration,
          );
          const callableCarrier = resolveProjectMethodPropertyCarrier(
            walk,
            contractDeclaration,
            sourceValueCarrier,
          );
          if (implementation === undefined || callableCarrier === undefined) {
            return undefined;
          }
          spreadMethods.push({
            contractDeclaration,
            sourceDeclaration: implementation,
            callableCarrier,
          });
          assignedMethodDeclarations.add(contractDeclaration);
        }
      }
      contributions.push({
        kind: "spread",
        property,
        expression: spreadExpression,
        sourceStorage: sourceShape.storage,
        sourceCarrier,
        sourceValueCarrier,
        fields: spreadFields,
        methods: spreadMethods,
      });
      continue;
    }
    const propertySemantics = walk.context.semanticsFor(property);
    const selectedElement = propertySemantics.operations.objectLiteralElement(property);
    const selectedObjectDeclaration = sourceValue?.shape === "object"
      ? walk.context.projectTypes.definitionForCarrier(selectedExpected)?.declaration : undefined;
    const selectedObjectType = selectedObjectDeclaration === undefined ? undefined
      : walk.context.semanticsFor(selectedObjectDeclaration).declarations.declaredType(selectedObjectDeclaration);
    const destinationMember = selectedElement === undefined || selectedObjectType === undefined ? undefined
      : sourceObjectLiteralDestinationMember(selectedElement, selectedObjectType, propertySemantics);
    if (kind === "KindGetAccessor" || kind === "KindSetAccessor") {
      const accessor = accessorsByElement.get(property);
      const role = kind === "KindGetAccessor" ? "get" as const : "set" as const;
      const matchingFields = accessor === undefined
        ? []
        : selectedFields.filter((field) =>
            field.method !== true && field.sourceName === accessor.sourceName &&
            accessor.sourceSelectedDeclarations.length > 0 &&
            accessor.sourceSelectedDeclarations.every((declaration) =>
              field.contractDeclarations.includes(declaration))
          );
      const targetField = matchingFields.length === 1 ? matchingFields[0] : undefined;
      const valueCarrier = targetField === undefined
        ? undefined
        : rustStructuralPropertyValueCarrier(targetField.carrier, targetField.presence);
      const callableCarrier = targetField === undefined || valueCarrier === undefined
        ? undefined
        : role === "get"
          ? rustCallableTargetType([resultCarrier], valueCarrier)
          : rustCallableTargetType(
              [resultCarrier, valueCarrier],
              rustUnitTargetType(),
            );
      const sourceCallableCarrier = valueCarrier === undefined
        ? undefined
        : role === "get"
          ? rustCallableTargetType([], valueCarrier)
          : rustCallableTargetType([valueCarrier], rustUnitTargetType());
      if (role === "set" && targetField?.presence === "optional") {
        appendRustDiagnostic(
          walk,
          "RUST_STRUCTURAL_OPTIONAL_ACCESSOR_WRITE_UNSUPPORTED",
          `Optional structural property '${targetField.sourceName}' has a source write contract that includes undefined, but its authored setter accepts only the declared value type.`,
          property,
          [
            "target.capability=rust.structural-property.optional-accessor-write",
            "source.write=exact-selected-property-contract",
          ],
        );
        return undefined;
      }
      if (accessor === undefined ||
        targetField === undefined || valueCarrier === undefined ||
        role === "set" && targetField.readonly || callableCarrier === undefined ||
        sourceCallableCarrier === undefined ||
        selectedElement === undefined ||
        selectedElement.sourceSelectedSymbol !== accessor.sourceSelectedSymbol ||
        !selectedElement.sourceSelectedDeclarations.every((declaration) =>
          accessor.sourceSelectedDeclarations.includes(declaration)) ||
        resolveFunctionExpressionCarrier(
          walk,
          property,
          sourceFile,
          callableCarrier,
          {
            leadingParameters: [{ kind: "this", carrier: resultCarrier }],
            preserveSourceParameterForms: true,
            sourceCarrier: sourceCallableCarrier,
          },
        ) === undefined) {
        return undefined;
      }
      const roles = assignedAccessorRoles.get(targetField.storageIndex) ?? new Set();
      if (roles.has(role)) {
        return undefined;
      }
      roles.add(role);
      assignedAccessorRoles.set(targetField.storageIndex, roles);
      contributions.push({
        kind: "accessor",
        property,
        sourceName: accessor.sourceName,
        targetStorageIndex: targetField.storageIndex,
        role,
      });
      continue;
    }
    if (kind === "KindMethodDeclaration") {
      const selectedDeclarations = selectedElement?.sourceSelectedDeclarations ?? [];
      const selectedDeclaration = selectedElement?.sourceSelectedDeclaration;
      const selectedMemberCarrier = selectedElement === undefined || selectedDeclaration === undefined
        ? undefined
        : resolveObjectLiteralMethodCarrier(
            walk,
            property,
            selectedElement.sourceSelectedType,
          );
      const selectedCallableCarrier = rustOptionElementCarrier(selectedMemberCarrier) ??
        selectedMemberCarrier;
      const methodParameters = walk.context.sourceLifetimes.contractFor(property)?.parameters
        .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
      const selectedCallable = rustGenericCallableProtocol(selectedCallableCarrier, methodParameters) ?? rustCallableProtocol(selectedCallableCarrier);
      const selectedClosure = rustClosureProtocol(selectedCallableCarrier);
      const selectedParameterCarriers = selectedCallableCarrier?.kind === "function-pointer"
        ? selectedCallableCarrier.args
        : selectedCallable?.parameters ?? selectedClosure?.parameters;
      const selectedResultCarrier = selectedCallableCarrier?.kind === "function-pointer"
        ? selectedCallableCarrier.result
        : selectedCallable?.result ?? selectedClosure?.result;
      const sourceName = selectedElement?.sourceSelectedSymbol === undefined
        ? ""
        : propertySemantics.declarations.symbolName(
            selectedElement.sourceSelectedSymbol,
          );
      if (storage === "structural-object") {
        const methodProjection = walk.sourceTypes.structuralFieldProjectionForDeclaration(property, resultCarrier);
        const targetField = selectedFields.find((field) =>
          field.method === true && field.sourceName === sourceName &&
          field.storageIndex === methodProjection?.field.storageIndex);
        const targetCallableCarrier = targetField === undefined
          ? undefined
          : rustStructuralMethodCallableCarrier(
              targetField.carrier,
              targetField.presence,
            );
        const targetCallable = rustGenericCallableProtocol(targetCallableCarrier, methodParameters) ?? rustCallableProtocol(targetCallableCarrier);
        if (selectedElement?.elementKind !== "method" ||
          selectedDeclaration === undefined || targetField === undefined ||
          selectedParameterCarriers === undefined || selectedResultCarrier === undefined ||
          targetCallable === undefined ||
          targetCallable.parameters.length !== selectedParameterCarriers.length ||
          targetCallable.parameters.some((carrier, index) =>
            !rustTargetTypeRefEquals(carrier, selectedParameterCarriers[index])) ||
          !rustTargetTypeRefEquals(targetCallable.result, selectedResultCarrier)) {
          return undefined;
        }
        const storedMethod = rustStructuralMethodStorageCarrier(resultCarrier, targetField.carrier, targetField.presence);
        const methodCarrier = targetField.presence === "optional" ? rustOptionElementCarrier(storedMethod) : storedMethod;
        if (methodCarrier === undefined) return undefined;
        const selectedMethodCarrier = resolveFunctionExpressionCarrier(walk, property, sourceFile, methodCarrier, {
          leadingParameters: [{ kind: "this", carrier: resultCarrier }],
          preserveSourceParameterForms: true,
          selectedMethodDeclaration: selectedDeclaration,
          sourceCarrier: selectedCallableCarrier,
        });
        if (selectedMethodCarrier === undefined) return undefined;
        const methodReconciliation = selectRustValueCarrierReconciliation(
          selectedMethodCarrier, methodCarrier, walk.context.projectTypes, walk.context.typeDefinitions,
        );
        if (methodReconciliation.kind === "incompatible") {
          return undefined;
        }
        if (methodReconciliation.kind !== "identity") {
          recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords,
            property, methodReconciliation);
        }
        contributions.push({
          kind: "structural-method",
          property,
          expression: property,
          sourceName,
          targetStorageIndex: targetField.storageIndex,
        });
        assignedStorageIndexes.add(targetField.storageIndex);
        continue;
      }
      const matchedDeclarations = selectedProjectMethodContracts(
        walk,
        selectedMethodDeclarations,
        selectedDeclarations,
      );
      if (storage !== "project-object" || selectedElement?.elementKind !== "method" ||
        selectedDeclaration === undefined || !selectedMethodDeclarations.includes(selectedDeclaration) ||
        matchedDeclarations === undefined || matchedDeclarations.length === 0 ||
        selectedParameterCarriers === undefined ||
        selectedResultCarrier === undefined) {
        return undefined;
      }
      const methodCarrier = rustClosureTargetType(
        [resultCarrier, ...selectedParameterCarriers],
        selectedResultCarrier,
      );
      if (resolveFunctionExpressionCarrier(walk, property, sourceFile, methodCarrier, {
        leadingParameters: [{ kind: "this", carrier: resultCarrier }],
        preserveSourceParameterForms: true,
        selectedMethodDeclaration: selectedDeclaration,
        sourceCarrier: selectedCallableCarrier,
      }) === undefined) {
        return undefined;
      }
      contributions.push({
        kind: "method",
        property,
        expression: property,
        contractDeclarations: Object.freeze([...matchedDeclarations]),
      });
      for (const declaration of matchedDeclarations) {
        assignedMethodDeclarations.add(declaration);
      }
      continue;
    }
    const nameNode = ast.name(property);
    const sourceName = rustRecordPropertySourceName(walk, nameNode);
    if (sourceName === undefined) return undefined;
    const initializer = ObjectLiteralProperty_Value(ast, property);
    const initializerKind = initializer === undefined ? "" : ast.kindName(initializer);
    if (initializer !== undefined &&
      (initializerKind === KindFunctionExpression || initializerKind === "KindArrowFunction") &&
      storage === "project-object" && selectedElement?.elementKind === "property" &&
      selectedElement.sourceSelectedDeclaration !== undefined &&
      selectedMethodDeclarations.includes(selectedElement.sourceSelectedDeclaration)) {
      const selectedDeclarations = selectedElement.sourceSelectedDeclarations;
      const selectedDeclaration = selectedElement.sourceSelectedDeclaration;
      const matchedDeclarations = selectedProjectMethodContracts(
        walk,
        selectedMethodDeclarations,
        selectedDeclarations,
      );
      const selectedMemberCarrier = selectedDeclaration === undefined
        ? undefined
        : resolveObjectLiteralMethodCarrier(
            walk,
            initializer,
            selectedElement.sourceSelectedType,
          );
      const selectedCallable = rustCallableProtocol(selectedMemberCarrier);
      const selectedClosure = rustClosureProtocol(selectedMemberCarrier);
      const selectedParameterCarriers = selectedMemberCarrier?.kind === "function-pointer"
        ? selectedMemberCarrier.args
        : selectedCallable?.parameters ?? selectedClosure?.parameters;
      const selectedResultCarrier = selectedMemberCarrier?.kind === "function-pointer"
        ? selectedMemberCarrier.result
        : selectedCallable?.result ?? selectedClosure?.result;
      if (selectedDeclaration === undefined ||
        !selectedMethodDeclarations.includes(selectedDeclaration) ||
        matchedDeclarations === undefined || matchedDeclarations.length === 0 ||
        selectedParameterCarriers === undefined ||
        selectedResultCarrier === undefined) {
        return undefined;
      }
      const methodCarrier = rustClosureTargetType(
        [resultCarrier, ...selectedParameterCarriers],
        selectedResultCarrier,
      );
      if (resolveFunctionExpressionCarrier(walk, initializer, sourceFile, methodCarrier, {
        leadingParameters: [{
          kind: initializerKind === KindFunctionExpression ? "this" : "receiver",
          carrier: resultCarrier,
        }],
        preserveSourceParameterForms: true,
        selectedMethodDeclaration: selectedDeclaration,
        sourceCarrier: selectedMemberCarrier,
      }) === undefined) {
        return undefined;
      }
      contributions.push({
        kind: "method",
        property,
        expression: initializer,
        contractDeclarations: Object.freeze([...matchedDeclarations]),
      });
      for (const declaration of matchedDeclarations) {
        assignedMethodDeclarations.add(declaration);
      }
      continue;
    }
    const targetField = storage === "project-object"
      ? selectedFields.find((field) =>
          field.implementationDeclaration !== undefined &&
          destinationMember?.declarations.includes(field.implementationDeclaration) === true)
      : selectedFieldByName.get(sourceName);
    if (targetField === undefined || initializer === undefined ||
      resolveExpressionCarrier(walk, initializer, sourceFile, targetField.carrier) === undefined) {
      return undefined;
    }
    contributions.push({
      kind: "property",
      property,
      sourceName,
      targetStorageIndex: targetField.storageIndex,
    });
    assignedStorageIndexes.add(targetField.storageIndex);
  }

  return { contributions, assignedStorageIndexes, assignedAccessorRoles, assignedMethodDeclarations };
}
