import type { AstReader, Node, Symbol } from "@tsonic/tsts";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import { KindStringLiteral, Node_Type, sourceTypeSyntaxRoot } from "@tsonic/target-api/source";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import type { RustSourceEnumVariant, RustSourceObjectField, RustSourceObjectShape, RustSourceUnion, RustStructuralFieldRegistration } from "../../target-model/records/types/source-types.js";

export function closedStringUnionVariants(
  declaration: Node,
  ast: AstReader,
): readonly RustSourceEnumVariant[] | undefined {
  const aliasType = sourceTypeSyntaxRoot(ast, Node_Type(ast, declaration));
  if (aliasType === undefined || ast.kindName(aliasType) !== "KindUnionType") {
    return undefined;
  }
  const aliasChildren = denseNodes(ast.children(aliasType));
  if (aliasChildren === undefined) {
    return undefined;
  }
  const members: Node[] = [];
  for (const child of aliasChildren) {
    if (ast.kindName(child) === "KindSyntaxList") {
      const entries = denseNodes(ast.children(child));
      if (entries === undefined) {
        return undefined;
      }
      members.push(...entries);
    } else {
      members.push(child);
    }
  }
  const semanticMembers = members.filter((child) => !ast.kindName(child).endsWith("Token"));
  const variants: RustSourceEnumVariant[] = [];
  for (const member of semanticMembers) {
    const literalNode = ast.kindName(member) === "KindLiteralType"
      ? ast.children(member)[0]
      : undefined;
    if (literalNode === undefined || ast.kindName(literalNode) !== KindStringLiteral) {
      return undefined;
    }
    const literal = ast.text(literalNode);
    const name = rustVariantName(literal);
    if (name === undefined || variants.some((variant) => variant.name === name)) {
      return undefined;
    }
    variants.push({ name, literal });
  }
  return variants.length === 0 ? undefined : variants;
}

export function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}

function rustVariantName(literal: string): string | undefined {
  const cleaned = literal.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/gu, (_, character: string) => character.toUpperCase());
  if (cleaned.length === 0 || /^[0-9]/u.test(cleaned)) {
    return undefined;
  }
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

function freezeSourceObjectField(field: RustSourceObjectField): RustSourceObjectField {
  return Object.freeze({
    declarations: Object.freeze([...field.declarations]),
    symbols: Object.freeze([...field.symbols]),
    sourceName: field.sourceName,
    sourceType: field.sourceType,
    storageIndex: field.storageIndex,
    resultCarrier: snapshotClosedMetadata(field.resultCarrier),
    presence: field.presence,
    readonly: field.readonly,
    ...(field.accessor === undefined
      ? {}
      : {
          accessor: Object.freeze({
            getter: true as const,
            setter: field.accessor.setter,
          }),
        }),
    ...(field.method === true ? { method: true as const } : {}),
  });
}

export function freezeSourceObjectShape(shape: RustSourceObjectShape): RustSourceObjectShape {
  return Object.freeze({
    sourceType: shape.sourceType,
    ...(shape.sourceAlias === undefined ? {} : { sourceAlias: shape.sourceAlias }),
    carrier: snapshotClosedMetadata(shape.carrier),
    storage: shape.storage,
    fields: Object.freeze(shape.fields.map(freezeSourceObjectField)),
    ...(shape.construction === undefined ? {} : { construction: Object.freeze({
      ...shape.construction, carrier: snapshotClosedMetadata(shape.construction.carrier),
    }) }),
  });
}

export function structuralCarrierKey(carrier: TargetTypeRef): string | undefined {
  return !isRustTargetTypeRef(carrier) || rustStructuralObjectCarrierValue(carrier) === undefined
    ? undefined : closedMetadataKey(carrier);
}

export function freezeSourceUnion(union: RustSourceUnion): RustSourceUnion {
  return Object.freeze({
    declaration: union.declaration,
    sourceType: union.sourceType,
    carrier: union.carrier,
    variants: Object.freeze(union.variants.map((variant) => Object.freeze({
      name: variant.name,
      sourceTypes: Object.freeze([...variant.sourceTypes]),
      carrier: variant.carrier,
      ...(variant.shape === undefined
        ? {}
        : { shape: freezeSourceObjectShape(variant.shape) }),
    }))),
    selectedProperties: Object.freeze(union.selectedProperties.map((property) => Object.freeze({
      symbol: property.symbol,
      declarations: Object.freeze([...property.declarations]),
    }))),
  });
}

function sourceObjectFieldEquals(
  left: RustSourceObjectField,
  right: RustSourceObjectField,
): boolean {
  return left.sourceName === right.sourceName &&
    left.sourceType === right.sourceType &&
    left.storageIndex === right.storageIndex &&
    left.presence === right.presence &&
    left.readonly === right.readonly &&
    left.accessor?.getter === right.accessor?.getter &&
    left.accessor?.setter === right.accessor?.setter &&
    left.method === right.method &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
    nodeListsEqual(left.declarations, right.declarations) &&
    symbolListsEqual(left.symbols, right.symbols);
}

export function sourceObjectTargetContractEquals(
  left: RustSourceObjectShape,
  right: RustSourceObjectShape,
): boolean {
  return left.storage === right.storage &&
    rustTargetTypeRefEquals(left.construction?.carrier, right.construction?.carrier) &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.fields.length === right.fields.length &&
    left.fields.every((field, index) => {
      const selected = right.fields[index];
      return selected !== undefined &&
        field.sourceName === selected.sourceName &&
        field.storageIndex === selected.storageIndex &&
        field.presence === selected.presence &&
        field.readonly === selected.readonly &&
        field.accessor?.getter === selected.accessor?.getter &&
        field.accessor?.setter === selected.accessor?.setter &&
        field.method === selected.method &&
        rustTargetTypeRefEquals(field.resultCarrier, selected.resultCarrier);
    });
}

export function appendStructuralProjection(
  entries: RustStructuralFieldRegistration[],
  registration: RustStructuralFieldRegistration,
): boolean {
  const sameCarrier = entries.filter((entry) =>
    rustTargetTypeRefEquals(entry.shape.carrier, registration.shape.carrier));
  if (sameCarrier.some((entry) =>
    !sourceObjectTargetFieldProjectionEquals(entry, registration)
  )) {
    return false;
  }
  if (sameCarrier.length === 0) {
    entries.push(registration);
  }
  return true;
}

export function selectStructuralProjection(
  entries: readonly RustStructuralFieldRegistration[],
  receiverCarrier: TargetTypeRef,
): RustStructuralFieldRegistration | undefined {
  const candidates = entries.filter((entry) =>
    rustTargetTypeRefEquals(entry.shape.carrier, receiverCarrier));
  const first = candidates[0];
  return first !== undefined && candidates.every((candidate) =>
    sourceObjectTargetFieldProjectionEquals(first, candidate)
  )
    ? first
    : undefined;
}

function sourceObjectTargetFieldProjectionEquals(
  left: RustStructuralFieldRegistration,
  right: RustStructuralFieldRegistration,
): boolean {
  return left.shape.storage === right.shape.storage &&
    rustTargetTypeRefEquals(left.shape.carrier, right.shape.carrier) &&
    left.field.sourceName === right.field.sourceName &&
    left.field.storageIndex === right.field.storageIndex &&
    left.field.presence === right.field.presence &&
    left.field.readonly === right.field.readonly &&
    left.field.accessor?.getter === right.field.accessor?.getter &&
    left.field.accessor?.setter === right.field.accessor?.setter &&
    left.field.method === right.field.method &&
    rustTargetTypeRefEquals(left.field.resultCarrier, right.field.resultCarrier);
}

export function sourceObjectShapeEquals(
  left: RustSourceObjectShape,
  right: RustSourceObjectShape,
): boolean {
  return left.sourceType === right.sourceType &&
    left.sourceAlias === right.sourceAlias &&
    left.construction?.declaration === right.construction?.declaration &&
    left.construction?.signatureInfo.signature === right.construction?.signatureInfo.signature &&
    rustTargetTypeRefEquals(left.construction?.carrier, right.construction?.carrier) &&
    left.storage === right.storage &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.fields.length === right.fields.length &&
    left.fields.every((field, index) =>
      sourceObjectFieldEquals(field, right.fields[index]!));
}

export function sourceUnionTargetContractEquals(
  left: RustSourceUnion,
  right: RustSourceUnion,
): boolean {
  return left.declaration === right.declaration &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.variants.length === right.variants.length &&
    left.variants.every((variant, index) => {
      const selected = right.variants[index];
      return selected !== undefined && variant.name === selected.name &&
        rustTargetTypeRefEquals(variant.carrier, selected.carrier) &&
        (variant.shape === undefined || selected.shape === undefined
          ? variant.shape === selected.shape
          : sourceObjectTargetContractEquals(variant.shape, selected.shape) &&
            variant.shape.fields.every((field, fieldIndex) =>
              nodeListsEqual(field.declarations, selected.shape!.fields[fieldIndex]!.declarations)));
    });
}

export function nodeListsEqual(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length &&
    left.every((node, index) => node === right[index]);
}

function symbolListsEqual(left: readonly Symbol[], right: readonly Symbol[]): boolean {
  return left.length === right.length &&
    left.every((symbol, index) => symbol === right[index]);
}
