import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import { isRustJsArrayCarrier, rustJsArrayLikeElementTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustValueConversionIsFallible } from "../../../conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../../conversions/selection.js";
import { type RustSourceObjectField } from "../../../../target-model/records/types/source-types.js";
import { type RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import { type TargetTypeRef } from "../../../../target-model/types/model.js";

export interface SelectedObjectShapeProjection {
  readonly projection: Extract<
    RustTargetOperationFact,
    { readonly kind: "object-shape-projection" }
  >["projection"];
  readonly sourceName: string;
  readonly sourceValue: "first-argument" | "receiver";
  readonly keyArgumentIndex?: number;
  readonly assignmentSourceArgumentIndex?: number;
  readonly expectedArgumentCount: number;
  readonly static: boolean;
}

type SelectedProjectionFields =
  | {
      readonly kind: "resolved";
      readonly fields: Extract<
        RustTargetOperationFact,
        { readonly kind: "object-shape-projection" }
      >["fields"];
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectObjectShapeProjectionFields(
  projection: SelectedObjectShapeProjection["projection"],
  fields: readonly RustSourceObjectField[],
  resultCarrier: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): SelectedProjectionFields {
  if (projection === "has-own") {
    return rustTargetTypeRefEquals(resultCarrier, rustSourcePrimitiveTargetType("bool"))
      ? { kind: "resolved", fields: fields.map(projectIdentityField) }
      : { kind: "rejected", reason: "Object.hasOwn requires an exact boolean result carrier." };
  }
  if (projection === "assign") {
    return { kind: "rejected", reason: "Object.assign requires an exact source-to-target field relation." };
  }
  const elementCarrier = isRustJsArrayCarrier(resultCarrier)
    ? rustJsArrayLikeElementTargetType(resultCarrier)
    : undefined;
  if (elementCarrier === undefined) {
    return {
      kind: "rejected",
      reason: `Object.${projection} requires an exact JavaScript-array result carrier.`,
    };
  }
  if (projection === "keys") {
    return rustTargetTypeRefEquals(elementCarrier, rustStringTargetType())
      ? { kind: "resolved", fields: fields.map(projectIdentityField) }
      : { kind: "rejected", reason: "Object.keys requires an exact string-array result carrier." };
  }
  const valueCarrier = projection === "entries" && elementCarrier.kind === "tuple" &&
      elementCarrier.elements.length === 2 &&
      rustTargetTypeRefEquals(elementCarrier.elements[0]!, rustStringTargetType())
    ? elementCarrier.elements[1]
    : projection === "values"
      ? elementCarrier
      : undefined;
  if (valueCarrier === undefined) {
    return {
      kind: "rejected",
      reason: "Object.entries requires an exact JavaScript array of [string, value] tuples.",
    };
  }
  const methodField = fields.find((field) => field.method === true);
  if (methodField !== undefined) {
    return {
      kind: "rejected",
      reason: `Object.${projection} member '${methodField.sourceName}' is a method value whose JavaScript receiver binding has no exact standalone Rust callable representation.`,
    };
  }
  const projected = fields.map((field) => {
    if (rustTargetTypeRefEquals(field.resultCarrier, valueCarrier)) {
      return projectIdentityField(field);
    }
    const conversion = selectRustSourceValueConversion(
      field.resultCarrier,
      valueCarrier, definitions,
    );
    return conversion === undefined || rustValueConversionIsFallible(conversion, definitions)
      ? undefined
      : {
          ...projectIdentityField(field),
          conversion,
        };
  });
  const unresolvedIndex = projected.findIndex((field) => field === undefined);
  return unresolvedIndex === -1
    ? {
        kind: "resolved",
        fields: projected as NonNullable<typeof projected[number]>[],
      }
    : {
        kind: "rejected",
        reason: `Object.${projection} member '${fields[unresolvedIndex]!.sourceName}' has no exact infallible result conversion.`,
      };
}

type SelectedAssignmentFields =
  | {
      readonly kind: "resolved";
      readonly fields: NonNullable<
        Extract<
          RustTargetOperationFact,
          { readonly kind: "object-shape-projection" }
        >["assignmentFields"]
      >;
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectObjectAssignmentFields(
  targetFields: readonly RustSourceObjectField[],
  sourceFields: readonly RustSourceObjectField[],
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): SelectedAssignmentFields {
  const relations = sourceFields.map((sourceField) => {
    const targets = targetFields.filter((targetField) =>
      targetField.sourceName === sourceField.sourceName);
    const targetField = targets.length === 1 ? targets[0] : undefined;
    if (sourceField.method === true || sourceField.accessor !== undefined ||
      sourceField.presence !== "required") {
      return {
        kind: "rejected" as const,
        reason: `Object.assign source member '${sourceField.sourceName}' is not an exact required data property.`,
      };
    }
    if (targetField === undefined || targetField.method === true ||
      targetField.accessor !== undefined || targetField.presence !== "required" ||
      targetField.readonly) {
      return {
        kind: "rejected" as const,
        reason: `Object.assign source member '${sourceField.sourceName}' has no unique writable required target property.`,
      };
    }
    const conversion = rustTargetTypeRefEquals(
      sourceField.resultCarrier,
      targetField.resultCarrier,
    )
      ? undefined
      : selectRustSourceValueConversion(
          sourceField.resultCarrier,
          targetField.resultCarrier, definitions,
        );
    if (conversion !== undefined && rustValueConversionIsFallible(conversion, definitions) ||
      conversion === undefined && !rustTargetTypeRefEquals(
        sourceField.resultCarrier,
        targetField.resultCarrier,
      )) {
      return {
        kind: "rejected" as const,
        reason: `Object.assign source member '${sourceField.sourceName}' has no exact infallible target conversion.`,
      };
    }
    return {
      kind: "resolved" as const,
      field: {
        sourceName: sourceField.sourceName,
        sourceStorageIndex: sourceField.storageIndex,
        targetStorageIndex: targetField.storageIndex,
        sourceCarrier: sourceField.resultCarrier,
        targetCarrier: targetField.resultCarrier,
        ...(conversion === undefined ? {} : { conversion }),
      },
    };
  });
  const rejection = relations.find((relation) => relation.kind === "rejected");
  return rejection?.kind === "rejected"
    ? rejection
    : {
        kind: "resolved",
        fields: relations.map((relation) =>
          (relation as Extract<typeof relation, { readonly kind: "resolved" }>).field),
      };
}

function projectIdentityField(
  field: RustSourceObjectField,
): Extract<
  RustTargetOperationFact,
  { readonly kind: "object-shape-projection" }
>["fields"][number] {
  return {
    sourceName: field.sourceName,
    storageIndex: field.storageIndex,
    valueCarrier: field.resultCarrier,
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
  };
}

export function selectedObjectShapeProjection(
  ownerName: string,
  memberName: string,
): SelectedObjectShapeProjection | undefined {
  if (ownerName === "ObjectConstructor") {
    if (memberName === "assign") {
      return {
        projection: "assign",
        sourceName: memberName,
        sourceValue: "first-argument",
        assignmentSourceArgumentIndex: 1,
        expectedArgumentCount: 2,
        static: true,
      };
    }
    if (memberName === "keys" || memberName === "values" || memberName === "entries") {
      return {
        projection: memberName,
        sourceName: memberName,
        sourceValue: "first-argument",
        expectedArgumentCount: 1,
        static: true,
      };
    }
    if (memberName === "hasOwn") {
      return {
        projection: "has-own",
        sourceName: memberName,
        sourceValue: "first-argument",
        keyArgumentIndex: 1,
        expectedArgumentCount: 2,
        static: true,
      };
    }
  }
  return ownerName === "Object" && memberName === "hasOwnProperty"
    ? {
        projection: "has-own",
        sourceName: memberName,
        sourceValue: "receiver",
        keyArgumentIndex: 0,
        expectedArgumentCount: 1,
        static: false,
      }
    : undefined;
}
