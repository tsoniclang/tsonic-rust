import {
  KindFunctionExpression,
  KindSpreadAssignment,
  Node_Type,
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
} from "@tsonic/target-api/source";
import {
  rustOptionElementCarrier,
  rustCallableProtocol,
  rustStructuralMethodCallableCarrier,
  rustClosureProtocol,
  rustCallableTargetType,
  rustStructuralPropertyValueCarrier,
  rustClosureTargetType,
  rustUnitTargetType,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../policy/types/target-types.js";
import { appendMalformedSourceAst } from "../declarations/project-types.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import { resolveExpressionCarrier } from "./carriers.js";
import { resolveFunctionExpressionCarrier } from "../callables/closures.js";
import { resolveObjectLiteralMethodCarrier, resolveProjectIndexRecordLiteral, resolveProjectMethodPropertyCarrier, resolveRustRecordShape, selectRustRecordLiteralUnionVariant, selectRustRecordLiteralUnionVariantByCheckedType } from "../objects/record-shapes.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { rustProjectInterfaceContracts } from "../project-types/type-policy.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import { rustRuntimeCarrierKey } from "../../policy/model/selections.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { selectSourceObjectLiteralAccessors } from "@tsonic/target-api/source";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../policy/types/model.js";

export function requireDenseSourceNodes(
  walk: RustFactWalk,
  values: readonly (Node | undefined)[] | undefined,
  message: string,
): readonly Node[] | undefined {
  if (values === undefined || !isDenseDataArray(values) ||
    values.some((value) => value === undefined)) {
    appendMalformedSourceAst(walk, message);
    return undefined;
  }
  return values as readonly Node[];
}

export function resolveRecordLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
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
  const selectedExpected = expected ?? resolveRustTargetTypeRef(
    walk.context.semanticsFor(expression).getTypeAtLocation(expression),
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  if (selectedExpected === undefined) {
    return undefined;
  }
  const indexedDefinition = walk.context.projectTypes.definitionForCarrier(selectedExpected);
  const indexedLayout = indexedDefinition?.kind === "interface"
    ? rustProjectObjectLayout(indexedDefinition.declaration, ast)
    : undefined;
  if (indexedLayout !== undefined && indexedLayout.indexSignatures.length !== 0) {
    return resolveProjectIndexRecordLiteral(
      walk,
      expression,
      sourceFile,
      selectedExpected,
      properties,
      indexedDefinition!,
      indexedLayout,
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
  let containsSpread = false;
  for (const property of properties) {
    const kind = ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      containsSpread = true;
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
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldName.length === 0 || explicitPropertiesByName.has(fieldName)) {
      return undefined;
    }
    explicitPropertiesByName.set(fieldName, property);
  }
  const sourceValue = rustSourceTypeCarrierValue(selectedExpected);
  const unionValue = rustSourceUnionCarrierValue(selectedExpected);
  const structuralExpected = rustStructuralObjectCarrierValue(selectedExpected);
  let resultCarrier: TargetTypeRef;
  let storage: "project-object" | "object-handle";
  let selectedProjectDefinition: import("../project-types/type-policy.js").RustProjectTypeDefinition | undefined;
  let selectedFields: readonly {
    readonly implementationDeclaration?: Node;
    readonly contractDeclarations: readonly Node[];
    readonly sourceName: string;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[];
  let selectedMethodDeclarations: readonly Node[] = [];
  if (sourceValue?.shape === "object") {
    const definition = walk.context.projectTypes.definitionForCarrier(selectedExpected);
    const contracts = definition === undefined
      ? undefined
      : rustProjectInterfaceContracts(
          walk.context.projectTypes,
          definition,
          selectedExpected,
        );
    if (definition?.kind !== "interface" || contracts === undefined) {
      return undefined;
    }
    const contractFields = contracts.flatMap((contract) => {
      const layout = rustProjectObjectLayout(contract.definition.declaration, ast);
      if (layout?.kind !== "interface") {
        return [undefined];
      }
      return layout.fields.map((field) => {
        const implementation = walk.context.projectTypes.memberImplementation(
          definition,
          field.declaration,
        );
        const declared = walk.context.facts.get(field.declaration, rustRuntimeCarrierKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, field.declaration));
        const carrier = declared === undefined
          ? undefined
          : walk.context.projectTypes.instantiateMemberCarrier(
              field.declaration,
              selectedExpected,
              declared,
            );
        return carrier === undefined || implementation.kind !== "resolved"
          ? undefined
          : {
              contractDeclaration: field.declaration,
              implementationDeclaration: implementation.implementation.declaration,
              sourceName: field.sourceName,
              carrier,
              presence: "required" as const,
              readonly: ast.hasModifierKind(field.declaration, "readonly"),
            };
      });
    });
    if (contractFields.some((field) => field === undefined)) {
      return undefined;
    }
    const projectFields: {
      readonly implementationDeclaration: Node;
      readonly contractDeclarations: Node[];
      readonly sourceName: string;
      readonly storageIndex: number;
      readonly carrier: TargetTypeRef;
      readonly presence: "required";
      readonly readonly: boolean;
    }[] = [];
    for (const field of contractFields as readonly {
      readonly contractDeclaration: Node;
      readonly implementationDeclaration: Node;
      readonly sourceName: string;
      readonly carrier: TargetTypeRef;
      readonly presence: "required";
      readonly readonly: boolean;
    }[]) {
      const existing = projectFields.find((candidate) =>
        candidate.implementationDeclaration === field.implementationDeclaration);
      if (existing !== undefined) {
        if (!rustTargetTypeRefEquals(existing.carrier, field.carrier)) {
          return undefined;
        }
        existing.contractDeclarations.push(field.contractDeclaration);
        continue;
      }
      projectFields.push({
        implementationDeclaration: field.implementationDeclaration,
        contractDeclarations: [field.contractDeclaration],
        sourceName: field.sourceName,
        storageIndex: projectFields.length,
        carrier: field.carrier,
        presence: "required",
        readonly: field.readonly,
      });
    }
    resultCarrier = selectedExpected;
    storage = "project-object";
    selectedProjectDefinition = definition;
    selectedMethodDeclarations = contracts.flatMap((contract) =>
      ast.members(contract.definition.declaration).filter((member): member is Node =>
        member !== undefined && ast.kindName(member) === "KindMethodSignature"));
    selectedFields = projectFields as readonly {
      readonly implementationDeclaration: Node;
      readonly contractDeclarations: readonly Node[];
      readonly sourceName: string;
      readonly storageIndex: number;
      readonly carrier: TargetTypeRef;
      readonly presence: "required";
      readonly readonly: boolean;
      readonly accessor?: {
        readonly getter: true;
        readonly setter: boolean;
      };
    }[];
  } else {
    let structuralCarrier = structuralExpected === undefined ? undefined : selectedExpected;
    let structuralValue = structuralExpected;
    if (unionValue !== undefined) {
      const sourceUnion = walk.sourceTypes.sourceUnionForCarrier(selectedExpected);
      const selectedVariant = sourceUnion === undefined
        ? undefined
        : containsSpread
          ? selectRustRecordLiteralUnionVariantByCheckedType(
              walk,
              expression,
              sourceUnion,
            )
          : selectRustRecordLiteralUnionVariant(
              walk,
              expression,
              sourceUnion,
              explicitPropertiesByName,
            );
      if (selectedVariant === undefined) {
        return undefined;
      }
      structuralCarrier = selectedVariant.carrier;
      structuralValue = rustStructuralObjectCarrierValue(structuralCarrier);
    }
    if (structuralCarrier === undefined || structuralValue === undefined) {
      return undefined;
    }
    resultCarrier = structuralCarrier;
    storage = "object-handle";
    const structuralShape = walk.sourceTypes.structuralObjectForCarrier(structuralCarrier);
    if (structuralShape === undefined ||
      structuralShape.fields.length !== structuralValue.fields.length) {
      return undefined;
    }
    const selectedAccessorMembers = accessorSelection.kind === "resolved"
      ? accessorSelection.members
      : [];
    const structuralFields = structuralValue.fields.map((field, storageIndex) => {
      const sourceField = structuralShape.fields[storageIndex];
      const matchingAccessors = selectedAccessorMembers.filter((accessor) =>
        accessor.sourceName === field.sourceName
      );
      const accessor = matchingAccessors[0];
      if (sourceField === undefined || sourceField.sourceName !== field.sourceName ||
        sourceField.storageIndex !== storageIndex ||
        !rustTargetTypeRefEquals(sourceField.resultCarrier, field.type) ||
        sourceField.presence !== field.presence || sourceField.readonly !== field.readonly ||
        sourceField.accessor?.setter !== field.accessor?.setter ||
        sourceField.method !== field.method || matchingAccessors.length > 1 ||
        (accessor !== undefined && (
          field.method === true || accessor.getter === undefined ||
          accessor.sourceSelectedDeclarations.length === 0 ||
          accessor.sourceSelectedDeclarations.some((declaration) =>
            !sourceField.declarations.includes(declaration)) ||
          !field.readonly && accessor.setter === undefined
        ))) {
        return undefined;
      }
      return {
        contractDeclarations: sourceField.declarations,
        sourceName: field.sourceName,
        storageIndex,
        carrier: field.type,
        presence: field.presence,
        readonly: field.readonly,
        ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
        ...(field.method === true ? { method: true as const } : {}),
      };
    });
    if (structuralFields.some((field) => field === undefined)) {
      return undefined;
    }
    selectedFields = structuralFields as typeof selectedFields;
  }
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
      const sourceShape = sourceCarrier === undefined
        ? undefined
        : resolveRustRecordShape(walk, sourceCarrier, false);
      if (spreadExpression === undefined || sourceCarrier === undefined ||
        sourceShape === undefined) {
        return undefined;
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
        if (!rustTargetTypeRefEquals(sourceField.carrier, targetField.carrier) ||
          sourceField.method !== targetField.method ||
          sourceField.method === true && (
            sourceShape.storage !== "object-handle" ||
            !rustTargetTypeRefEquals(sourceCarrier, resultCarrier)
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
      const sourceDefinition = walk.context.projectTypes.definitionForCarrier(sourceCarrier);
      const spreadMethods: {
        readonly contractDeclaration: Node;
        readonly sourceDeclaration: Node;
        readonly callableCarrier: TargetTypeRef;
      }[] = [];
      if (storage === "project-object") {
        for (const contractDeclaration of selectedMethodDeclarations) {
          const implementation = sourceDefinition === undefined
            ? undefined
            : walk.context.projectTypes.memberImplementation(
                sourceDefinition,
                contractDeclaration,
              );
          const callableCarrier = resolveProjectMethodPropertyCarrier(
            walk,
            contractDeclaration,
            sourceCarrier,
          );
          if (implementation?.kind !== "resolved" || callableCarrier === undefined) {
            return undefined;
          }
          spreadMethods.push({
            contractDeclaration,
            sourceDeclaration: implementation.implementation.declaration,
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
        fields: spreadFields,
        methods: spreadMethods,
      });
      continue;
    }
    const propertySemantics = walk.context.semanticsFor(property);
    const selectedElement = propertySemantics.getResolvedObjectLiteralElementInfo(property);
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
            selectedElement.sourceElementType,
          );
      const selectedCallableCarrier = rustOptionElementCarrier(selectedMemberCarrier) ??
        selectedMemberCarrier;
      const selectedCallable = rustCallableProtocol(selectedCallableCarrier);
      const selectedClosure = rustClosureProtocol(selectedCallableCarrier);
      const selectedParameterCarriers = selectedCallableCarrier?.kind === "function-pointer"
        ? selectedCallableCarrier.args
        : selectedCallable?.parameters ?? selectedClosure?.parameters;
      const selectedResultCarrier = selectedCallableCarrier?.kind === "function-pointer"
        ? selectedCallableCarrier.result
        : selectedCallable?.result ?? selectedClosure?.result;
      const sourceName = selectedElement?.sourceSelectedSymbol === undefined
        ? ""
        : propertySemantics.getSymbolName(selectedElement.sourceSelectedSymbol);
      if (storage === "object-handle") {
        const methodProjection = selectedDeclaration === undefined
          ? undefined
          : walk.sourceTypes.structuralFieldProjectionForDeclaration(
              selectedDeclaration,
              resultCarrier,
            );
        const targetField = selectedFields.find((field) =>
          field.method === true && field.sourceName === sourceName &&
          field.storageIndex === methodProjection?.field.storageIndex);
        const targetCallableCarrier = targetField === undefined
          ? undefined
          : rustStructuralMethodCallableCarrier(
              targetField.carrier,
              targetField.presence,
            );
        const targetCallable = rustCallableProtocol(targetCallableCarrier);
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
        const methodCarrier = rustCallableTargetType(
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
          kind: "structural-method",
          property,
          expression: property,
          sourceName,
          targetStorageIndex: targetField.storageIndex,
        });
        assignedStorageIndexes.add(targetField.storageIndex);
        continue;
      }
      const matchedDeclarations = selectedMethodDeclarations.filter((declaration) => {
        const implementation = selectedProjectDefinition === undefined
          ? undefined
          : walk.context.projectTypes.memberImplementation(
              selectedProjectDefinition,
              declaration,
            );
        return implementation?.kind === "resolved" && selectedDeclarations.includes(
          implementation.implementation.declaration,
        );
      });
      if (storage !== "project-object" || selectedElement?.elementKind !== "method" ||
        selectedDeclaration === undefined || !selectedMethodDeclarations.includes(selectedDeclaration) ||
        matchedDeclarations.length === 0 || selectedParameterCarriers === undefined ||
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
    const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
    const initializer = ObjectLiteralProperty_Value(ast, property);
    const initializerKind = initializer === undefined ? "" : ast.kindName(initializer);
    if (initializer !== undefined &&
      (initializerKind === KindFunctionExpression || initializerKind === "KindArrowFunction") &&
      storage === "project-object" && selectedElement?.elementKind === "property") {
      const selectedDeclarations = selectedElement.sourceSelectedDeclarations;
      const selectedDeclaration = selectedElement.sourceSelectedDeclaration;
      const matchedDeclarations = selectedMethodDeclarations.filter((declaration) => {
        const implementation = selectedProjectDefinition === undefined
          ? undefined
          : walk.context.projectTypes.memberImplementation(
              selectedProjectDefinition,
              declaration,
            );
        return implementation?.kind === "resolved" && selectedDeclarations.includes(
          implementation.implementation.declaration,
        );
      });
      const selectedMemberCarrier = selectedDeclaration === undefined
        ? undefined
        : resolveObjectLiteralMethodCarrier(
            walk,
            initializer,
            selectedElement.sourceSelectedType,
            selectedElement.sourceElementType,
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
        matchedDeclarations.length === 0 || selectedParameterCarriers === undefined ||
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
          (selectedElement?.sourceSelectedDeclaration === field.implementationDeclaration ||
            selectedElement?.sourceSelectedDeclarations.includes(field.implementationDeclaration)))
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
  if (storage === "object-handle" && selectedFields.some((field) => {
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
  setRustOperationFact(walk, expression, {
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
    walk.objectLiteralMethodExpressions.push(expression);
  }
  if (contributions.some((contribution) =>
    contribution.kind === "spread" && contribution.methods.length > 0)) {
    walk.objectLiteralMethodSpreadExpressions.push(expression);
  }
  return setCarrierFact(walk, expression, resultCarrier);
}
