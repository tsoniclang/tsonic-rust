import type {
  AstReader,
  Node,
  Symbol,
  Type,
} from "@tsonic/tsts";
import { rustSourceDeclarationTypeName, rustSourceTypeDeclarations } from "../../policy/types/source-declarations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { createRustSourceTypeFamilyRegistry } from "./type-families.js";
import type { RustSourceTypeFamilyRegistry } from "../../policy/types/type-families.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { createRustTypeDefinitionRegistry, type RustTypeDefinitionRegistry } from "./type-definitions.js";
import {
  KindStringLiteral,
  Node_Type,
  ObjectLiteralProperty_SourceName,
  sourceClassFieldIsTypeOnly,
  sourceObjectMemberDeclarations,
  sourceParameterIsProperty,
} from "@tsonic/target-api/source";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import type {
  RustSourceEnumVariant,
  RustSourceObjectField,
  RustSourceObjectShape,
  RustSourceTypeRegistry,
  RustSourceUnion,
  RustStructuralFieldImplementation,
  RustStructuralFieldRegistration,
  RustStructuralInstantiation,
} from "../../policy/types/source-type-registry.js";
export type {
  RustSourceEnumVariant,
  RustSourceObjectField,
  RustSourceObjectShape,
  RustSourceTypeRegistry,
  RustSourceUnion,
  RustSourceUnionVariant,
  RustStructuralFieldImplementation,
  RustStructuralFieldRegistration,
} from "../../policy/types/source-type-registry.js";

export function createRustSourceTypeRegistry(
  typeFamilies: RustSourceTypeFamilyRegistry = createRustSourceTypeFamilyRegistry(),
  typeDefinitions: RustTypeDefinitionRegistry = createRustTypeDefinitionRegistry(),
): RustSourceTypeRegistry {
  const declarations = new Map<string, Node>();
  const carriersByDeclaration = new WeakMap<Node, TargetTypeRef>();
  const variantsByDeclaration = new Map<Node, readonly RustSourceEnumVariant[]>();
  const structuralObjectsByType = new WeakMap<Type, RustSourceObjectShape[]>();
  const structuralObjects: RustSourceObjectShape[] = [];
  const structuralObjectsByCarrier = new Map<string, RustSourceObjectShape[]>();
  const structuralInstantiations: RustStructuralInstantiation[] = [];
  const structuralInstantiationsByKey = new Map<string, RustStructuralInstantiation[]>();
  const structuralFieldsBySymbol = new WeakMap<Symbol, RustStructuralFieldRegistration[]>();
  const structuralFieldsByDeclaration = new WeakMap<Node, RustStructuralFieldRegistration[]>();
  const structuralFieldImplementations: RustStructuralFieldImplementation[] = [];
  const selectedDeclarationsBySymbol = new WeakMap<Symbol, readonly Node[]>();
  const sourceUnionsByDeclaration = new WeakMap<Node, RustSourceUnion>();
  const pendingUnions = new Set<Node>();
  const sourceUnionsByKey = new Map<string, RustSourceUnion>();
  const generatedUnionCarriersByVariants = new Map<string, TargetTypeRef>();
  const sourceUnionIndexesByType = new Map<string, WeakMap<Type, readonly number[]>>();
  const sourceUnionKey = (carrier: TargetTypeRef): string | undefined => {
    const value = rustSourceUnionCarrierValue(carrier);
    return value === undefined ? undefined :
      `${value.origin}::${value.fileName}::${value.typeName}::${closedMetadataKey(value.genericArguments)}`;
  };

  const keyForCarrier = (carrier: TargetTypeRef): string | undefined => {
    const value = rustSourceTypeCarrierValue(carrier);
    if (value !== undefined) {
      return `${value.fileName}::${value.typeName}`;
    }
    const union = rustSourceUnionCarrierValue(carrier);
    return union === undefined ? undefined : `${union.fileName}::${union.typeName}`;
  };

  const carrierForDeclaration = (declaration: Node, ast: AstReader): TargetTypeRef | undefined => {
    const registered = carriersByDeclaration.get(declaration);
    if (registered !== undefined) {
      return registered;
    }
    const sourceUnion = sourceUnionsByDeclaration.get(declaration);
    if (sourceUnion !== undefined) {
      return sourceUnion.carrier;
    }
    const sourceFile = ast.getSourceFile(declaration);
    const fileName = ast.getFileName(sourceFile);
    if (fileName.length === 0 || ast.isDeclarationFile(sourceFile)) {
      return undefined;
    }
    const kind = ast.kindName(declaration);
    const shape = kind === "KindClassDeclaration" || kind === "KindClassExpression" || kind === "KindInterfaceDeclaration"
      ? "object"
      : kind === "KindEnumDeclaration" ||
          (kind === "KindTypeAliasDeclaration" && variantsByDeclaration.has(declaration))
        ? "enum"
        : undefined;
    if (shape === undefined) {
      return undefined;
    }
    const typeName = rustSourceDeclarationTypeName(declaration, ast);
    return typeName.length === 0
      ? undefined
      : rustSourceTypeCarrier(fileName, typeName, shape);
  };

  return {
    typeFamilies,
    sourceUnionVariants: typeDefinitions.sourceUnionVariants,
    reserveSourceUnion(declaration, carrier) {
      const value = rustSourceUnionCarrierValue(carrier);
      const existing = carriersByDeclaration.get(declaration);
      if (value?.origin !== "authored" || existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) return false;
      carriersByDeclaration.set(declaration, carrier);
      if (!sourceUnionsByDeclaration.has(declaration)) pendingUnions.add(declaration);
      return true;
    },
    pendingSourceUnions: () => Object.freeze([...pendingUnions]),
    registerSourceFile(sourceFile, ast) {
      const fileName = ast.getFileName(sourceFile);
      if (fileName.length === 0 || ast.isDeclarationFile(sourceFile)) {
        return;
      }
      const statements = ast.statements(sourceFile);
      if (!isDenseDataArray(statements) || statements.some((declaration) => declaration === undefined)) {
        return;
      }
      for (const declaration of rustSourceTypeDeclarations(sourceFile, ast)) {
        if (ast.kindName(declaration) === "KindTypeAliasDeclaration") {
          const variants = closedStringUnionVariants(declaration, ast);
          if (variants !== undefined) {
            variantsByDeclaration.set(declaration, variants);
          }
        }
        const carrier = carrierForDeclaration(declaration, ast);
        const key = carrier === undefined ? undefined : keyForCarrier(carrier);
        if (key !== undefined) {
          declarations.set(key, declaration);
        }
      }
    },
    registerDeclarationCarrier(declaration, carrier) {
      const existing = carriersByDeclaration.get(declaration);
      if (existing !== undefined) {
        return rustTargetTypeRefEquals(existing, carrier);
      }
      carriersByDeclaration.set(declaration, carrier);
      const key = keyForCarrier(carrier);
      if (key !== undefined) {
        const owner = declarations.get(key);
        if (owner !== undefined && owner !== declaration) {
          carriersByDeclaration.delete(declaration);
          return false;
        }
        declarations.set(key, declaration);
      }
      return true;
    },
    registerRepresentationAlias(declaration, carrier) {
      const existing = carriersByDeclaration.get(declaration);
      if (existing !== undefined) {
        return rustTargetTypeRefEquals(existing, carrier);
      }
      carriersByDeclaration.set(declaration, carrier);
      return true;
    },
    carrierForDeclaration,
    declarationForCarrier(carrier) {
      const key = keyForCarrier(carrier);
      return key === undefined ? undefined : declarations.get(key);
    },
    propertyKeysForCarrier(carrier, ast) {
      const key = keyForCarrier(carrier);
      const declaration = key === undefined ? undefined : declarations.get(key);
      if (declaration === undefined ||
        (ast.kindName(declaration) !== "KindInterfaceDeclaration" &&
          ast.kindName(declaration) !== "KindClassDeclaration" && ast.kindName(declaration) !== "KindClassExpression") ||
        ast.extendsHeritageElements(declaration).length !== 0) {
        return undefined;
      }
      const declarationKind = ast.kindName(declaration);
      const members = denseNodes(sourceObjectMemberDeclarations(ast, declaration));
      if (members === undefined) {
        return undefined;
      }
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const member of members) {
        if (sourceClassFieldIsTypeOnly(ast, member) || ast.hasModifierKind(member, "abstract")) continue;
        const kind = ast.kindName(member);
        if ((declarationKind === "KindInterfaceDeclaration" && kind === "KindPropertySignature") ||
          ((declarationKind === "KindClassDeclaration" || declarationKind === "KindClassExpression") &&
            (kind === "KindPropertyDeclaration" || sourceParameterIsProperty(ast, member)))) {
          if (ast.hasModifierKind(member, "static")) {
            continue;
          }
          if (ast.questionToken(member) !== undefined) return undefined;
          const selectedName = ObjectLiteralProperty_SourceName(ast, member);
          if (selectedName.kind !== "resolved" || selectedName.name.length === 0 || seen.has(selectedName.name)) {
            return undefined;
          }
          const name = selectedName.name;
          seen.add(name);
          keys.push(name);
          continue;
        }
        if ((declarationKind === "KindClassDeclaration" || declarationKind === "KindClassExpression") &&
          (kind === "KindConstructor" || kind === "KindMethodDeclaration" ||
            kind === "KindGetAccessor" || kind === "KindSetAccessor")) {
          continue;
        }
        return undefined;
      }
      return Object.freeze(keys);
    },
    enumVariantsForDeclaration(declaration) {
      return variantsByDeclaration.get(declaration);
    },
    enumVariantForLiteral(carrier, literal) {
      const key = keyForCarrier(carrier);
      const declaration = key === undefined ? undefined : declarations.get(key);
      return declaration === undefined
        ? undefined
        : variantsByDeclaration.get(declaration)?.find((variant) => variant.literal === literal);
    },
    registerStructuralObject(shape, template) {
      if (!isRustTargetTypeRef(shape.carrier)) return false;
      const value = rustStructuralObjectCarrierValue(shape.carrier);
      if (value === undefined) return false;
      const construction = value.construction;
      if (!rustTargetTypeRefEquals(construction, shape.construction?.carrier)) return false;
      const normalized = freezeSourceObjectShape(shape);
      const carrierKey = closedMetadataKey(normalized.carrier);
      const templateKey = template === undefined ? undefined : structuralCarrierKey(template);
      const templateShape = templateKey === undefined ? undefined : structuralObjectsByCarrier.get(templateKey)?.find(candidate =>
        rustTargetTypeRefEquals(candidate.carrier, template));
      if (template !== undefined && templateShape === undefined) return false;
      const retainInstantiation = (): void => {
        if (templateShape === undefined || templateKey === undefined ||
          rustTargetTypeRefEquals(templateShape.carrier, normalized.carrier)) return;
        const key = closedMetadataKey([templateKey, carrierKey]);
        const entries = structuralInstantiationsByKey.get(key) ?? [];
        if (entries.some(entry => rustTargetTypeRefEquals(entry.template, templateShape.carrier) &&
          rustTargetTypeRefEquals(entry.instance, normalized.carrier))) return;
        const entry = Object.freeze({ template: templateShape.carrier, instance: normalized.carrier });
        entries.push(entry);
        structuralInstantiationsByKey.set(key, entries);
        structuralInstantiations.push(entry);
      };
      const existingForType = structuralObjectsByType.get(shape.sourceType) ?? [];
      if (existingForType.some((existing) =>
        sourceObjectShapeEquals(existing, normalized)
      )) {
        retainInstantiation();
        return true;
      }
      const sameCarrier = existingForType.filter((existing) =>
        rustTargetTypeRefEquals(existing.carrier, normalized.carrier));
      if (sameCarrier.some((existing) =>
        !sourceObjectTargetContractEquals(existing, normalized) ||
        existing.construction?.declaration !== normalized.construction?.declaration ||
        existing.construction?.signature !== normalized.construction?.signature
      )) {
        return false;
      }
      const pendingDeclarationsBySymbol = new Map<Symbol, readonly Node[]>();
      const pendingFieldsBySymbol = new Map<Symbol, RustStructuralFieldRegistration[]>();
      const pendingFieldsByDeclaration = new Map<Node, RustStructuralFieldRegistration[]>();
      for (const field of normalized.fields) {
        const registration = Object.freeze({ shape: normalized, field });
        for (const symbol of field.symbols) {
          const existingDeclarations = pendingDeclarationsBySymbol.get(symbol) ??
            selectedDeclarationsBySymbol.get(symbol);
          if (existingDeclarations !== undefined &&
            !nodeListsEqual(existingDeclarations, field.declarations)) {
            return false;
          }
          pendingDeclarationsBySymbol.set(symbol, field.declarations);
          const entries = pendingFieldsBySymbol.get(symbol) ??
            [...(structuralFieldsBySymbol.get(symbol) ?? [])];
          if (!appendStructuralProjection(entries, registration)) {
            return false;
          }
          pendingFieldsBySymbol.set(symbol, entries);
        }
        for (const declaration of field.declarations) {
          const entries = pendingFieldsByDeclaration.get(declaration) ??
            [...(structuralFieldsByDeclaration.get(declaration) ?? [])];
          if (!appendStructuralProjection(entries, registration)) {
            return false;
          }
          pendingFieldsByDeclaration.set(declaration, entries);
        }
      }
      structuralObjectsByType.set(shape.sourceType, [...existingForType, normalized]);
      structuralObjects.push(normalized);
      const carrierShapes = structuralObjectsByCarrier.get(carrierKey) ?? [];
      carrierShapes.push(normalized);
      structuralObjectsByCarrier.set(carrierKey, carrierShapes);
      retainInstantiation();
      for (const [symbol, declarationsForSymbol] of pendingDeclarationsBySymbol) {
        selectedDeclarationsBySymbol.set(symbol, declarationsForSymbol);
      }
      for (const [symbol, entries] of pendingFieldsBySymbol) {
        structuralFieldsBySymbol.set(symbol, entries);
      }
      for (const [declaration, entries] of pendingFieldsByDeclaration) {
        structuralFieldsByDeclaration.set(declaration, entries);
      }
      return true;
    },
    registerStructuralFieldImplementation(implementation) {
      if (!Number.isSafeInteger(implementation.storageIndex) ||
        implementation.storageIndex < 0) {
        return false;
      }
      const key = structuralCarrierKey(implementation.carrier);
      const shape = (key === undefined ? undefined : structuralObjectsByCarrier.get(key))?.find((candidate) =>
        rustTargetTypeRefEquals(candidate.carrier, implementation.carrier));
      if (shape?.fields[implementation.storageIndex] === undefined) {
        return false;
      }
      if (structuralFieldImplementations.some((candidate) =>
        candidate.storageIndex === implementation.storageIndex &&
        candidate.kind === implementation.kind &&
        rustTargetTypeRefEquals(candidate.carrier, implementation.carrier))) {
        return true;
      }
      structuralFieldImplementations.push(Object.freeze({ ...implementation }));
      return true;
    },
    structuralObjects() {
      return Object.freeze([...structuralObjects]);
    },
    structuralObjectForCarrier(carrier) {
      const key = structuralCarrierKey(carrier);
      const candidates = (key === undefined ? [] : structuralObjectsByCarrier.get(key) ?? []).filter((shape) =>
        rustTargetTypeRefEquals(shape.carrier, carrier));
      const first = candidates[0];
      return first !== undefined && candidates.every((candidate) =>
        sourceObjectTargetContractEquals(first, candidate))
        ? first
        : undefined;
    },
    structuralFieldImplementations() {
      return Object.freeze([...structuralFieldImplementations]);
    },
    structuralObjectForType(type, carrier) {
      const candidates = (structuralObjectsByType.get(type) ?? []).filter((shape) =>
        carrier === undefined || rustTargetTypeRefEquals(shape.carrier, carrier));
      const first = candidates[0];
      return first !== undefined && candidates.every((candidate) =>
        rustTargetTypeRefEquals(candidate.carrier, first.carrier) &&
        sourceObjectTargetContractEquals(candidate, first)
      )
        ? first
        : undefined;
    },
    structuralFieldProjectionForSymbol(symbol, receiverCarrier) {
      return selectStructuralProjection(
        structuralFieldsBySymbol.get(symbol) ?? [],
        receiverCarrier,
      );
    },
    structuralFieldProjectionForDeclaration(declaration, receiverCarrier) {
      return selectStructuralProjection(
        structuralFieldsByDeclaration.get(declaration) ?? [],
        receiverCarrier,
      );
    },
    declarationsForSelectedSymbol(symbol) {
      return selectedDeclarationsBySymbol.get(symbol);
    },
    registerSourceUnion(union) {
      const value = rustSourceUnionCarrierValue(union.carrier);
      const key = sourceUnionKey(union.carrier);
      if (value === undefined || key === undefined ||
        (value.origin === "authored") !== (union.declaration !== undefined)) {
        return false;
      }
      const byDeclaration = union.declaration === undefined ? undefined : sourceUnionsByDeclaration.get(union.declaration);
      const byKey = sourceUnionsByKey.get(key);
      if (byKey !== undefined) {
        if (!sourceUnionTargetContractEquals(byKey, union)) return false;
      }
      if (byDeclaration !== undefined && byKey === undefined) {
        const references = rustTargetGenericReferences(byDeclaration.carrier);
        if (value.genericArguments.length === 0 || inferRustTargetGenericBindings(
          byDeclaration.carrier, union.carrier, {
            typeNames: new Set(references.typeNames),
            lifetimeIdentities: new Set(references.lifetimeIdentities),
            constIdentities: new Set(),
          },
        ) === undefined) return false;
      }
      const normalized = freezeSourceUnion(union);
      const indexes = sourceUnionIndexesByType.get(key) ?? new WeakMap<Type, readonly number[]>();
      const pendingIndexes = new Map<Type, readonly number[]>([
        [union.sourceType, Object.freeze(union.variants.map((_, index) => index))],
      ]);
      for (const [index, variant] of union.variants.entries()) {
        const selected = Object.freeze([index]);
        const existing = pendingIndexes.get(variant.sourceType) ?? indexes.get(variant.sourceType);
        if (existing !== undefined && (existing.length !== 1 || existing[0] !== index)) return false;
        pendingIndexes.set(variant.sourceType, selected);
      }
      for (const [sourceType, selected] of pendingIndexes) {
        const existing = indexes.get(sourceType);
        if (existing !== undefined && (existing.length !== selected.length ||
          existing.some((index, position) => index !== selected[position]))) return false;
      }
      const pendingDeclarationsBySymbol = new Map<Symbol, readonly Node[]>();
      for (const property of normalized.selectedProperties) {
        const existingDeclarations = pendingDeclarationsBySymbol.get(property.symbol) ??
          selectedDeclarationsBySymbol.get(property.symbol);
        if (existingDeclarations !== undefined &&
          !nodeListsEqual(existingDeclarations, property.declarations)) {
          return false;
        }
        pendingDeclarationsBySymbol.set(property.symbol, property.declarations);
      }
      const existingCarrier = union.declaration === undefined ? undefined : carriersByDeclaration.get(union.declaration);
      if (byDeclaration === undefined && existingCarrier !== undefined &&
        !rustTargetTypeRefEquals(existingCarrier, normalized.carrier)) {
        return false;
      }
      const declarationKey = `${value.fileName}::${value.typeName}`;
      const existingDeclaration = declarations.get(declarationKey);
      if (union.declaration !== undefined && existingDeclaration !== undefined && existingDeclaration !== union.declaration) {
        return false;
      }
      if (!typeDefinitions.registerSourceUnion({
        carrier: normalized.carrier,
        variants: normalized.variants.map(variant => ({name: variant.name, carrier: variant.carrier})),
      }, byDeclaration === undefined && union.declaration !== undefined)) return false;
      if (byDeclaration === undefined && union.declaration !== undefined) {
        sourceUnionsByDeclaration.set(union.declaration, normalized);
        carriersByDeclaration.set(union.declaration, normalized.carrier);
        pendingUnions.delete(union.declaration);
      }
      if (byKey === undefined) sourceUnionsByKey.set(key, normalized);
      if (union.declaration === undefined) {
        const variantsKey = closedMetadataKey(union.variants.map(variant => variant.carrier));
        if (!generatedUnionCarriersByVariants.has(variantsKey)) generatedUnionCarriersByVariants.set(variantsKey, normalized.carrier);
      }
      for (const [sourceType, selected] of pendingIndexes) indexes.set(sourceType, selected);
      sourceUnionIndexesByType.set(key, indexes);
      if (union.declaration !== undefined) declarations.set(declarationKey, union.declaration);
      for (const [symbol, declarationsForSymbol] of pendingDeclarationsBySymbol) {
        selectedDeclarationsBySymbol.set(symbol, declarationsForSymbol);
      }
      return true;
    },
    generatedSourceUnions() {
      return Object.freeze([...sourceUnionsByKey.values()].filter(union => union.declaration === undefined));
    },
    generatedUnionCarrierForVariants(carriers) {
      return generatedUnionCarriersByVariants.get(closedMetadataKey(carriers));
    },
    sourceUnionForCarrier(carrier) {
      const key = sourceUnionKey(carrier);
      const union = key === undefined ? undefined : sourceUnionsByKey.get(key);
      return union === undefined || !rustTargetTypeRefEquals(carrier, union.carrier)
        ? undefined
        : union;
    },
    structuralInstantiations() {
      const result: RustStructuralInstantiation[] = [...structuralInstantiations];
      for (const union of sourceUnionsByKey.values()) {
        if (union.declaration === undefined) continue;
        const template = sourceUnionsByDeclaration.get(union.declaration);
        if (template === undefined || template === union) continue;
        for (const [index, variant] of union.variants.entries()) {
          const original = template.variants[index];
          if (original !== undefined && rustStructuralObjectCarrierValue(original.carrier) !== undefined &&
            rustStructuralObjectCarrierValue(variant.carrier) !== undefined) {
            result.push(Object.freeze({ template: original.carrier, instance: variant.carrier }));
          }
        }
      }
      return Object.freeze(result);
    },
    sourceUnionVariantIndexesForTypes(carrier, types) {
      const key = sourceUnionKey(carrier);
      const union = key === undefined
        ? undefined
        : sourceUnionsByKey.get(key);
      const byType = key === undefined ? undefined : sourceUnionIndexesByType.get(key);
      if (union === undefined || byType === undefined ||
        !rustTargetTypeRefEquals(carrier, union.carrier) || types.length === 0) {
        return undefined;
      }
      const indexes: number[] = [];
      for (const type of types) {
        const matches = byType.get(type);
        if (matches === undefined) return undefined;
        for (const index of matches) if (!indexes.includes(index)) indexes.push(index);
      }
      return Object.freeze(indexes.sort((left, right) => left - right));
    },
  };
}

function closedStringUnionVariants(
  declaration: Node,
  ast: AstReader,
): readonly RustSourceEnumVariant[] | undefined {
  const aliasType = Node_Type(ast, declaration);
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

function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
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

function freezeSourceObjectShape(shape: RustSourceObjectShape): RustSourceObjectShape {
  return Object.freeze({
    sourceType: shape.sourceType,
    carrier: snapshotClosedMetadata(shape.carrier),
    storage: shape.storage,
    fields: Object.freeze(shape.fields.map(freezeSourceObjectField)),
    ...(shape.construction === undefined ? {} : { construction: Object.freeze({
      ...shape.construction, carrier: snapshotClosedMetadata(shape.construction.carrier),
    }) }),
  });
}

function structuralCarrierKey(carrier: TargetTypeRef): string | undefined {
  return !isRustTargetTypeRef(carrier) || rustStructuralObjectCarrierValue(carrier) === undefined
    ? undefined : closedMetadataKey(carrier);
}

function freezeSourceUnion(union: RustSourceUnion): RustSourceUnion {
  return Object.freeze({
    declaration: union.declaration,
    sourceType: union.sourceType,
    carrier: union.carrier,
    variants: Object.freeze(union.variants.map((variant) => Object.freeze({
      name: variant.name,
      sourceType: variant.sourceType,
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

function sourceObjectTargetContractEquals(
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

function appendStructuralProjection(
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

function selectStructuralProjection(
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

function sourceObjectShapeEquals(
  left: RustSourceObjectShape,
  right: RustSourceObjectShape,
): boolean {
  return left.sourceType === right.sourceType &&
    left.construction?.declaration === right.construction?.declaration &&
    left.construction?.signature === right.construction?.signature &&
    rustTargetTypeRefEquals(left.construction?.carrier, right.construction?.carrier) &&
    left.storage === right.storage &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.fields.length === right.fields.length &&
    left.fields.every((field, index) =>
      sourceObjectFieldEquals(field, right.fields[index]!));
}

function sourceUnionTargetContractEquals(
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

function nodeListsEqual(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length &&
    left.every((node, index) => node === right[index]);
}

function symbolListsEqual(left: readonly Symbol[], right: readonly Symbol[]): boolean {
  return left.length === right.length &&
    left.every((symbol, index) => symbol === right[index]);
}
