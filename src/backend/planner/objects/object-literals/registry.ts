import {
  projectCallableShape,
  projectLifetimeSubstitutions,
  projectOwnMethods,
  projectTypeSubstitutions,
  rustFunctionTypesMatch,
  rustProjectMethodPropertyCallableType,
} from "../polymorphism/model.js";
import { allocateMemberFieldName, planContractImplementation } from "./contracts.js";
import { allocateRustSyntheticTypeName } from "../../names/synthetic.js";
import { rustCallableProtocol, rustSourceTypeCarrierValue } from "../../../../target-model/types/index.js";
import { rustFallibleFactKey, rustObjectLiteralMethodAdapterFactKey } from "../../../../analysis/facts/keys.js";
import { rustProjectInterfaceContracts } from "../../../../analysis/project-types/type-policy.js";
import { rustProjectObjectIdentityField, rustProjectObjectStateField } from "../project-objects.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type {
  RustFunctionParam,
  RustItem,
  RustStructField,
  RustType,
} from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import type { Node } from "@tsonic/tsts";
import type { RustObjectLiteralAccessorImplementationPlan, RustObjectLiteralImplementationPlan, RustObjectLiteralMethodDispatchPlan, RustObjectLiteralMethodImplementationPlan, RustObjectLiteralMethodOverridePlan, RustRecordLiteralFact } from "./model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustErrorBoundaryForDeclaration,
  rustErrorType,
} from "../../program/plan-context.js";
import {
  rustGeneratedExactStorageDeadCodeDisposition,
} from "../../liveness/directives.js";
import { rustPlannedImplementationsReferenceSelfField } from "../../liveness/planned-item-usage.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import type { RustSyntheticNameState } from "../../names/synthetic.js";

export function createImplementationPlan(
  expression: Node,
  fact: RustRecordLiteralFact,
  context: RustPlanContext,
  names: RustSyntheticNameState,
): RustObjectLiteralImplementationPlan | undefined {
  const definition = context.input.program.projectTypes.definitionForCarrier(fact.resultCarrier);
  const sourceValue = rustSourceTypeCarrierValue(fact.resultCarrier);
  const wrapperType = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  if (definition?.kind !== "interface" || sourceValue === undefined || wrapperType === undefined) {
    return undefined;
  }
  const contracts = rustProjectInterfaceContracts(
    context.input.program.projectTypes,
    definition,
    fact.resultCarrier,
  );
  if (contracts === undefined) {
    return undefined;
  }
  const adapterFact = context.input.program.facts.getFact(
    expression,
    rustObjectLiteralMethodAdapterFactKey,
  );
  const hasAuthoredMethods = fact.contributions.some((contribution) =>
    contribution.kind === "method");
  if (hasAuthoredMethods && adapterFact === undefined) {
    return undefined;
  }
  const rootName = allocateRustSyntheticTypeName(names, `${definition.targetName}ObjectLiteralRoot`);
  const stateName = allocateRustSyntheticTypeName(names, `${definition.targetName}ObjectLiteralState`);
  const stateFieldNames = new Set<string>();
  const accessorRoles = new Map<number, Set<"get" | "set">>();
  for (const contribution of fact.contributions) {
    if (contribution.kind !== "accessor") {
      continue;
    }
    const roles = accessorRoles.get(contribution.targetStorageIndex) ?? new Set();
    roles.add(contribution.role);
    accessorRoles.set(contribution.targetStorageIndex, roles);
  }
  const stateFields = fact.fields.filter((field) =>
    accessorRoles.get(field.storageIndex)?.has("get") !== true).map((field) => {
    const declaration = field.implementationDeclaration;
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    const owner = context.input.program.projectTypes.definitionContainingDeclaration(declaration);
    const preferred = declaration === undefined || owner === undefined
      ? undefined
      : context.input.program.projectTypes.fieldStorageName(owner, declaration);
    const targetName = preferred === undefined
      ? undefined
      : allocateMemberFieldName(stateFieldNames, preferred);
    return declaration === undefined || type === undefined || targetName === undefined
      ? undefined
      : {
          implementationDeclaration: declaration,
          contractDeclarations: field.contractDeclarations,
          storageIndex: field.storageIndex,
          targetName,
          type,
        };
  });
  if (stateFields.some((field) => field === undefined)) {
    return undefined;
  }
  const methodFieldNames = new Set<string>();
  const accessors: RustObjectLiteralAccessorImplementationPlan[] = [];
  for (const field of fact.fields) {
    const roles = accessorRoles.get(field.storageIndex);
    if (roles === undefined) {
      continue;
    }
    const valueType = rustTypeFromCarrierInContext(field.carrier, context);
    const dispatch = context.input.program.projectFieldDispatch.planFor(
      field.contractDeclarations[0]!,
    );
    if (valueType === undefined || field.contractDeclarations.length === 0 ||
      !roles.has("get") || roles.has("set") !== !field.readonly ||
      dispatch === undefined || !dispatch.read.fallible ||
      (!field.readonly && dispatch.write?.fallible !== true)) {
      return undefined;
    }
    const errorBoundary = rustErrorBoundaryForDeclaration(
      field.contractDeclarations[0]!,
      context,
    );
    if (errorBoundary === undefined) {
      return undefined;
    }
    const errorType = rustErrorType(errorBoundary);
    const result = (type: RustType): RustType => ({
      kind: "named",
      path: "Result",
      genericArguments: [
        { kind: "type", type },
        { kind: "type", type: errorType },
      ],
    });
    accessors.push({
      storageIndex: field.storageIndex,
      contractDeclarations: field.contractDeclarations,
      getter: {
        fieldName: allocateMemberFieldName(methodFieldNames, "property_getter"),
        callableType: {
          kind: "named",
          path: "rt::Callable",
          genericArguments: [
            {
              kind: "type",
              type: { kind: "tuple", elements: [wrapperType] },
            },
            { kind: "type", type: result(valueType) },
          ],
        },
      },
      ...(roles.has("set")
        ? {
            setter: {
              fieldName: allocateMemberFieldName(methodFieldNames, "property_setter"),
              callableType: {
                kind: "named" as const,
                path: "rt::Callable",
                genericArguments: [
                  {
                    kind: "type" as const,
                    type: {
                      kind: "tuple" as const,
                      elements: [wrapperType, valueType],
                    },
                  },
                  { kind: "type" as const, type: result({ kind: "unit" }) },
                ],
              },
            },
          }
        : {}),
    });
  }
  const implementations: RustObjectLiteralMethodImplementationPlan[] = [];
  for (const implementation of adapterFact?.implementations ?? []) {
    const parameterTypes = implementation.parameters.map((parameter) =>
      rustTypeFromCarrierInContext(parameter.parameterCarrier, context));
    const resultType = rustTypeFromCarrierInContext(implementation.returnCarrier, context);
    if (parameterTypes.some((type) => type === undefined) || resultType === undefined) {
      return undefined;
    }
    const fallible = context.input.program.facts.getFact(
      implementation.sourceCallable,
      rustFallibleFactKey,
    ) !== undefined;
    const errorBoundary = fallible
      ? rustErrorBoundaryForDeclaration(implementation.sourceCallable, context)
      : undefined;
    if (fallible && errorBoundary === undefined) {
      return undefined;
    }
    const errorType = errorBoundary === undefined ? undefined : rustErrorType(errorBoundary);
    const callableResultType: RustType = fallible
      ? {
          kind: "named",
          path: "Result",
          genericArguments: [
            { kind: "type", type: resultType },
            { kind: "type", type: errorType! },
          ],
        }
      : resultType;
    implementations.push({
      kind: "authored",
      propertyIdentity: implementation.sourceCallable,
      sourceCallable: implementation.sourceCallable,
      fieldName: allocateMemberFieldName(methodFieldNames, "method_implementation"),
      callableType: {
        kind: "named",
        path: "rt::Callable",
        genericArguments: [
          {
            kind: "type",
            type: {
              kind: "tuple",
              elements: [wrapperType, ...(parameterTypes as RustType[])],
            },
          },
          { kind: "type", type: callableResultType },
        ],
      },
      parameterCount: implementation.parameters.length,
      typeParameterSubstitutions: implementation.typeParameterSubstitutions,
      ...(errorType === undefined ? {} : { errorType }),
    });
  }
  const finalContributions = new Map<Node, typeof fact.contributions[number]>();
  for (const contribution of fact.contributions) {
    if (contribution.kind === "method") {
      for (const declaration of contribution.contractDeclarations) {
        finalContributions.set(declaration, contribution);
      }
    } else if (contribution.kind === "spread") {
      for (const method of contribution.methods) {
        finalContributions.set(method.contractDeclaration, contribution);
      }
    }
  }
  const methods: RustObjectLiteralMethodDispatchPlan[] = [];
  const methodOverrides: RustObjectLiteralMethodOverridePlan[] = [];
  const methodOverrideByIdentity = new Map<Node, RustObjectLiteralMethodOverridePlan>();
  const methodOverrideFor = (
    contractMethod: Node,
    implementation: RustObjectLiteralMethodImplementationPlan,
    parameters: readonly RustFunctionParam[],
    returnType: RustType | undefined,
    errorType: RustType | undefined,
  ): RustObjectLiteralMethodOverridePlan | undefined | false => {
    const usage = context.input.program.projectMethodProperties.usageFor(contractMethod) ??
      context.input.program.projectMethodProperties.usageFor(implementation.propertyIdentity);
    if (usage?.writable !== true) {
      return undefined;
    }
    const existing = methodOverrideByIdentity.get(implementation.propertyIdentity);
    if (existing !== undefined) {
      return rustFunctionTypesMatch(
        existing.parameters,
        existing.returnType,
        parameters,
        returnType,
      ) && rustTypeEquals(
        existing.errorType,
        errorType,
      )
        ? existing
        : false;
    }
    const override: RustObjectLiteralMethodOverridePlan = {
      propertyIdentity: implementation.propertyIdentity,
      fieldName: allocateMemberFieldName(stateFieldNames, "method_override"),
      callableType: rustProjectMethodPropertyCallableType({
        params: parameters,
        ...(returnType === undefined ? {} : { returnType }),
        ...(errorType === undefined ? {} : { errorType }),
      }),
      parameters,
      ...(returnType === undefined ? {} : { returnType }),
      ...(errorType === undefined ? {} : { errorType }),
    };
    methodOverrideByIdentity.set(implementation.propertyIdentity, override);
    methodOverrides.push(override);
    return override;
  };
  for (const dispatch of adapterFact?.dispatches ?? []) {
    const owner = context.input.program.projectTypes.definitionContainingDeclaration(dispatch.contractMethod);
    const ownerRelation = owner === undefined
      ? undefined
      : context.input.program.projectTypes.relationship(fact.resultCarrier, owner);
    const variant = context.input.program.projectMethodDispatch
      .variantsForMember(dispatch.contractMethod)
      .find((candidate) => candidate.virtualSlot === dispatch.virtualSlot);
    const implementation = implementations[dispatch.implementationIndex];
    const finalContribution = finalContributions.get(dispatch.contractMethod);
    const selected = implementation?.kind === "authored" &&
      finalContribution?.kind === "method" &&
      finalContribution.expression === implementation.sourceCallable;
    if (!selected) {
      continue;
    }
    if (owner === undefined || ownerRelation?.kind !== "related" || variant === undefined) {
      return undefined;
    }
    const substitutions = new Map(projectTypeSubstitutions(owner, ownerRelation.targetType));
    variant.sourceTypeParameterNames.forEach((name, index) => {
      const target = variant.targetTypeArguments[index];
      if (target !== undefined) {
        substitutions.set(name, target);
      }
    });
    const shape = projectCallableShape(
      dispatch.contractMethod,
      {
        ...context,
        typeParameterSubstitutions: substitutions,
        lifetimeSubstitutions: projectLifetimeSubstitutions(
          owner,
          ownerRelation.targetType,
        ),
      },
      {
        methodTypeArgumentSubstitutions: new Map(
          variant.sourceTypeParameterNames.map((name, index) =>
            [name, variant.targetTypeArguments[index]!] as const),
        ),
      },
    );
    if (shape === undefined || shape.params.length !== dispatch.parameters.length ||
      dispatch.parameterAdapters.length !== implementation.parameterCount ||
      (implementation.errorType !== undefined || dispatch.adapterFallible) &&
        shape.errorType === undefined) {
      return undefined;
    }
    const override = methodOverrideFor(
      dispatch.contractMethod,
      implementation,
      shape.params,
      shape.returnType,
      shape.errorType,
    );
    if (override === false || override !== undefined &&
      (shape.errorType === undefined || shape.isUnsafe)) {
      return undefined;
    }
    const usedContractParameters = new Set(dispatch.parameterAdapters.flatMap((adapter) => {
      switch (adapter.kind) {
        case "runtime-value":
        case "logical-value":
        case "sequence-rest":
          return [adapter.contractParameterIndex];
        case "fixed-rest":
          return adapter.contractParameterIndexes;
        case "omitted":
          return [];
      }
    }));
    methods.push({
      contractMethod: dispatch.contractMethod,
      variant,
      implementation,
      parameters: shape.params.map((parameter, index) => usedContractParameters.has(index)
        ? parameter
        : { ...parameter, name: parameter.name.startsWith("_") ? parameter.name : `_${parameter.name}` }),
      adapter: {
        parameterAbis: dispatch.parameters,
        parameterAdapters: dispatch.parameterAdapters,
        resultAdapter: dispatch.resultAdapter,
      },
      ...(override === undefined ? {} : { override }),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
      isUnsafe: shape.isUnsafe,
    });
  }
  for (const [contractMethod, contribution] of finalContributions) {
    if (contribution.kind !== "spread") {
      continue;
    }
    const source = contribution.methods.find((method) =>
      method.contractDeclaration === contractMethod);
    const callable = source === undefined ? undefined : rustCallableProtocol(source.callableCarrier);
    const callableType = source === undefined
      ? undefined
      : rustTypeFromCarrierInContext(source.callableCarrier, context);
    const owner = context.input.program.projectTypes.definitionContainingDeclaration(contractMethod);
    const ownerRelation = owner === undefined
      ? undefined
      : context.input.program.projectTypes.relationship(fact.resultCarrier, owner);
    const variants = context.input.program.projectMethodDispatch.variantsForMember(contractMethod);
    const variant = variants.length === 1 ? variants[0] : undefined;
    const shape = owner === undefined || ownerRelation?.kind !== "related" || variant === undefined
      ? undefined
      : projectCallableShape(
          contractMethod,
          {
            ...context,
            typeParameterSubstitutions: projectTypeSubstitutions(
              owner,
              ownerRelation.targetType,
            ),
            lifetimeSubstitutions: projectLifetimeSubstitutions(
              owner,
              ownerRelation.targetType,
            ),
          },
          { methodTypeArgumentSubstitutions: new Map() },
        );
    if (source === undefined || callable === undefined || callableType === undefined ||
      variant === undefined || shape === undefined ||
      callable.parameters.length !== shape.params.length || shape.errorType === undefined ||
      shape.isUnsafe) {
      return undefined;
    }
    const sourceErrorBoundary = rustErrorBoundaryForDeclaration(
      source.sourceDeclaration,
      context,
    );
    if (sourceErrorBoundary === undefined) {
      return undefined;
    }
    const implementation: RustObjectLiteralMethodImplementationPlan = {
      kind: "spread",
      propertyIdentity: source.sourceDeclaration,
      contractMethod,
      fieldName: allocateMemberFieldName(methodFieldNames, "method_implementation"),
      callableType,
      parameterCount: callable.parameters.length,
      errorType: rustErrorType(sourceErrorBoundary),
    };
    const override = methodOverrideFor(
      contractMethod,
      implementation,
      shape.params,
      shape.returnType,
      shape.errorType,
    );
    if (override === false || override !== undefined &&
      (shape.errorType === undefined || shape.isUnsafe)) {
      return undefined;
    }
    implementations.push(implementation);
    methods.push({
      contractMethod,
      variant,
      implementation,
      parameters: shape.params,
      ...(override === undefined ? {} : { override }),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      errorType: shape.errorType,
      isUnsafe: false,
    });
  }
  const requiredMethods = contracts.flatMap((contract) =>
    projectOwnMethods(contract.definition, context)
      .filter((method) => !context.input.program.source.ast.hasModifierKind(method, "static"))
      .flatMap((method) => context.input.program.projectMethodDispatch.variantsForMember(method)
        .map((variant) => ({ method, variant }))));
  if (requiredMethods.some((required) => !methods.some((method) =>
    method.contractMethod === required.method &&
    method.variant.virtualSlot === required.variant.virtualSlot))) {
    return undefined;
  }
  const finalizedStateFields = stateFields as NonNullable<(typeof stateFields)[number]>[];
  const rootType: RustType = { kind: "named", path: rootName };
  const stateType: RustType = { kind: "named", path: stateName };
  const traitItems = contracts.map((contract) =>
    planContractImplementation(
      contract,
      rootType,
      wrapperType,
      finalizedStateFields,
      accessors,
      methods,
      context,
    ));
  if (traitItems.some((item) => item === undefined)) {
    return undefined;
  }
  const finalizedTraitItems = traitItems as RustItem[];
  const identityDeadCode = rustGeneratedExactStorageDeadCodeDisposition(
    rustPlannedImplementationsReferenceSelfField(
      finalizedTraitItems,
      rustProjectObjectIdentityField,
    ),
  );
  const stateDeadCode = rustGeneratedExactStorageDeadCodeDisposition(
    rustPlannedImplementationsReferenceSelfField(
      finalizedTraitItems,
      rustProjectObjectStateField,
    ),
  );
  context.usedAliases?.add("rt");
  const stateItem: RustItem = {
    kind: "struct",
    name: stateName,
    visibility: "private",
    derives: [],
    generics: emptyRustGenerics,
    fields: [
      ...finalizedStateFields.map((field): RustStructField => ({
        name: field.targetName,
        type: field.type,
        visibility: "private",
      })),
      ...methodOverrides.map((override): RustStructField => ({
        name: override.fieldName,
        type: {
          kind: "named",
          path: "Option",
          genericArguments: [{ kind: "type", type: override.callableType }],
        },
        visibility: "private",
      })),
    ],
  };
  const accessorFields = accessors.flatMap((accessor): RustStructField[] => [
    {
      name: accessor.getter.fieldName,
      type: accessor.getter.callableType,
      visibility: "private",
    },
    ...(accessor.setter === undefined
      ? []
      : [{
          name: accessor.setter.fieldName,
          type: accessor.setter.callableType,
          visibility: "private" as const,
        }]),
  ]);
  const rootItem: RustItem = {
    kind: "struct",
    name: rootName,
    visibility: "private",
    derives: [],
    generics: emptyRustGenerics,
    fields: [{
      name: rustProjectObjectIdentityField,
      type: { kind: "named", path: "rt::ObjectIdentity" },
      visibility: "private",
      ...(identityDeadCode === undefined ? {} : { deadCode: identityDeadCode }),
    }, {
      name: rustProjectObjectStateField,
      type: {
        kind: "named",
        path: "rt::ObjectHandle",
        genericArguments: [{ kind: "type", type: stateType }],
      },
      visibility: "private",
      ...(stateDeadCode === undefined ? {} : { deadCode: stateDeadCode }),
    }, ...implementations.map((implementation): RustStructField => ({
      name: implementation.fieldName,
      type: implementation.callableType,
      visibility: "private",
    })), ...accessorFields],
  };
  return Object.freeze({
    expression,
    resultCarrier: fact.resultCarrier,
    wrapperType,
    rootName,
    stateName,
    stateFields: Object.freeze(finalizedStateFields),
    accessors: Object.freeze(accessors),
    implementations: Object.freeze(implementations),
    methodOverrides: Object.freeze(methodOverrides),
    methods: Object.freeze(methods),
    items: Object.freeze([stateItem, rootItem, ...finalizedTraitItems]),
  });
}
