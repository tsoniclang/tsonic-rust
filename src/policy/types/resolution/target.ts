import {
  rustBigIntTargetType,
  rustEmptyObjectTargetType,
  rustObjectIdentityTargetType,
  rustFixedArrayTargetType,
  rustJsArrayTargetType,
  rustJsSymbolTargetType,
  rustSourceLocationTargetType,
  rustNullTargetType,
  rustNeverTargetType,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStructuralObjectTargetType,
  rustStructuralObjectCarrierValue,
  rustSourceUnionCarrierValue,
  rustSourceTypeCarrierValue,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustUndefinedTargetType,
  rustVecTargetType,
} from "../../../target-model/types/index.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { bindRustSourceAliasArguments } from "./generic-arguments.js";
import { instantiateTargetType, providerCarrierFromRelations, resolveOwnedSourceProfileTypeName, resolveProviderTypeIdentity, resolveSourceProfileCarrier } from "./providers.js";
import { isRustStructuralObjectFieldDeclaration, isRustErasedNominalMember } from "../source-shapes.js";
import { resolveBoundSourceTypeParameter, resolveCallableType, resolveSourcePrimitive, resolveSourceTypeParameter, resolveUnion } from "./callables.js";
import { resolveRustAuthoredTargetType, resolveRustTupleElementTargetTypeWithState } from "./tuples.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  sourcePropertyTypeEvidenceNodes,
  sourceTransformedTypeFactEvidenceNodes,
} from "@tsonic/target-api/source";
import { structFactKey } from "@tsonic/tsts";
import type { Node, StructFact, Symbol, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustRawPointerTargetType } from "../../../target-model/types/carriers/callables.js";
import { isRustSourceRawPointer } from "../../operations/raw-pointer-source.js";
import { resolveRustAuthoredBroadSourceValueTargetType } from "./broad-values.js";
import { selectTsonicFixedArrayFromSource } from "@tsonic/source-core/facts";
import type { TsonicFixedArrayFact } from "@tsonic/source-core/facts";
import { resolveRustSemanticConditionalAlias } from "./type-families.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { resolveRustSourceMarker } from "./markers.js";
import { resolveRustIndexedField } from "./indexed-fields.js";
import { resolveRustConstructType } from "./constructors.js";

export function resolveRustFixedArrayTargetType(
  fixedArray: TsonicFixedArrayFact,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  if (resolving.has(fixedArray.sourceType)) return undefined;
  resolving.add(fixedArray.sourceType);
  try {
    const element = fixedArray.elementType === undefined
      ? resolveRustTargetType(fixedArray.elementSourceType, context, options, resolving)
      : resolveRustAuthoredTargetType(fixedArray.elementType, context, options, resolving);
    return element === undefined
      ? undefined
      : rustFixedArrayTargetType(element, { kind: "integer", value: fixedArray.length.toString() });
  } finally {
    resolving.delete(fixedArray.sourceType);
  }
}

export function resolveRustTargetType(
  type: Type | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredTypeRoot?: Node,
): TargetTypeRef | undefined {
  if (type === undefined) return undefined;
  if (resolving.has(type)) {
    const symbol = context.currentSemantics.declarations.typeAliasSymbol(type);
    if (symbol === undefined || !context.currentSemantics.declarations.symbolDeclarations(symbol).some(declaration =>
      rustSourceUnionCarrierValue(options.sourceTypes.carrierForDeclaration(declaration, context.ast)) !== undefined)) return undefined;
    const arguments_ = context.currentSemantics.types.effectiveTypeArguments(type)?.map(argument =>
      resolveRustTargetType(argument, context, options, resolving)) ?? [];
    return arguments_.some(argument => argument === undefined) ? undefined : resolveProjectSourceCarrier(symbol,
      {values: arguments_.map(argument => ({kind: "type" as const, type: argument!}))}, context, options,
      undefined, type, resolving, true);
  }
  const fixedArray = selectTsonicFixedArrayFromSource(
    type,
    context.currentSemantics,
    context.source.sourceFacts,
  );
  if (fixedArray !== undefined) {
    return fixedArray.kind === "invalid"
      ? undefined
      : resolveRustFixedArrayTargetType(fixedArray.fact, context, options, resolving);
  }
  if (context.currentSemantics.facts.typeSubjects(type).some(subject => isRustSourceRawPointer(subject, context))) {
    return rustRawPointerTargetType();
  }
  const existingStructuralObject = authoredTypeRoot === undefined &&
      (context.sourceTypeParameterSubstitutions?.size ?? 0) === 0
    ? options.sourceTypes.structuralObjectForType(type)
    : undefined;
  if (existingStructuralObject !== undefined &&
    !(existingStructuralObject.fields.length === 0 &&
      rustStructuralObjectCarrierValue(existingStructuralObject.carrier)?.representation === "value")) {
    return existingStructuralObject.carrier;
  }
  const primitive = resolveSourcePrimitive(type, context);
  if (primitive !== undefined) {
    return primitive;
  }
  const substitutionBase = context.currentSemantics.types.substitutionBaseType(type);
  if (substitutionBase !== undefined) {
    return resolveRustTargetType(
      substitutionBase,
      context,
      options,
      resolving,
      authoredTypeRoot,
    );
  }
  resolving.add(type);
  try {
    const semantics = context.currentSemantics;
    const conditional = resolveRustSemanticConditionalAlias(type, context, options, resolving);
    if (conditional !== undefined) return conditional.carrier;
    const indexed = semantics.types.indexedAccessComponents(type);
    if (indexed !== undefined) return resolveRustIndexedField(indexed.objectType, indexed.indexType,
      context, options, resolving)?.result;
    if (resolveRustSourceMarker(type, context) === "pointer") {
      const arguments_ = semantics.types.effectiveTypeArguments(type);
      const pointee = arguments_?.length === 1
        ? resolveRustTargetType(arguments_[0], context, options, resolving)
        : undefined;
      return pointee === undefined ? undefined : rustSourceLocationTargetType(pointee);
    }
    if (semantics.types.isNever(type)) {
      return rustNeverTargetType();
    }
    if (semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
      return authoredTypeRoot === undefined
        ? undefined
        : resolveRustAuthoredBroadSourceValueTargetType(
            authoredTypeRoot,
            context,
            options.jsEnabled,
          );
    }
    const symbol = semantics.declarations.typeAliasSymbol(type) ??
      semantics.declarations.typeSymbol(type);
    const providerIdentity = resolveProviderTypeIdentity(
      semantics.facts.typeSubjects(type),
      context,
    );
    if (providerIdentity !== undefined) {
      const base = providerCarrierFromRelations(providerIdentity, options);
      if (base !== undefined) {
        return instantiateTargetType(base, type, context, options, resolving);
      }
    }

    const sourceProfileType = resolveOwnedSourceProfileTypeName(symbol, context, options.sourceProfiles);
    if (sourceProfileType !== undefined) {
      const sourceProfileCarrier = resolveSourceProfileCarrier(sourceProfileType, type, context, options, resolving);
      if (sourceProfileCarrier !== undefined) {
        return sourceProfileCarrier;
      }
    }

    const sourceTypeArguments = context.currentSemantics.types.effectiveTypeArguments(type);
    const resolvedSourceTypeArguments = sourceTypeArguments?.map((argument) =>
      resolveRustTargetType(argument, context, options, resolving));
    const sourceType = resolvedSourceTypeArguments === undefined ||
        resolvedSourceTypeArguments.some((argument) => argument === undefined)
      ? undefined
      : resolveProjectSourceCarrier(
          symbol,
          {
            values: Object.freeze((resolvedSourceTypeArguments as readonly TargetTypeRef[])
              .map((argument) => Object.freeze({ kind: "type" as const, type: argument }))),
          },
          context,
          options,
          undefined,
          type,
          resolving,
        );
    if (sourceType !== undefined) {
      return sourceType;
    }

    const typeParameter = resolveSourceTypeParameter(symbol, undefined, context);
    if (typeParameter !== undefined) {
      return typeParameter;
    }

    const callable = resolveCallableType(type, context, options, resolving);
    if (callable !== undefined) {
      return callable;
    }

    if (semantics.types.isNullish(type)) {
      return resolveRustExactNullishValueCarrier(type, semantics);
    }
    if (semantics.types.isStringLike(type)) {
      return rustStringTargetType();
    }
    if (semantics.types.isBooleanLike(type)) {
      return rustSourcePrimitiveTargetType("bool");
    }
    if (semantics.types.isNumberLike(type)) {
      return rustSourcePrimitiveTargetType("float64");
    }
    if (semantics.types.isBigIntLike(type)) {
      return rustBigIntTargetType();
    }
    if (options.jsEnabled && semantics.types.isSymbolLike(type)) {
      return rustJsSymbolTargetType();
    }
    if (semantics.types.isVoidLike(type)) {
      return rustUnitTargetType();
    }
    if (semantics.types.isUnion(type)) {
      return resolveUnion(type, context, options, resolving);
    }
    if (semantics.types.isTuple(type)) {
      const elements = semantics.types.tupleElementInfos(type)
        .map((element) =>
          resolveRustTupleElementTargetTypeWithState(
            element,
            semantics,
            context,
            options,
            resolving,
            authoredTypeRoot,
          )
        );
      return elements.length > 0 && elements.every((element) => element !== undefined)
        ? rustTupleTargetType(elements as TargetTypeRef[])
        : undefined;
    }

    if (semantics.types.isArrayLike(type) && semantics.types.isTypeReference(type)) {
      const [elementType] = semantics.types.typeArguments(type);
      const element = resolveRustTargetType(elementType, context, options, resolving);
      return element === undefined
        ? undefined
        : options.jsEnabled
          ? rustJsArrayTargetType(element)
          : rustVecTargetType(element);
    }
    return resolveStructuralObjectType(
      type,
      context,
      options,
      resolving,
      authoredTypeRoot,
    );
  } finally {
    resolving.delete(type);
  }
}

export function resolveRustExactNullishValueCarrier(
  type: Type,
  queries: SourceFileSemantics,
): TargetTypeRef | undefined {
  if (!queries.types.isNullish(type)) {
    return undefined;
  }
  const nonNullishType = queries.types.withoutMissingOrUndefined(type);
  return nonNullishType !== undefined && queries.types.isNever(nonNullishType)
    ? rustUndefinedTargetType()
    : rustNullTargetType();
}

export function resolveStructuralObjectType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredTypeRoot?: Node,
  valueStruct?: StructFact,
): TargetTypeRef | undefined {
  const selectedContext = bindRustSourceAliasArguments(type, context, options, resolving);
  if (selectedContext === undefined) return undefined;
  context = selectedContext;
  const semantics = context.currentSemantics;
  const struct = valueStruct ?? context.facts.resolve(type, structFactKey) ?? context.facts.get(type, structFactKey);
  if (struct !== undefined && (struct.valueType !== true || struct.fields === undefined)) return undefined;
  const representation = struct === undefined ? "reference" : "value";
  if (semantics.types.isSymbolLike(type)) return undefined;
  const declaredFields = struct === undefined ? undefined : new Map(struct.fields!.map(field => [field.name, field]));
  if (declaredFields !== undefined && declaredFields.size !== struct!.fields!.length) return undefined;
  const constructSignatures = semantics.types.constructSignatures(type);
  const construction = constructSignatures.length === 0 ? undefined : resolveRustConstructType(type, context, options, resolving);
  if (semantics.types.callSignatures(type).length !== 0 ||
    constructSignatures.length !== 0 && (construction === undefined || representation !== "reference") ||
    semantics.types.indexInfos(type).length !== 0) {
    return undefined;
  }
  const bases: TargetTypeRef[] = [];
  if (semantics.types.isIntersection(type)) {
    for (const component of semantics.types.unionOrIntersectionTypes(type)) {
      const symbol = semantics.declarations.typeSymbol(component);
      const declarations = symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol);
      if (!declarations.some(declaration => context.ast.kindName(declaration) === "KindClassDeclaration" ||
        context.ast.kindName(declaration) === "KindClassExpression")) continue;
      const carrier = resolveRustTargetType(component, context, options, resolving);
      if (carrier === undefined || rustSourceTypeCarrierValue(carrier)?.shape !== "object") return undefined;
      if (!bases.some(base => rustTargetTypeRefEquals(base, carrier))) bases.push(carrier);
    }
  }
  const properties = denseDefined(semantics.types.propertyInfos(type))?.filter(property =>
    !isRustErasedNominalMember(semantics.declarations.symbolDeclarations(property.symbol), context.ast));
  if (properties === undefined) {
    return undefined;
  }
  if (properties.length === 0 && bases.length === 0 && representation === "reference" && construction === undefined) {
    if (semantics.types.couldContainTypeVariables(type)) return undefined;
    return semantics.declarations.typeSymbol(type) === undefined
      ? rustObjectIdentityTargetType()
      : rustEmptyObjectTargetType();
  }
  const selected = properties.map((property) => {
    const declaredField = declaredFields?.get(property.name);
    if (declaredFields !== undefined && (declaredField === undefined || property.optional)) return undefined;
    const declarations = denseDefined([...new Set([
      ...semantics.declarations.symbolDeclarations(property.symbol),
      ...property.rootSymbols.flatMap((symbol) =>
        semantics.declarations.symbolDeclarations(symbol)
      ),
    ])]);
    const projectDeclarations = declarations?.filter((declaration) =>
      (declaredField !== undefined || context.source.navigation.isProjectDeclaration(declaration)) &&
      isRustStructuralObjectFieldDeclaration(declaration, context.ast));
    const hasExactTransformedIdentity = authoredTypeRoot !== undefined &&
      declarations !== undefined && projectDeclarations?.length === 0 &&
      declarations.every(declaration => {
        const identity = resolveProviderTypeIdentity([declaration], context);
        return identity !== undefined && providerCarrierFromRelations(identity, options) !== undefined;
      });
    if (projectDeclarations === undefined ||
      (!hasExactTransformedIdentity && projectDeclarations.length === 0) ||
      (!hasExactTransformedIdentity && projectDeclarations.length !== declarations?.length)) {
      return undefined;
    }
    const getters = projectDeclarations?.filter((declaration) =>
      context.ast.kindName(declaration) === "KindGetAccessor") ?? [];
    const setters = projectDeclarations?.filter((declaration) =>
      context.ast.kindName(declaration) === "KindSetAccessor") ?? [];
    const methods = projectDeclarations?.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      return kind === "KindMethodDeclaration" || kind === "KindMethodSignature";
    }) ?? [];
    const ordinaryDeclarations = projectDeclarations?.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      return kind !== "KindGetAccessor" && kind !== "KindSetAccessor" &&
        kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature";
    }) ?? [];
    const propertyTypeNodes = [...new Set([
      ...(declaredField === undefined ? [] : [declaredField.type]),
      ...sourcePropertyTypeEvidenceNodes(context.ast, semantics, property),
      ...projectDeclarations.flatMap(declaration => {
        const node = context.ast.typeNode(declaration);
        return node !== undefined && resolveBoundSourceTypeParameter(node, context) !== undefined ? [node] : [];
      }),
    ])];
    const authoredTypeNodes = propertyTypeNodes.length !== 0 || authoredTypeRoot === undefined
      ? propertyTypeNodes
      : sourceTransformedTypeFactEvidenceNodes(context.ast, semantics, authoredTypeRoot, property.type);
    const authoredCarriers = authoredTypeNodes.map((node) =>
      resolveRustTypeComponentEvidence({
        authoredTypeNode: node,
        selectedType: property.type,
      }, context, options, resolving));
    const authoredCarrier = authoredCarriers.length > 0 &&
        authoredCarriers.every((carrier) =>
          carrier !== undefined && rustTargetTypeRefEquals(carrier, authoredCarriers[0]))
      ? authoredCarriers[0]
      : undefined;
    const selectedFieldCarrier = authoredTypeNodes.length === 0
      ? resolveRustTargetType(property.type, context, options, resolving)
      : authoredCarrier;
    const fieldCarrier = selectedFieldCarrier === undefined
      ? undefined
      : property.optional && rustOptionElementCarrier(selectedFieldCarrier) === undefined
        ? rustOptionTargetType(selectedFieldCarrier)
        : selectedFieldCarrier;
    const accessor = getters.length === 1 && setters.length <= 1 &&
        ordinaryDeclarations.length === 0 && methods.length === 0
      ? { getter: true as const, setter: setters.length === 1 }
      : undefined;
    const method = methods.length === 1 && getters.length === 0 &&
        setters.length === 0 && ordinaryDeclarations.length === 0
      ? true as const
      : undefined;
    if (representation === "value" && (getters.length !== 0 || setters.length !== 0 || methods.length !== 0)) return undefined;
    return fieldCarrier === undefined
        || getters.length > 1 || setters.length > 1 ||
        getters.length === 0 && setters.length > 0 ||
        getters.length > 0 && (ordinaryDeclarations.length > 0 || methods.length > 0) ||
        methods.length > 1 || methods.length > 0 && ordinaryDeclarations.length > 0
      ? undefined
      : {
          declarations: Object.freeze(projectDeclarations),
          symbols: Object.freeze([...new Set([
            property.symbol,
            ...property.rootSymbols,
          ])]),
          sourceName: property.name,
          sourceType: property.type,
          resultCarrier: fieldCarrier,
          presence: property.optional ? "optional" as const : "required" as const,
          readonly: declaredField?.readonly === true || property.readonly,
          ...(context.memoryBindings.hasBoundField([property.symbol, ...property.rootSymbols, ...projectDeclarations])
            ? { bound: true as const } : {}),
          ...(accessor === undefined ? {} : { accessor }),
          ...(method === undefined ? {} : { method }),
        };
  });
  if (selected.some((field) => field === undefined) || declaredFields !== undefined && properties.length !== declaredFields.size) {
    return undefined;
  }
  const fields = [...(selected as readonly {
    readonly declarations: readonly Node[];
    readonly symbols: readonly Symbol[];
    readonly sourceName: string;
    readonly sourceType: Type;
    readonly resultCarrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
    readonly bound?: true;
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[])]
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName))
    .map((field, storageIndex) => ({ ...field, storageIndex }));
  if (new Set(fields.map((field) => field.sourceName)).size !== fields.length) {
    return undefined;
  }
  const ownerNodes = authoredTypeRoot !== undefined
    ? [authoredTypeRoot]
    : [...fields.flatMap((field) => field.declarations),
      ...(construction === undefined ? [] : [construction.declaration])];
  const ownerFileNames = new Set(ownerNodes.map((node) => context.ast.getFileName(context.ast.getSourceFile(node))));
  if (ownerFileNames.size !== 1) {
    return undefined;
  }
  const ownerFileName = [...ownerFileNames][0]!;
  const carrier = rustStructuralObjectTargetType(ownerFileName, fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.resultCarrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.bound === true ? { bound: true as const } : {}),
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
  })), representation, construction?.carrier, bases);
  return options.sourceTypes.registerStructuralObject({
    sourceType: type,
    carrier,
    storage: "structural-object",
    fields,
    ...(construction === undefined ? {} : { construction }),
  })
    ? carrier
    : undefined;
}
