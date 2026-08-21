import type {
  AstReader,
  Node,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  KindStringLiteral,
  Node_Type,
} from "@tsonic/target-api/source";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
} from "../../target-model/types/index.js";
import type {
  RustSourceEnumVariant,
  RustSourceObjectField,
  RustSourceObjectShape,
  RustSourceTypeRegistry,
  RustSourceUnion,
  RustStructuralFieldImplementation,
  RustStructuralFieldRegistration,
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

export function createRustSourceTypeRegistry(): RustSourceTypeRegistry {
  const declarations = new Map<string, Node>();
  const carriersByDeclaration = new WeakMap<Node, TargetTypeRef>();
  const variantsByDeclaration = new Map<Node, readonly RustSourceEnumVariant[]>();
  const structuralObjectsByType = new WeakMap<Type, RustSourceObjectShape[]>();
  const structuralObjects: RustSourceObjectShape[] = [];
  const structuralFieldsBySymbol = new WeakMap<Symbol, RustStructuralFieldRegistration[]>();
  const structuralFieldsByDeclaration = new WeakMap<Node, RustStructuralFieldRegistration[]>();
  const structuralFieldImplementations: RustStructuralFieldImplementation[] = [];
  const selectedDeclarationsBySymbol = new WeakMap<Symbol, readonly Node[]>();
  const sourceUnionsByDeclaration = new WeakMap<Node, RustSourceUnion>();
  const sourceUnionsByKey = new Map<string, RustSourceUnion>();

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
    const shape = kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration"
      ? "object"
      : kind === "KindEnumDeclaration" ||
          (kind === "KindTypeAliasDeclaration" && variantsByDeclaration.has(declaration))
        ? "enum"
        : undefined;
    if (shape === undefined) {
      return undefined;
    }
    const typeName = ast.text(ast.name(declaration));
    return typeName.length === 0
      ? undefined
      : rustSourceTypeCarrier(fileName, typeName, shape);
  };

  return {
    registerSourceFile(sourceFile, ast) {
      const fileName = ast.getFileName(sourceFile);
      if (fileName.length === 0 || ast.isDeclarationFile(sourceFile)) {
        return;
      }
      const statements = ast.statements(sourceFile);
      if (!isDenseDataArray(statements) || statements.some((declaration) => declaration === undefined)) {
        return;
      }
      for (const declaration of statements as readonly Node[]) {
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
          ast.kindName(declaration) !== "KindClassDeclaration") ||
        ast.extendsHeritageElements(declaration).length !== 0) {
        return undefined;
      }
      const declarationKind = ast.kindName(declaration);
      const members = denseNodes(ast.members(declaration));
      if (members === undefined) {
        return undefined;
      }
      const keys: string[] = [];
      const seen = new Set<string>();
      for (const member of members) {
        const kind = ast.kindName(member);
        if ((declarationKind === "KindInterfaceDeclaration" && kind === "KindPropertySignature") ||
          (declarationKind === "KindClassDeclaration" && kind === "KindPropertyDeclaration")) {
          if (ast.hasModifierKind(member, "static")) {
            continue;
          }
          const nameNode = ast.name(member);
          const name = nameNode === undefined ? "" : ast.text(nameNode);
          if (name.length === 0 || seen.has(name)) {
            return undefined;
          }
          seen.add(name);
          keys.push(name);
          continue;
        }
        if (declarationKind === "KindClassDeclaration" &&
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
    registerStructuralObject(shape) {
      const normalized = freezeSourceObjectShape(shape);
      const existingForType = structuralObjectsByType.get(shape.sourceType) ?? [];
      if (existingForType.some((existing) =>
        sourceObjectShapeEquals(existing, normalized)
      )) {
        return true;
      }
      const sameCarrier = existingForType.filter((existing) =>
        rustTargetTypeRefEquals(existing.carrier, normalized.carrier));
      if (sameCarrier.some((existing) =>
        !sourceObjectTargetContractEquals(existing, normalized)
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
      const shape = structuralObjects.find((candidate) =>
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
      const candidates = structuralObjects.filter((shape) =>
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
      const key = value === undefined ? undefined : `${value.fileName}::${value.typeName}`;
      if (value === undefined || key === undefined || value.variants.length !== union.variants.length ||
        value.variants.some((variant, index) => {
          const selected = union.variants[index];
          return selected === undefined || variant.name !== selected.name ||
            !rustTargetTypeRefEquals(variant.carrier, selected.carrier);
        })) {
        return false;
      }
      const byDeclaration = sourceUnionsByDeclaration.get(union.declaration);
      const byKey = sourceUnionsByKey.get(key);
      if (byDeclaration !== undefined || byKey !== undefined) {
        return byDeclaration !== undefined && byKey === byDeclaration &&
          sourceUnionEquals(byDeclaration, union);
      }
      const normalized = freezeSourceUnion(union);
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
      const existingCarrier = carriersByDeclaration.get(union.declaration);
      if (existingCarrier !== undefined &&
        !rustTargetTypeRefEquals(existingCarrier, normalized.carrier)) {
        return false;
      }
      const existingDeclaration = declarations.get(key);
      if (existingDeclaration !== undefined && existingDeclaration !== union.declaration) {
        return false;
      }
      sourceUnionsByDeclaration.set(union.declaration, normalized);
      sourceUnionsByKey.set(key, normalized);
      carriersByDeclaration.set(union.declaration, normalized.carrier);
      declarations.set(key, union.declaration);
      for (const [symbol, declarationsForSymbol] of pendingDeclarationsBySymbol) {
        selectedDeclarationsBySymbol.set(symbol, declarationsForSymbol);
      }
      return true;
    },
    sourceUnionForCarrier(carrier) {
      const value = rustSourceUnionCarrierValue(carrier);
      return value === undefined
        ? undefined
        : sourceUnionsByKey.get(`${value.fileName}::${value.typeName}`);
    },
    sourceUnionVariantIndexesForTypes(carrier, types) {
      const value = rustSourceUnionCarrierValue(carrier);
      const union = value === undefined
        ? undefined
        : sourceUnionsByKey.get(`${value.fileName}::${value.typeName}`);
      if (union === undefined || types.length === 0) {
        return undefined;
      }
      const indexes: number[] = [];
      for (const type of types) {
        const matches = union.variants.flatMap((variant, index) =>
          variant.sourceType === type ? [index] : []);
        if (matches.length !== 1) {
          return undefined;
        }
        if (!indexes.includes(matches[0]!)) {
          indexes.push(matches[0]!);
        }
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
    resultCarrier: field.resultCarrier,
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
    carrier: shape.carrier,
    storage: shape.storage,
    fields: Object.freeze(shape.fields.map(freezeSourceObjectField)),
  });
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
    left.storage === right.storage &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.fields.length === right.fields.length &&
    left.fields.every((field, index) =>
      sourceObjectFieldEquals(field, right.fields[index]!));
}

function sourceUnionEquals(
  left: RustSourceUnion,
  right: RustSourceUnion,
): boolean {
  return left.declaration === right.declaration &&
    left.sourceType === right.sourceType &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.variants.length === right.variants.length &&
    left.variants.every((variant, index) => {
      const selected = right.variants[index];
      return selected !== undefined && variant.name === selected.name &&
        variant.sourceType === selected.sourceType &&
        rustTargetTypeRefEquals(variant.carrier, selected.carrier) &&
        optionalSourceObjectShapeEquals(variant.shape, selected.shape);
    }) && left.selectedProperties.length === right.selectedProperties.length &&
    left.selectedProperties.every((property, index) => {
      const selected = right.selectedProperties[index];
      return selected !== undefined && property.symbol === selected.symbol &&
        nodeListsEqual(property.declarations, selected.declarations);
    });
}

function optionalSourceObjectShapeEquals(
  left: RustSourceObjectShape | undefined,
  right: RustSourceObjectShape | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : sourceObjectShapeEquals(left, right);
}

function nodeListsEqual(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length &&
    left.every((node, index) => node === right[index]);
}

function symbolListsEqual(left: readonly Symbol[], right: readonly Symbol[]): boolean {
  return left.length === right.length &&
    left.every((symbol, index) => symbol === right[index]);
}
