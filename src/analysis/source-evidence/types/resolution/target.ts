import { rustBigIntTargetType, rustEmptyObjectTargetType, rustObjectIdentityTargetType, rustFixedArrayTargetType, rustJsArrayTargetType, rustJsSymbolTargetType, rustSourceLocationTargetType, rustAbsenceTargetType, rustNeverTargetType, rustOptionElementCarrier, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType, rustStructuralObjectCarrierValue, rustSourceUnionCarrierValue, rustSourceTypeCarrierValue, rustStringTargetType, rustUnitTargetType, rustVecTargetType, isRustNumericCarrier } from "../../../../target-model/types/index.js";
import { rustTupleTargetType } from "../../../../policy/types/collections/tuple-carrier.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { rustSourceStorageComponentContext } from "./source-storage-projection.js";
import { bindRustSourceAliasArguments, resolveRustSelectedTypeArguments } from "./generic-arguments.js";
import { instantiateTargetType, resolveSourceProfileCarrier } from "./providers.js";
import { providerCarrierFromRelations } from "../../../../policy/types/project/provider-instantiation.js";
import { resolveOwnedSourceProfileTypeName } from "../../../../policy/identities/source-types.js";
import { resolveProviderTypeIdentity } from "../../../../policy/identities/provider-types.js";
import { isRustStructuralObjectFieldDeclaration, isRustErasedNominalMember } from "../../../../policy/types/objects/source-shapes.js";
import { resolveBoundSourceTypeParameter, resolveCallableType, resolveSourcePrimitive, resolveSourceTypeParameter, resolveUnion } from "./callables.js";
import { resolveRustAuthoredTargetType, resolveRustTupleElementTargetTypeWithState } from "./tuples.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { sourcePropertyTypeEvidenceNodes, sourceTransformedTypeFactEvidenceNodes, ObjectLiteralProperty_Value, sourceTypeIsAuthoredEmptyObject, sourceNodeIdentity } from "@tsonic/target-api/source";
import { structFactKey } from "@tsonic/tsts";
import type { Node, StructFact, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustRawPointerTargetType } from "../../../../target-model/types/carriers/callables.js";
import { isRustSourceRawPointer } from "../../../../source/extension/raw-pointers.js";
import { resolveRustAuthoredBroadSourceValueTargetType } from "./broad-values.js";
import { rustBroadSourceValueTargetType } from "../../../../policy/types/resolution/broad-values.js";
import { selectTsonicFixedArrayFromSource } from "@tsonic/source-core/facts";
import type { TsonicFixedArrayFact } from "@tsonic/source-core/facts";
import { resolveRustSemanticConditionalAlias } from "./type-families.js";
import { resolveRustTypeComponentEvidence } from "./source-evidence.js";
import { resolveRustJsStringCarrier, resolveRustSourceMarker } from "./markers.js";
import { resolveRustIndexedField } from "./indexed-fields.js";
import { resolveRustConstructType } from "./constructors.js";
import { resolveRustIndexedRecordType } from "./records.js";
import { rustSourcePropertyTargetType } from "../../../../target-model/types/projections.js";
import type { RustSourceObjectField } from "../../../../target-model/records/types/source-types.js";

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
  const jsString = resolveRustJsStringCarrier(type, context);
  if (jsString !== undefined) return jsString;
  if (context.currentSemantics.types.isNonPrimitive(type)) return rustBroadSourceValueTargetType(options.jsEnabled);
  if (resolving.has(type)) {
    const symbol = context.currentSemantics.declarations.typeAliasSymbol(type);
    if (symbol === undefined || !context.currentSemantics.declarations.symbolDeclarations(symbol).some(declaration => {
      const carrier = options.sourceTypes.carrierForDeclaration(declaration);
      return rustSourceUnionCarrierValue(rustOptionElementCarrier(carrier) ?? carrier) !== undefined;
    })) return undefined;
    const arguments_ = resolveRustSelectedTypeArguments(type, context, options, resolving);
    return arguments_ === undefined ? undefined : resolveProjectSourceCarrier(symbol,
      {values: arguments_.map(argument => ({kind: "type" as const, type: argument}))}, context, options,
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
    (context.currentSemantics.types.aliasApplication(type)?.bindings.length ?? 0) === 0 &&
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
    if (authoredTypeRoot === undefined) {
      const transformation = semantics.types.standardTransformation(undefined, type);
      if (transformation !== undefined) return transformation.kind === "component"
        ? resolveRustTypeComponentEvidence(transformation.component, context, options, resolving)
        : undefined;
    }
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

    const resolvedSourceTypeArguments = resolveRustSelectedTypeArguments(type, context, options, resolving);
    const sourceType = resolvedSourceTypeArguments === undefined
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
        .map((element, index) =>
          resolveRustTupleElementTargetTypeWithState(
            element,
            semantics,
            rustSourceStorageComponentContext(context, { kind: "tuple-element", index }),
            options,
            resolving,
            authoredTypeRoot,
          )
        );
      return elements.every((element) => element !== undefined)
        ? rustTupleTargetType(elements as TargetTypeRef[])
        : undefined;
    }

    if (semantics.types.isArrayLike(type) && semantics.types.isTypeReference(type)) {
      const [elementType] = semantics.types.typeArguments(type);
      const element = resolveRustTargetType(elementType,
        rustSourceStorageComponentContext(context, { kind: "array-element" }), options, resolving);
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
  return rustAbsenceTargetType();
}

export function resolveStructuralObjectType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredTypeRoot?: Node,
  valueStruct?: StructFact,
): TargetTypeRef | undefined {
  const selectedContext = bindRustSourceAliasArguments(type, context, options, resolving, authoredTypeRoot);
  if (selectedContext === undefined) return undefined;
  context = selectedContext;
  const semantics = context.currentSemantics;
  const symbol = semantics.declarations.typeSymbol(type);
  const declarations = symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol);
  if (declarations.some(declaration => context.source.navigation.isProjectDeclaration(declaration) &&
    (context.ast.is.IsClassDeclaration(declaration) || context.ast.is.IsClassExpression(declaration)) &&
    options.sourceTypes.carrierForDeclaration(declaration) === undefined)) return undefined;
  const struct = valueStruct ?? context.source.sourceFacts.getFact(type, structFactKey);
  if (struct !== undefined && (struct.valueType !== true || struct.fields === undefined)) return undefined;
  const representation = struct === undefined ? "reference" : "value";
  if (semantics.types.indexInfos(type).length !== 0) {
    return struct === undefined ? resolveRustIndexedRecordType(type, context, options, resolving, authoredTypeRoot) : undefined;
  }
  if (semantics.types.isSymbolLike(type)) return undefined;
  const declaredFields = struct === undefined ? undefined : new Map(struct.fields!.map(field => [field.name, field]));
  if (declaredFields !== undefined && declaredFields.size !== struct!.fields!.length) return undefined;
  const constructSignatures = semantics.types.constructSignatures(type);
  const construction = constructSignatures.length === 0 ? undefined : resolveRustConstructType(type, context, options, resolving);
  if (semantics.types.callSignatures(type).length !== 0 ||
    constructSignatures.length !== 0 && (construction === undefined || representation !== "reference")) {
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
    if (semantics.types.couldContainTypeVariables(type) &&
      !sourceTypeIsAuthoredEmptyObject(type, context.ast, semantics, context.source.navigation)) return undefined;
    return semantics.declarations.typeSymbol(type) === undefined
      ? rustObjectIdentityTargetType()
      : rustEmptyObjectTargetType();
  }
  if (declaredFields !== undefined && properties.length !== declaredFields.size) return undefined;
  const selected: (Omit<RustSourceObjectField, "storageIndex"> & { readonly bound?: true })[] = [];
  for (const property of properties) {
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
    const sourceNames = projectDeclarations.map(declaration => {
      const name = context.ast.name(declaration);
      if (name === undefined || !context.ast.is.IsComputedPropertyName(name) && !context.ast.is.IsNumericLiteral(name)) return property.name;
      const selectedName = context.semanticsFor(declaration).propertyNames.get(name);
      return selectedName?.kind === "resolved" ? selectedName.name
        : selectedName?.kind === "well-known-symbol" ? property.name : undefined;
    });
    const sourceName = sourceNames.length === 0 ? property.name : sourceNames[0];
    if (sourceName === undefined || !sourceNames.every(name => name === sourceName)) return undefined;
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
      ...[...ordinaryDeclarations, ...getters].flatMap(declaration => {
        const node = context.ast.typeNode(declaration);
        return node !== undefined && resolveBoundSourceTypeParameter(node, context) !== undefined ? [node] : [];
      }),
    ])];
    const authoredTypeNodes = propertyTypeNodes.length !== 0 || authoredTypeRoot === undefined
      ? propertyTypeNodes
      : sourceTransformedTypeFactEvidenceNodes(context.ast, semantics, authoredTypeRoot, property.type);
    const memberContexts = ordinaryDeclarations.length === 0 ? [context] : ordinaryDeclarations.map(declaration =>
      rustSourceStorageComponentContext(context, { kind: "member", declaration }));
    const authoredCarriers = memberContexts.flatMap(memberContext => authoredTypeNodes.map((node) =>
      resolveRustTypeComponentEvidence({
        authoredTypeNode: node,
        selectedType: property.type,
      }, memberContext, options, resolving)));
    const authoredCarrier = authoredCarriers.length > 0 &&
        authoredCarriers.every((carrier) =>
          carrier !== undefined && rustTargetTypeRefEquals(carrier, authoredCarriers[0]))
      ? authoredCarriers[0]
      : undefined;
    const initializerCarriers = authoredTypeNodes.length === 0 &&
      (semantics.types.isNumberLike(property.type) || semantics.types.isBigIntLike(property.type))
      ? ordinaryDeclarations.map(declaration => {
          const kind = context.ast.kindName(declaration);
          const value = kind === "KindPropertyAssignment" || kind === "KindShorthandPropertyAssignment"
            ? ObjectLiteralProperty_Value(context.ast, declaration) : undefined;
          return value === undefined ? undefined : context.records.runtimeCarrier.get(value)?.carrier;
        })
      : [];
    const inferredCarrier = initializerCarriers.length > 0 && initializerCarriers.every(carrier =>
      isRustNumericCarrier(carrier) && rustTargetTypeRefEquals(carrier, initializerCarriers[0]))
      ? initializerCarriers[0] : undefined;
    const inferredCarriers = authoredTypeNodes.length === 0 && inferredCarrier === undefined
      ? memberContexts.map(memberContext => resolveRustTargetType(property.type, memberContext, options, resolving,
          memberContext.sourceStorageResolution?.kind === "resolved"
            ? memberContext.sourceStorageResolution.subject?.node : undefined)) : [];
    const selectedFieldCarrier = authoredTypeNodes.length === 0
      ? inferredCarrier ?? (inferredCarriers.length > 0 && inferredCarriers.every(carrier =>
        carrier !== undefined && rustTargetTypeRefEquals(carrier, inferredCarriers[0])) ? inferredCarriers[0] : undefined)
      : authoredCarrier;
    const fieldCarrier = selectedFieldCarrier === undefined
      ? undefined
      : rustSourcePropertyTargetType(selectedFieldCarrier, property.optional);
    const accessor = getters.length === 1 && setters.length <= 1 &&
        ordinaryDeclarations.length === 0 && methods.length === 0
      ? { getter: true as const, setter: setters.length === 1 }
      : undefined;
    const method = methods.length === 1 && getters.length === 0 &&
        setters.length === 0 && ordinaryDeclarations.length === 0
      ? true as const
      : undefined;
    if (representation === "value" && (getters.length !== 0 || setters.length !== 0 || methods.length !== 0)) return undefined;
    if (fieldCarrier === undefined
        || getters.length > 1 || setters.length > 1 ||
        getters.length === 0 && setters.length > 0 ||
        getters.length > 0 && (ordinaryDeclarations.length > 0 || methods.length > 0) ||
        methods.length > 1 || methods.length > 0 && ordinaryDeclarations.length > 0) return undefined;
    selected.push({
          declarations: Object.freeze(projectDeclarations),
          symbols: Object.freeze([...new Set([
            property.symbol,
            ...property.rootSymbols,
          ])]),
          sourceName,
          sourceType: property.type,
          resultCarrier: fieldCarrier,
          presence: property.optional ? "optional" as const : "required" as const,
          readonly: declaredField?.readonly === true || property.readonly,
          ...(context.memoryBindings.hasBoundField([property.symbol, ...property.rootSymbols, ...projectDeclarations])
            ? { bound: true as const } : {}),
          ...(accessor === undefined ? {} : { accessor }),
          ...(method === undefined ? {} : { method }),
        });
  }
  const fields = selected
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName))
    .map((field, storageIndex) => ({ ...field, storageIndex }));
  if (new Set(fields.map((field) => field.sourceName)).size !== fields.length) {
    return undefined;
  }
  const selectedAlias = semantics.types.aliasApplication(type)?.declaration;
  const aliasDeclaration = selectedAlias !== undefined && context.source.navigation.isProjectDeclaration(selectedAlias)
    ? selectedAlias : undefined;
  const ownerNodes = aliasDeclaration !== undefined ? [aliasDeclaration] : authoredTypeRoot !== undefined
    ? [authoredTypeRoot]
    : [...fields.flatMap((field) => field.declarations),
      ...(construction === undefined ? [] : [construction.declaration])];
  const ownerFileNames = new Set(ownerNodes.map((node) => context.ast.getFileName(context.ast.getSourceFile(node))));
  if (ownerFileNames.size !== 1) {
    return undefined;
  }
  const ownerFileName = [...ownerFileNames][0]!;
  const methodImplementations = fields.flatMap(field => {
    if (field.method !== true) return [];
    const declarations = field.declarations.filter(declaration => context.ast.body(declaration) !== undefined);
    if (declarations.length !== 1) return [];
    const identity = sourceNodeIdentity(context.ast, declarations[0]);
    return identity === undefined ? [] : [{ sourceName: field.sourceName, identity, genericArguments: Object.freeze([]) }];
  });
  const carrier = rustStructuralObjectTargetType(ownerFileName, fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.resultCarrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.bound === true ? { bound: true as const } : {}),
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
  })), representation, construction?.carrier, bases, methodImplementations.length === 0 ? undefined
    : { kind: "source", methods: methodImplementations });
  return options.sourceTypes.registerStructuralObject({
    sourceType: type,
    ...(aliasDeclaration === undefined ? {} : { sourceAlias: aliasDeclaration }),
    carrier,
    storage: "structural-object",
    fields,
    ...(construction === undefined ? {} : { construction }),
  }, { kind: "root" })
    ? carrier
    : undefined;
}
