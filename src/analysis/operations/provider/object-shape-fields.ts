import {
  KindPropertyAssignment,
  KindShorthandPropertyAssignment,
  orderEnumerableOwnStringProperties,
} from "@tsonic/target-api/source";
import {
  isRustJsArrayCarrier,
  rustJsArrayLikeElementTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueConversionIsFallible } from "../../../target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../../policy/conversions/selection.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type {
  RustSourceObjectField,
  RustSourceObjectShape,
} from "../../project-types/source-type-registry.js";
import type { RustTargetOperationFact } from "../../facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

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

type SelectedAuthoredObjectFields =
  | { readonly kind: "resolved"; readonly fields: readonly RustSourceObjectField[] }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectedAuthoredObjectFields(
  shape: RustSourceObjectShape,
  context: RustOperationPolicyContext,
): SelectedAuthoredObjectFields {
  const selected: {
    readonly field: RustSourceObjectField;
    readonly owner: Node;
    readonly start: number;
  }[] = [];
  for (const field of shape.fields) {
    const declarations = field.declarations.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      const owner = context.ast.parent(declaration);
      return owner !== undefined &&
        context.ast.kindName(owner) === "KindObjectLiteralExpression" &&
        (kind === KindPropertyAssignment || kind === KindShorthandPropertyAssignment ||
          kind === "KindGetAccessor" || kind === "KindSetAccessor" ||
          kind === "KindMethodDeclaration");
    });
    const getters = declarations.filter((declaration) =>
      context.ast.kindName(declaration) === "KindGetAccessor");
    const setters = declarations.filter((declaration) =>
      context.ast.kindName(declaration) === "KindSetAccessor");
    const methods = declarations.filter((declaration) =>
      context.ast.kindName(declaration) === "KindMethodDeclaration");
    const expectedCount = field.accessor === undefined
      ? 1
      : field.accessor.setter
        ? 2
        : 1;
    if (declarations.length !== expectedCount ||
      (field.accessor === undefined && field.method !== true &&
        (getters.length !== 0 || setters.length !== 0 || methods.length !== 0)) ||
      (field.accessor !== undefined && (
        getters.length !== 1 || setters.length !== (field.accessor.setter ? 1 : 0) ||
        methods.length !== 0
      )) ||
      (field.method === true && (
        methods.length !== 1 || getters.length !== 0 || setters.length !== 0
      ))) {
      return {
        kind: "rejected",
        reason: `Closed Object projection member '${field.sourceName}' is not owned by one exact object-literal property contract.`,
      };
    }
    const owner = context.ast.parent(declarations[0]!);
    const ranges = declarations.map((declaration) =>
      context.ast.authoredRange(declaration));
    if (owner === undefined || context.ast.kindName(owner) !== "KindObjectLiteralExpression" ||
      declarations.some((declaration) => context.ast.parent(declaration) !== owner) ||
      ranges.some((range) => range.kind !== "authored") ||
      declarations.some((declaration) => context.ast.questionToken(declaration) !== undefined)) {
      return {
        kind: "rejected",
        reason: `Closed Object projection member '${field.sourceName}' has no exact required own-property declaration.`,
      };
    }
    selected.push({
      field,
      owner,
      start: Math.min(...ranges.map((range) =>
        range.kind === "authored" ? range.start : Number.MAX_SAFE_INTEGER)),
    });
  }
  const owner = selected[0]?.owner;
  if (owner === undefined || selected.some((entry) => entry.owner !== owner) ||
    new Set(selected.map((entry) => entry.start)).size !== selected.length ||
    context.ast.properties(owner).length !== shape.fields.reduce(
      (count, field) => count + (field.accessor?.setter === true ? 2 : 1),
      0,
    )) {
    return {
      kind: "rejected",
      reason: "Closed Object projection fields do not belong to one unambiguous authored object literal.",
    };
  }
  const authored = [...selected]
    .sort((left, right) => left.start - right.start)
    .map((entry) => entry.field);
  return {
    kind: "resolved",
    fields: orderEnumerableOwnStringProperties(
      authored,
      (field) => field.sourceName,
    ),
  };
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
      valueCarrier,
    );
    return conversion === undefined || rustValueConversionIsFallible(conversion)
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
          targetField.resultCarrier,
        );
    if (conversion !== undefined && rustValueConversionIsFallible(conversion) ||
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
