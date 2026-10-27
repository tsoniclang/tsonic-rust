import {
  closedStringUnionVariants, denseNodes, freezeSourceObjectShape, structuralCarrierKey, freezeSourceUnion,
  sourceObjectTargetContractEquals, appendStructuralProjection, selectStructuralProjection, sourceObjectShapeEquals,
  sourceUnionTargetContractEquals, nodeListsEqual,
} from "./source-shape-contracts.js";
import type { Node, Symbol, Type } from "@tsonic/tsts";
import { rustSourceDeclarationTypeName, rustSourceTypeDeclarations } from "./source-declarations.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { createRustSourceTypeFamilyRegistry } from "./type-families.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { closedMetadataKey, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { createRustTypeDefinitionRegistry, type RustTypeDefinitionRegistry } from "./type-definitions.js";
import {
  ObjectLiteralProperty_SourceName, sourceClassFieldIsTypeOnly, sourceObjectMemberDeclarations,
  sourceParameterIsProperty,
} from "@tsonic/target-api/source";
import {
  rustSourceTypeCarrier, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustOptionElementCarrier,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import type { RustSourceTypeRegistry } from "./source-type-model.js";
import type {
  RustSourceEnumVariant, RustSourceObjectShape, RustSourceUnion, RustStructuralFieldImplementation,
  RustStructuralFieldRegistration, RustStructuralInstantiation,
} from "../../target-model/records/types/source-types.js";

export function createRustSourceTypeRegistry(
  typeFamilies: RustSourceTypeFamilyRegistry = createRustSourceTypeFamilyRegistry(),
  typeDefinitions: RustTypeDefinitionRegistry = createRustTypeDefinitionRegistry(),
): RustSourceTypeRegistry {
  const declarations = new Map<string, Node>();
  const carriersByDeclaration = new WeakMap<Node,
    { readonly kind: "nominal"; readonly carrier: TargetTypeRef } |
    { readonly kind: "selected"; readonly carrier: TargetTypeRef }>();
  const variantsByDeclaration = new Map<Node, readonly RustSourceEnumVariant[]>();
  const structuralObjectsByType = new WeakMap<Type, RustSourceObjectShape[]>();
  const structuralTemplatesByType = new WeakMap<Type, RustSourceObjectShape[]>();
  const structuralObjects: RustSourceObjectShape[] = [];
  const structuralObjectsByCarrier = new Map<string, RustSourceObjectShape[]>();
  const structuralAliases = new WeakSet<Node>();
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
      closedMetadataKey(carrier);
  };

  const keyForCarrier = (carrier: TargetTypeRef): string | undefined => {
    const value = rustSourceTypeCarrierValue(carrier);
    if (value !== undefined) {
      return `${value.fileName}::${value.typeName}`;
    }
    const union = rustSourceUnionCarrierValue(carrier);
    return union === undefined ? undefined : `${union.fileName}::${union.typeName}`;
  };

  const carrierForDeclaration = (declaration: Node): TargetTypeRef | undefined =>
    carriersByDeclaration.get(declaration)?.carrier;

  const retainStructuralInstantiation = (template: TargetTypeRef, instance: TargetTypeRef): void => {
    if (rustTargetTypeRefEquals(template, instance)) return;
    const key = closedMetadataKey([structuralCarrierKey(template), structuralCarrierKey(instance)]);
    const entries = structuralInstantiationsByKey.get(key) ?? [];
    if (entries.some(entry => rustTargetTypeRefEquals(entry.template, template) &&
      rustTargetTypeRefEquals(entry.instance, instance))) return;
    const entry = Object.freeze({ template, instance });
    entries.push(entry);
    structuralInstantiationsByKey.set(key, entries);
    structuralInstantiations.push(entry);
  };

  return {
    typeFamilies,
    closedValueCarrier: typeDefinitions.closedValueCarrier,
    sourceEnumDefinition: typeDefinitions.sourceEnumDefinition,
    sourceUnionVariants: typeDefinitions.sourceUnionVariants,
    sourceUnionPayloadTemplate: typeDefinitions.sourceUnionPayloadTemplate,
    programErrorOrigin: typeDefinitions.programErrorOrigin,
    reserveSourceUnion(declaration, carrier) {
      const value = rustSourceUnionCarrierValue(rustOptionElementCarrier(carrier) ?? carrier);
      const existing = carriersByDeclaration.get(declaration)?.carrier;
      if (value?.origin !== "authored" || existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) return false;
      const key = `${value.fileName}::${value.typeName}`;
      const owner = declarations.get(key);
      if (owner !== undefined && owner !== declaration) return false;
      carriersByDeclaration.set(declaration, Object.freeze({ kind: "selected", carrier }));
      declarations.set(key, declaration);
      if (!sourceUnionsByDeclaration.has(declaration)) pendingUnions.add(declaration);
      return true;
    },
    pendingSourceUnions: () => Object.freeze([...pendingUnions]),
    registerSourceFile(sourceFile, ast, isNativeNode) {
      const fileName = ast.getFileName(sourceFile);
      if (fileName.length === 0 || ast.isDeclarationFile(sourceFile)) {
        return;
      }
      const statements = ast.statements(sourceFile);
      if (!isDenseDataArray(statements) || statements.some((declaration) => declaration === undefined)) {
        return;
      }
      for (const declaration of rustSourceTypeDeclarations(sourceFile, ast, isNativeNode)) {
        if (carriersByDeclaration.has(declaration)) continue;
        const kind = ast.kindName(declaration);
        const variants = kind === "KindTypeAliasDeclaration" ? closedStringUnionVariants(declaration, ast) : undefined;
        const shape = kind === "KindClassDeclaration" || kind === "KindClassExpression" || kind === "KindInterfaceDeclaration"
          ? "object"
          : kind === "KindEnumDeclaration" || variants !== undefined
            ? "enum" : undefined;
        const typeName = shape === undefined ? "" : rustSourceDeclarationTypeName(declaration, ast);
        const carrier = shape === undefined || typeName.length === 0
          ? undefined : rustSourceTypeCarrier(fileName, typeName, shape);
        const key = carrier === undefined ? undefined : keyForCarrier(carrier);
        if (key !== undefined && carrier !== undefined) {
          const owner = declarations.get(key);
          const ownerKind = owner === undefined ? undefined : ast.kindName(owner);
          const mergedClass = kind === "KindClassDeclaration" && ownerKind === "KindInterfaceDeclaration";
          if (owner !== undefined && owner !== declaration &&
            !mergedClass && (kind !== "KindInterfaceDeclaration" ||
              ownerKind !== "KindInterfaceDeclaration" && ownerKind !== "KindClassDeclaration")) continue;
          carriersByDeclaration.set(declaration, Object.freeze({ kind: "nominal", carrier }));
          if (variants !== undefined) variantsByDeclaration.set(declaration, variants);
          if (owner === undefined || mergedClass) declarations.set(key, declaration);
        }
      }
    },
    registerDeclarationCarrier(declaration, carrier) {
      const existing = carriersByDeclaration.get(declaration);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing.carrier, carrier)) return false;
      const key = keyForCarrier(carrier);
      if (key !== undefined) {
        const owner = declarations.get(key);
        if (owner !== undefined && owner !== declaration) return false;
      }
      if (existing?.kind === "selected") return true;
      carriersByDeclaration.set(declaration, Object.freeze({ kind: "selected", carrier }));
      if (key !== undefined) declarations.set(key, declaration);
      return true;
    },
    registerRepresentationAlias(declaration, carrier) {
      const existing = carriersByDeclaration.get(declaration);
      if (existing?.kind === "selected") return rustTargetTypeRefEquals(existing.carrier, carrier);
      const key = structuralCarrierKey(carrier);
      if (structuralAliases.has(declaration) && (key === undefined || !structuralObjectsByCarrier.has(key))) return false;
      const nominalKey = existing === undefined ? undefined : keyForCarrier(existing.carrier);
      if (nominalKey !== undefined && declarations.get(nominalKey) === declaration &&
        !rustTargetTypeRefEquals(existing?.carrier, carrier)) declarations.delete(nominalKey);
      carriersByDeclaration.set(declaration, Object.freeze({ kind: "selected", carrier }));
      return true;
    },
    carrierForDeclaration,
    declarationForCarrier(carrier) {
      const key = keyForCarrier(carrier);
      return key === undefined ? undefined : declarations.get(key);
    },
    propertyKeysForCarrier(carrier, ast, semanticsFor: (node: Node) => SourceFileSemantics) {
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
          const name = ast.name(member);
          const selectedName = name !== undefined && (ast.is.IsComputedPropertyName(name) || ast.is.IsNumericLiteral(name))
            ? semanticsFor(member).propertyNames.get(name) : ObjectLiteralProperty_SourceName(ast, member);
          if (selectedName?.kind !== "resolved" || seen.has(selectedName.name)) {
            return undefined;
          }
          seen.add(selectedName.name);
          keys.push(selectedName.name);
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
    registerStructuralObject(shape, registration) {
      if (typeof registration !== "object" || registration === null || !isRustTargetTypeRef(shape.carrier)) return false;
      if (registration.kind !== "root" && registration.kind !== "generic-instantiation") return false;
      if (registration.kind === "generic-instantiation" && !isRustTargetTypeRef(registration.template)) return false;
      const value = rustStructuralObjectCarrierValue(shape.carrier);
      if (value === undefined) return false;
      const construction = value.construction;
      if (!rustTargetTypeRefEquals(construction, shape.construction?.carrier)) return false;
      const normalized = freezeSourceObjectShape(shape);
      const carrierKey = closedMetadataKey(normalized.carrier);
      const template = registration.kind === "root" ? undefined : registration.template;
      const templateKey = template === undefined ? undefined : structuralCarrierKey(template);
      const templateShape = templateKey === undefined ? undefined : structuralObjectsByCarrier.get(templateKey)?.find(candidate =>
        rustTargetTypeRefEquals(candidate.carrier, template));
      if (template !== undefined && templateShape === undefined) return false;
      const aliasEntry = normalized.sourceAlias === undefined ? undefined : carriersByDeclaration.get(normalized.sourceAlias);
      const aliasTemplate = aliasEntry?.kind === "selected" ? aliasEntry.carrier : undefined;
      const aliasTemplateKey = aliasTemplate === undefined ? undefined : structuralCarrierKey(aliasTemplate);
      if (aliasTemplate !== undefined && (aliasTemplateKey === undefined || !structuralObjectsByCarrier.has(aliasTemplateKey))) return false;
      const retainRegistration = (): void => {
        if (registration.kind === "root") {
          const templates = structuralTemplatesByType.get(normalized.sourceType) ?? [];
          if (!templates.some(candidate => sourceObjectShapeEquals(candidate, normalized)))
            structuralTemplatesByType.set(normalized.sourceType, [...templates, normalized]);
        }
        if (registration.kind !== "root" && templateShape !== undefined)
          retainStructuralInstantiation(templateShape.carrier, normalized.carrier);
        if (normalized.sourceAlias === undefined) return;
        structuralAliases.add(normalized.sourceAlias);
      };
      const existingForType = structuralObjectsByType.get(shape.sourceType) ?? [];
      if (existingForType.some((existing) =>
        sourceObjectShapeEquals(existing, normalized)
      )) {
        retainRegistration();
        return true;
      }
      const sameCarrier = existingForType.filter((existing) =>
        rustTargetTypeRefEquals(existing.carrier, normalized.carrier));
      if (sameCarrier.some((existing) =>
        !sourceObjectTargetContractEquals(existing, normalized) ||
        existing.construction?.declaration !== normalized.construction?.declaration ||
        existing.construction?.signatureInfo.signature !== normalized.construction?.signatureInfo.signature
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
      retainRegistration();
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
      const selected = carrier === undefined ? structuralTemplatesByType : structuralObjectsByType;
      const candidates = (selected.get(type) ?? []).filter((shape) =>
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
            typeIdentities: new Set(references.typeIdentities),
            lifetimeIdentities: new Set(references.lifetimeIdentities),
            constIdentities: new Set(),
          },
        ) === undefined) return false;
      }
      const indexes = sourceUnionIndexesByType.get(key) ?? new WeakMap<Type, readonly number[]>();
      const pendingIndexes = new Map<Type, number[]>();
      for (const [index, variant] of union.variants.entries()) {
        if (!isDenseDataArray(variant.sourceTypes) || variant.sourceTypes.length === 0 ||
          variant.sourceTypes.some(type => type === undefined) || new Set(variant.sourceTypes).size !== variant.sourceTypes.length) return false;
        for (const sourceType of variant.sourceTypes) {
          const selected = pendingIndexes.get(sourceType);
          if (selected === undefined) pendingIndexes.set(sourceType, [index]);
          else selected.push(index);
        }
      }
      if (!pendingIndexes.has(union.sourceType)) {
        pendingIndexes.set(union.sourceType, union.variants.map((_, index) => index));
      }
      for (const [sourceType, selected] of pendingIndexes) {
        const existing = indexes.get(sourceType);
        if (existing !== undefined && (existing.length !== selected.length ||
          existing.some((index, position) => index !== selected[position]))) return false;
      }
      const pendingDeclarationsBySymbol = new Map<Symbol, readonly Node[]>();
      const normalized = freezeSourceUnion(union);
      for (const property of normalized.selectedProperties) {
        const existingDeclarations = pendingDeclarationsBySymbol.get(property.symbol) ??
          selectedDeclarationsBySymbol.get(property.symbol);
        if (existingDeclarations !== undefined &&
          !nodeListsEqual(existingDeclarations, property.declarations)) {
          return false;
        }
        pendingDeclarationsBySymbol.set(property.symbol, property.declarations);
      }
      const existingCarrier = union.declaration === undefined ? undefined : carriersByDeclaration.get(union.declaration)?.carrier;
      if (byDeclaration === undefined && existingCarrier !== undefined &&
        !rustTargetTypeRefEquals(rustOptionElementCarrier(existingCarrier) ?? existingCarrier, normalized.carrier)) {
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
        carriersByDeclaration.set(union.declaration, Object.freeze({ kind: "selected", carrier: existingCarrier ?? normalized.carrier }));
        pendingUnions.delete(union.declaration);
      }
      if (byKey === undefined) sourceUnionsByKey.set(key, normalized);
      if (union.declaration === undefined) {
        const variantsKey = closedMetadataKey(union.variants.map(variant => variant.carrier));
        if (!generatedUnionCarriersByVariants.has(variantsKey)) generatedUnionCarriersByVariants.set(variantsKey, normalized.carrier);
      }
      for (const [sourceType, selected] of pendingIndexes) indexes.set(sourceType, Object.freeze(selected));
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
