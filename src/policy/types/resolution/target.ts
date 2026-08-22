import {
  rustBigIntTargetType,
  rustJsArrayTargetType,
  rustNullTargetType,
  rustNullishSourceTargetType,
  rustNeverTargetType,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStructuralObjectTargetType,
  rustStringTargetType,
  rustTupleTargetType,
  rustUnitTargetType,
  rustUndefinedTargetType,
  rustVecTargetType,
} from "../../../target-model/types/index.js";
import { denseDefined, resolveProjectSourceCarrier } from "./project.js";
import { instantiateTargetType, providerCarrierFromRelations, resolveOwnedSourceProfileTypeName, resolveProviderTypeIdentity, resolveSourceProfileCarrier } from "./providers.js";
import { isRustStructuralObjectFieldDeclaration } from "../source-shapes.js";
import { resolveCallableType, resolveSourcePrimitive, resolveSourceTypeParameter, resolveUnion } from "./callables.js";
import { resolveRustAuthoredTargetType, resolveRustTupleElementTargetTypeWithState } from "./tuples.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  sourcePropertyTypeEvidenceNodes,
  sourceTransformedTypeFactEvidenceNodes,
} from "@tsonic/target-api/source";
import type { Node, Symbol, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveRustTargetType(
  type: Type | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredTypeRoot?: Node,
): TargetTypeRef | undefined {
  if (type === undefined || resolving.has(type)) {
    return undefined;
  }
  const existingStructuralObject = authoredTypeRoot === undefined
    ? options.sourceTypes.structuralObjectForType(type)
    : undefined;
  if (existingStructuralObject !== undefined) {
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
    if (semantics.types.isNever(type)) {
      return rustNeverTargetType();
    }
    if (semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
      return undefined;
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
          resolvedSourceTypeArguments as readonly TargetTypeRef[],
          context,
          options,
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
      return rustNullishSourceTargetType();
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
): TargetTypeRef | undefined {
  const semantics = context.currentSemantics;
  if (semantics.types.callSignatures(type).length !== 0 ||
    semantics.types.constructSignatures(type).length !== 0 ||
    semantics.types.indexInfos(type).length !== 0) {
    return undefined;
  }
  const properties = denseDefined(semantics.types.propertyInfos(type));
  if (properties === undefined || properties.length === 0) {
    return undefined;
  }
  const selected = properties.map((property) => {
    const declarations = denseDefined([...new Set([
      ...semantics.declarations.symbolDeclarations(property.symbol),
      ...property.rootSymbols.flatMap((symbol) =>
        semantics.declarations.symbolDeclarations(symbol)
      ),
    ])]);
    const projectDeclarations = declarations?.filter((declaration) =>
      context.source.navigation.isProjectDeclaration(declaration) &&
      isRustStructuralObjectFieldDeclaration(declaration, context.ast));
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
    const authoredTypeNodes = [
      ...sourcePropertyTypeEvidenceNodes(context.ast, semantics, property),
      ...(authoredTypeRoot === undefined
        ? []
        : sourceTransformedTypeFactEvidenceNodes(
            context.ast,
            semantics,
            authoredTypeRoot,
            property.type,
          )),
    ];
    const authoredCarriers = authoredTypeNodes.map((node) =>
      resolveRustAuthoredTargetType(node, context, options, resolving));
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
    const hasExactTransformedIdentity = authoredTypeRoot !== undefined &&
      projectDeclarations !== undefined && projectDeclarations.length === 0;
    return projectDeclarations === undefined ||
        (!hasExactTransformedIdentity && projectDeclarations.length === 0) ||
        (!hasExactTransformedIdentity && projectDeclarations.length !== declarations?.length) ||
        fieldCarrier === undefined
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
          readonly: property.readonly,
          ...(accessor === undefined ? {} : { accessor }),
          ...(method === undefined ? {} : { method }),
        };
  });
  if (selected.some((field) => field === undefined)) {
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
  const ownerFileNames = new Set([
    ...fields.flatMap((field) => field.declarations),
    ...(authoredTypeRoot === undefined ? [] : [authoredTypeRoot]),
  ].map((node) => context.ast.getFileName(context.ast.getSourceFile(node))));
  if (ownerFileNames.size !== 1) {
    return undefined;
  }
  const ownerFileName = [...ownerFileNames][0]!;
  const carrier = rustStructuralObjectTargetType(ownerFileName, fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.resultCarrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
  })));
  return options.sourceTypes.registerStructuralObject({
    sourceType: type,
    carrier,
    storage: "object-handle",
    fields,
  })
    ? carrier
    : undefined;
}
