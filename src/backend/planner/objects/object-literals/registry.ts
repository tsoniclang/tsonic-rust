import { projectCallableShape, projectLifetimeSubstitutions, projectTypeSubstitutions, rustProjectMethodPropertyCallableType } from "../polymorphism/model.js";
import { allocateMemberFieldName, planContractImplementation } from "./contracts.js";
import { allocateRustSyntheticTypeName } from "../../names/synthetic.js";
import { rustProjectObjectIdentityField, rustProjectObjectStateField } from "../project-objects.js";
import { rustProjectObjectIdentityImplementation } from "../project-identity.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustItem, RustStructField, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { Node } from "@tsonic/tsts";
import type { RustObjectLiteralAccessorImplementationPlan, RustObjectLiteralImplementationPlan, RustObjectLiteralMethodDispatchPlan, RustObjectLiteralMethodImplementationPlan, RustObjectLiteralMethodOverridePlan } from "./model.js";
import type { RustProjectLiteralEmission } from "../../../../target-model/records/objects/object-literal-emission.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustSyntheticNameState } from "../../names/synthetic.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function createImplementationPlan(
  expression: Node, selected: RustProjectLiteralEmission, context: RustPlanContext, names: RustSyntheticNameState,
): RustObjectLiteralImplementationPlan {
  const wrapperType = rustTypeFromCarrierInContext(selected.carrier, context);
  if (wrapperType === undefined) failRustPlannerInvariant("An admitted native literal requires its exact interface wrapper type.", expression);
  const rootName = allocateRustSyntheticTypeName(names, `${selected.definition.targetName}ObjectLiteralRoot`);
  const stateName = allocateRustSyntheticTypeName(names, `${selected.definition.targetName}ObjectLiteralState`);
  const stateFieldNames = new Set<string>();
  const methodFieldNames = new Set<string>();
  const stateFields = selected.fields.map(field => {
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted native literal field requires its exact storage type.", field.declaration);
    return { implementationDeclaration: field.declaration, contractDeclarations: field.contracts,
      storageIndex: field.storageIndex, targetName: allocateMemberFieldName(stateFieldNames, field.preferredName), type };
  });
  const accessors: RustObjectLiteralAccessorImplementationPlan[] = selected.accessors.map(accessor => {
    const valueType = rustTypeFromCarrierInContext(accessor.carrier, context);
    const errorType = rustTypeFromCarrierInContext(accessor.error, context);
    if (valueType === undefined || errorType === undefined)
      failRustPlannerInvariant("An admitted literal accessor requires its exact value and error types.", expression);
    const result = (type: RustType): RustType => ({ kind: "named", path: "Result", genericArguments: [
      { kind: "type", type }, { kind: "type", type: errorType },
    ] });
    const callable = (parameters: readonly RustType[], output: RustType): RustType => ({ kind: "named", path: "rt::Callable", genericArguments: [
      { kind: "lifetime", lifetime: { kind: "static" } }, { kind: "type", type: { kind: "tuple", elements: parameters } },
      { kind: "type", type: result(output) },
    ] });
    return { storageIndex: accessor.storageIndex, contractDeclarations: accessor.contracts,
      getter: { fieldName: allocateMemberFieldName(methodFieldNames, "property_getter"), callableType: callable([wrapperType], valueType) },
      ...(accessor.setter ? { setter: { fieldName: allocateMemberFieldName(methodFieldNames, "property_setter"),
        callableType: callable([wrapperType, valueType], { kind: "unit" }) } } : {}) };
  });
  const implementations: RustObjectLiteralMethodImplementationPlan[] = selected.implementations.map(implementation => {
    const errorType = implementation.error === undefined ? undefined : rustTypeFromCarrierInContext(implementation.error, context);
    if (implementation.error !== undefined && errorType === undefined)
      failRustPlannerInvariant("An admitted literal method requires its exact native implementation error type.", implementation.propertyIdentity);
    const fieldName = allocateMemberFieldName(methodFieldNames, "method_implementation");
    if (implementation.kind === "spread") {
      const callableType = rustTypeFromCarrierInContext(implementation.carrier, context);
      if (callableType === undefined || errorType === undefined)
        failRustPlannerInvariant("An admitted spread method requires its exact native callable type.", implementation.contractMethod);
      return { kind: "spread", propertyIdentity: implementation.propertyIdentity, contractMethod: implementation.contractMethod,
        fieldName, callableType, parameterCount: implementation.parameterCount, errorType };
    }
    const parameters = implementation.parameters.map(carrier => {
      const type = rustTypeFromCarrierInContext(carrier, context);
      if (type === undefined) failRustPlannerInvariant("An admitted literal method requires its exact native parameter type.", implementation.sourceCallable);
      return type;
    });
    const resultType = rustTypeFromCarrierInContext(implementation.result, context);
    if (resultType === undefined) failRustPlannerInvariant("An admitted literal method requires its exact native result type.", implementation.sourceCallable);
    const result: RustType = errorType === undefined ? resultType : { kind: "named", path: "Result", genericArguments: [
      { kind: "type", type: resultType }, { kind: "type", type: errorType },
    ] };
    return { kind: "authored", propertyIdentity: implementation.propertyIdentity, sourceCallable: implementation.sourceCallable,
      fieldName, callableType: { kind: "named", path: "rt::Callable", genericArguments: [
        { kind: "lifetime", lifetime: { kind: "static" } },
        { kind: "type", type: { kind: "tuple", elements: [wrapperType, ...parameters] } }, { kind: "type", type: result },
      ] }, parameterCount: parameters.length, typeParameterSubstitutions: implementation.substitutions,
      ...(errorType === undefined ? {} : { errorType }) };
  });
  const shapes = selected.methods.map(method => {
    const shape = projectCallableShape(method.contractMethod, { ...context,
      typeParameterSubstitutions: projectTypeSubstitutions(method.owner, method.ownerCarrier, context),
      lifetimeSubstitutions: projectLifetimeSubstitutions(method.owner, method.ownerCarrier, context),
    }, { methodTypeArgumentSubstitutions: new Map(method.variant.sourceTypeParameterIdentities
      .map((identity, index) => [identity, method.variant.targetTypeArguments[index]!] as const)) });
    if (shape === undefined) failRustPlannerInvariant("An admitted literal method requires its exact native contract shape.", method.contractMethod);
    return shape;
  });
  const methodOverrides: RustObjectLiteralMethodOverridePlan[] = selected.overrides.map(index => {
    const method = selected.methods[index];
    const shape = shapes[index];
    const implementation = method === undefined ? undefined : implementations[method.implementationIndex];
    if (shape === undefined || implementation === undefined)
      failRustPlannerInvariant("An admitted writable literal method requires its exact physical callable storage.", expression);
    return { propertyIdentity: implementation.propertyIdentity, fieldName: allocateMemberFieldName(stateFieldNames, "method_override"),
      callableType: rustProjectMethodPropertyCallableType(shape), parameters: shape.params,
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }) };
  });
  const methods: RustObjectLiteralMethodDispatchPlan[] = selected.methods.map((method, index) => {
    const implementation = implementations[method.implementationIndex];
    const shape = shapes[index];
    const override = method.overrideIndex === undefined ? undefined : methodOverrides[method.overrideIndex];
    if (implementation === undefined || shape === undefined || method.overrideIndex !== undefined && override === undefined)
      failRustPlannerInvariant("An admitted literal method requires its exact native implementation and override storage.", method.contractMethod);
    return { contractMethod: method.contractMethod, variant: method.variant, implementation, parameters: shape.params,
      ...(method.adapter === undefined ? {} : { adapter: { parameterAbis: method.adapter.parameters,
        parameterAdapters: method.adapter.parameterAdapters, resultAdapter: method.adapter.resultAdapter } }),
      ...(override === undefined ? {} : { override }),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }), isUnsafe: shape.isUnsafe };
  });
  const rootType: RustType = { kind: "named", path: rootName };
  const stateType: RustType = { kind: "named", path: stateName };
  const traitItems = selected.contracts.map(contract => {
    const item = planContractImplementation(contract, rootType, wrapperType, selected.contracts, stateFields, accessors, methods, context);
    if (item === undefined) failRustPlannerInvariant("An admitted native literal requires its exact contract implementation.", expression);
    return item;
  });
  const implementationsItems: RustItem[] = [rustProjectObjectIdentityImplementation(rootType, emptyRustGenerics, {
    kind: "reference", expr: { kind: "field", receiver: { kind: "path", path: "self" }, name: rustProjectObjectIdentityField },
  }), ...traitItems];
  context.usedAliases?.add("rt");
  const stateItem: RustItem = { kind: "struct", name: stateName, visibility: "private", generics: emptyRustGenerics, fields: [
    ...stateFields.map((field): RustStructField => ({ name: field.targetName, type: field.type, visibility: "private" })),
    ...methodOverrides.map((override): RustStructField => ({ name: override.fieldName,
      type: { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: override.callableType }] }, visibility: "private" })),
  ] };
  const rootItem: RustItem = { kind: "struct", name: rootName, visibility: "private", generics: emptyRustGenerics, fields: [
    { name: rustProjectObjectIdentityField, type: { kind: "named", path: "rt::ObjectIdentity" }, visibility: "private" },
    { name: rustProjectObjectStateField, type: { kind: "named", path: "rt::ObjectHandle", genericArguments: [{ kind: "type", type: stateType }] },
      visibility: "private", ...(selected.stateUsed ? {} : { deadCode: "generated-unused-storage" }) },
    ...implementations.map((implementation): RustStructField => ({ name: implementation.fieldName, type: implementation.callableType, visibility: "private" })),
    ...accessors.flatMap((accessor): RustStructField[] => [
      { name: accessor.getter.fieldName, type: accessor.getter.callableType, visibility: "private" },
      ...(accessor.setter === undefined ? [] : [{ name: accessor.setter.fieldName, type: accessor.setter.callableType, visibility: "private" as const }]),
    ]),
  ] };
  return Object.freeze({ kind: "project", expression, resultCarrier: selected.carrier, wrapperType, rootName, stateName,
    stateFields: Object.freeze(stateFields), accessors: Object.freeze(accessors), implementations: Object.freeze(implementations),
    methodOverrides: Object.freeze(methodOverrides), methods: Object.freeze(methods), items: Object.freeze([stateItem, rootItem, ...implementationsItems]) });
}
