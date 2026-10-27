import { rustDeriveAttributes, rustHiddenAttribute } from "../../../target-ast/syntax/attributes.js";
import { rustPackageFallibleBoundary, rustErrorType } from "../../program/fallible-boundaries.js";
import { planRustAuthoredStructScope } from "../scoped-types.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { createRustProjectObject, rustProjectObjectStateField, rustProjectObjectType } from "../../objects/project-objects.js";
import { rustErrorBoundaryForDeclaration } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planExpression } from "../../expressions/index.js";
import { planProjectMethod, planProjectMethodVariants } from "./methods.js";
import { planRustCallableParameterPrelude, planRustCallableParameters } from "../callables/parameters.js";
import { planStatementSequence } from "../../statements/index.js";
import { planRustConstructionBody } from "./construction-body.js";
import { applyRustTailShape } from "../../../target-ast/normalization/block-flow.js";
import { requireRustConstructorContract } from "./constructor-contracts.js";
import { projectOwnMethodProperties } from "../../objects/polymorphism/model.js";
import type { ProjectMethodPropertyPlan } from "../../objects/polymorphism/model.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../../safety/explicit-safety.js";
import { rustDefaultImplementation } from "../default-implementation.js";

import { rustProjectGenerics, rustProjectStateType, rustProjectStateMarker } from "../../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { structAttributes } from "../struct-attributes.js";
import type { RustType, RustImplFunction, RustItem, RustStmt, RustStructField } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { Node } from "@tsonic/tsts";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustObjectRepresentation } from "../../../../target-model/records/objects/object-representation.js";
import {
  rustProjectImplementationVisibility,
} from "../../objects/project-storage-abi.js";
import { rustProjectStateIdentityImplementation } from "../../objects/project-identity.js";
import { rustProjectTypeParameterContext } from "../../names/type-parameters.js";
import { rustProjectWrapperTraits } from "../../objects/project-wrapper-traits.js";
import { rustClassEnvironmentContext, rustClassEnvironmentParameter } from "../../objects/class-environments.js";
import { rustClassEnvironmentHandleType } from "../../objects/class-environment-types.js";
import { rustCapturedFieldType } from "../../objects/captured-fields.js";
import { rustFrameBindingType } from "../../bindings/frame-storage.js";
import { rustClassFrameLayout } from "../../objects/frame-storage.js";
import type { RustNativeClassEmission } from "../../../../target-model/records/objects/class-emission.js";
import type { RustDeadCodeDisposition } from "../../../../target-model/records/native/native-liveness.js";

export interface PlannedProjectObjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly storageType: RustType;
  readonly visibility: import("../../../target-ast/syntax/nodes.js").RustVisibility;
  readonly initializer?: Node;
  readonly deadCode?: RustDeadCodeDisposition;
}

export function carrierOf(context: RustPlanContext, node: Node | undefined) {
  return node === undefined ? undefined : context.input.program.records.runtimeCarrier.get(node)?.carrier;
}

export function planClassDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const selected = context.input.program.records.nativeClass.get(node);
  if (selected?.kind !== "ordinary") failRustPlannerInvariant("An admitted ordinary class requires its sealed native declaration plan.", node);
  const { definition, name: className, representation, publiclyReachable } = selected;
  const storageVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const structVisibility = selected.visibility;
  context = rustProjectTypeParameterContext(definition, context, "declaration");
  const openType = rustTypeFromCarrierInContext(selected.carrier, context);
  const stateType = representation.kind === "value" ? undefined : rustProjectStateType(selected.carrier, context);
  if (openType === undefined || representation.kind !== "value" && stateType === undefined)
    failRustPlannerInvariant("An admitted class requires its renderable native object and state carriers.", node);
  const generics = rustProjectGenerics(definition, context);
  const stateMarker = rustProjectStateMarker(definition, context);
  const fields = planClassFields(selected, context);
  const constructorMember = selected.constructor;
  const methods = selected.methods;
  const accessors = selected.accessors;
  const methodProperties = projectOwnMethodProperties(
    definition,
    selected.carrier,
    context,
  );
  if (methodProperties === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete field, method and constructor plan.", node);
  }
  const implementationContext = rustProjectTypeParameterContext(definition,
    { ...context, nativeHeaderPlacement: definition.declaration, nativeHeaderParent: undefined }, "implementation");
  const implementationType = rustTypeFromCarrierInContext(selected.carrier, implementationContext);
  const implementationGenerics = rustProjectGenerics(definition, implementationContext);
  const implementationFields = planClassFields(selected, implementationContext);
  if (implementationType === undefined || implementationFields.some(field => field.type === undefined || field.storageType === undefined)) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
  const constructorFn = planConstructor(
    node,
    constructorMember,
    definition.targetPath,
    implementationType,
    definition.stateName,
    rustProjectStateMarker(definition, implementationContext),
    implementationFields as readonly PlannedProjectObjectField[],
    methodProperties,
    representation,
    publiclyReachable,
    implementationContext,
  );
  if (constructorFn === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
  }
  const implFunctions: RustImplFunction[] = [constructorFn];
  for (const method of methods) {
    const planned = planProjectMethodVariants(method, implementationContext);
    if (planned === undefined) {
      failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
    }
    implFunctions.push(...planned);
  }
  for (const accessor of accessors) {
    const targetName = accessor.name;
    const planned = planProjectMethod(accessor.declaration, implementationContext, {
      targetName,
      safetyPlacement: accessor.role === "read" ? "getter" : "setter",
    });
    if (planned === undefined) {
      failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
    }
    implFunctions.push(planned);
  }

  if (representation.kind !== "value") {
    context.usedAliases?.add("rt");
  }
  const emission = context.input.program.records.classDeclaration.get(node);
  if (emission === undefined) failRustPlannerInvariant("An admitted class requires its native declaration emission metadata.", node);
  const generatedStructAttributes = structAttributes(emission.nonCamelCaseName) ?? [];
  const environment = selected.environment;
  const environmentType = !environment?.instancesUseEnvironment ? undefined : rustClassEnvironmentHandleType(environment.carrier, context);
  if (environment?.instancesUseEnvironment && environmentType === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
  const stateCarrier = stateType === undefined
    ? undefined
    : rustProjectObjectType(stateType, representation, environmentType);
  const frame = selected.frame;
  const frameLayout = frame === undefined ? undefined : rustClassFrameLayout(frame, context, storageVisibility);
  if (frame !== undefined && frameLayout === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
  const valueFields: readonly RustStructField[] = [
    ...(frameLayout?.fields ?? []),
    ...(representation.kind !== "value" || environment === undefined || environmentType === undefined ? [] : [{
      name: environment.instanceFieldName, type: environmentType, visibility: "private" as const,
    }]),
    ...fields.filter(field => frameLayout?.ownsField(field.declaration) !== true).map((field): RustStructField => {
      const deadCode = field.deadCode;
      return {
        name: field.targetName,
        type: field.storageType,
        visibility: field.visibility,
        ...(deadCode === undefined ? {} : { deadCode }),
      };
    }),
    ...methodProperties.map((property) => ({
        name: property.targetName,
        type: {
          kind: "named" as const,
          path: "Option",
          genericArguments: [{ kind: "type" as const, type: property.callableType }],
        },
        visibility: storageVisibility,
        ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
      })),
    ...(stateMarker === undefined
      ? []
      : [{
          name: stateMarker.name,
          type: stateMarker.type,
          visibility: storageVisibility,
          ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
        }]),
  ];
  if (representation.kind !== "value" && stateCarrier === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
  }
  const stateField: RustStructField | undefined = stateCarrier === undefined
    ? undefined
    : {
        name: rustProjectObjectStateField,
        type: stateCarrier,
        visibility: storageVisibility,
        ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
      };
  const stateItem: RustItem = {
    kind: "struct",
    name: definition.stateName,
    visibility: storageVisibility,
    ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
    generics,
    fields: valueFields,
  };
  const structFields = representation.kind === "value"
    ? valueFields
    : stateField === undefined
      ? undefined
      : [stateField];
  if (structFields === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", node);
  }
  const explicitWrapperTraits = selected.explicitWrapperTraits;
  const structItem: RustItem = {
    kind: "struct",
    name: className,
    visibility: structVisibility,
    attrs: [...generatedStructAttributes, ...rustDeriveAttributes(representation.kind === "value" ? ["Clone"] : explicitWrapperTraits ? [] : ["Clone", "Debug", "PartialEq"])],
    generics,
    fields: structFields,
  };
  const defaultImplementation = rustDefaultImplementation(implementationType, implementationGenerics, emission.defaultConstructor);
  const implementation: RustItem = {
    kind: "impl",
    generics: implementationGenerics,
    target: implementationType,
    members: implFunctions,
  };
  return [
    ...(representation.kind === "value" ? [] : [stateItem]),
    planRustAuthoredStructScope(node, structItem, context),
    ...(explicitWrapperTraits ? rustProjectWrapperTraits(openType, className, generics) : []),
    ...(representation.kind === "value"
      ? []
      : [rustProjectStateIdentityImplementation(openType, generics)]),
    implementation,
    ...(defaultImplementation === undefined ? [] : [defaultImplementation]),
  ];
}

function planConstructor(
  classDeclaration: Node,
  member: Node | undefined,
  className: string,
  classType: RustType,
  stateName: string,
  stateMarker: ReturnType<typeof rustProjectStateMarker>,
  fields: readonly PlannedProjectObjectField[],
  methodProperties: readonly ProjectMethodPropertyPlan[],
  representation: RustObjectRepresentation,
  publiclyReachable: boolean,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const { ast } = context.input.program.source;
  const selected = context.input.program.records.nativeClass.get(classDeclaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted constructor requires its native class emission.", classDeclaration);
  const isUnsafe = rustDeclarationRequiresUnsafe(
    classDeclaration,
    "constructor",
    context.input,
    member,
  );
  const safetyAttributes = rustSafetyAttributesForDeclaration(
    member ?? classDeclaration,
    isUnsafe,
    context.input,
  );
  const body = member === undefined ? undefined : ast.body(member);
  if (member !== undefined && body === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete field, method and constructor plan.", classDeclaration);
  }
  const syntheticNames = createRustSyntheticNameState(
    ast,
    member ?? classDeclaration,
    [],
  );
  const parameterPlan = planRustCallableParameters(requireRustConstructorContract(selected), context, syntheticNames, "source-body");
  if (parameterPlan === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
  }
  const selectedEnvironment = selected.environment;
  const environment = selectedEnvironment?.instancesUseEnvironment || selectedEnvironment?.initializationUsesEnvironment ? selectedEnvironment : undefined;
  const environmentParameter = environment === undefined ? undefined : rustClassEnvironmentParameter(environment, context, "owned");
  if (environment !== undefined && environmentParameter === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
  const params = [...(environmentParameter === undefined ? [] : [environmentParameter]), ...parameterPlan.params];
  const fallible = context.input.program.records.fallible.get(member ?? classDeclaration) !== undefined;
  const errorBoundary = fallible
    ? rustErrorBoundaryForDeclaration(member ?? classDeclaration, context)
    : undefined;
  if (fallible && errorBoundary === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete field, method and constructor plan.", classDeclaration);
  }
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const parameterContext: RustPlanContext = {
    ...(environment === undefined ? context : rustClassEnvironmentContext(environment,
      { kind: "path", path: environment.parameterName }, context)),
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: classType,
    functionAbsenceReturnCarrier: undefined,
    fallibleBoundary: errorBoundary === undefined ? undefined : rustPackageFallibleBoundary(errorBoundary),
    returnResult: errorBoundary === undefined ? undefined : { errorType: rustErrorType(errorBoundary) },
  };
  const parameterPrelude = planRustCallableParameterPrelude(
    parameterPlan,
    parameterContext,
    planExpression,
  );
  if (parameterPrelude === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
  }
  const constructorContext = parameterPrelude.context;
  const parameterStatements = parameterPrelude.statements;
  const definition = selected.definition;
  const constructionPlan = definition === undefined ? undefined
    : context.input.program.records.classConstruction.get(definition.declaration);
  if (definition === undefined || constructionPlan === undefined) {
    failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
  }
  const frame = selected.frame;
  const frameLayout = frame === undefined ? undefined : rustClassFrameLayout(frame, constructorContext,
    rustProjectImplementationVisibility(publiclyReachable));
  if (frame !== undefined && frameLayout === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
  const construction = planRustConstructionBody(constructionPlan, fields,
    classType,
    (values, identity, frameCounter, retainedFrame) => {
      return createRustProjectObject(className, stateName,
      fields.filter(field => frameLayout?.ownsField(field.declaration) !== true)
        .map(field => ({ name: field.targetName, value: values.get(field.declaration)! })).concat(
        frameCounter === undefined ? [] : frameLayout?.materialize(values, frameCounter, retainedFrame) ?? [],
        methodProperties.map(property => ({ name: property.targetName, value: { kind: "none" as const } })),
        stateMarker === undefined ? [] : [{ name: stateMarker.name, value: stateMarker.value }],
        representation.kind !== "value" || !environment?.instancesUseEnvironment ? [] : [{
          name: environment.instanceFieldName, value: { kind: "path" as const, path: environment.parameterName },
        }]),
      representation, !environment?.instancesUseEnvironment || representation.kind === "value"
        ? undefined : { kind: "path", path: environment.parameterName }, identity);
    },
    constructorContext);
  if (construction === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
  const returnLabel = !constructionPlan.earlyReturnLayers.has(definition) ? undefined
    : { id: constructorContext.controlFlow!.nextLoopId++,
      label: allocateRustSyntheticName(syntheticNames, "constructor_layer") };
  const rootLayer = constructionPlan.layers.find(layer => layer.definition === definition);
  if (rootLayer === undefined) failRustPlannerInvariant("An admitted constructor requires its identical native root layer.", classDeclaration);
  const layerContext = construction.contextForLayer(constructorContext, rootLayer, returnLabel);
  const statements: RustStmt[] = [...parameterStatements, ...construction.declarations];
  for (const field of constructionPlan.fields) {
    const slot = construction.values.get(field.declaration);
    if (slot === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
    if (field.initializer !== undefined) {
      const prepared = construction.prepare(field.initializer, layerContext);
      if (prepared === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
      const value = construction.input(field.declaration, field.initializer, prepared.context,
        () => planExpression(field.initializer!, prepared.context));
      if (value === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
      const initialization = construction.initialize(field.declaration, value);
      if (initialization === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
      statements.push(...prepared.before, ...prepared.finish(initialization));
    }
  }
  if (body !== undefined) {
    const bodyPlan = planStatementSequence(ast.statements(body), body, layerContext);
    if (bodyPlan === undefined) failRustPlannerInvariant("An admitted native class requires its complete syntax and native storage plan.", classDeclaration);
    statements.push(...returnLabel === undefined ? bodyPlan.statements
      : [{ kind: "scope" as const, label: returnLabel.label, body: { statements: bodyPlan.statements } }]);
  }
  statements.push(...construction.finish());
  const constructorDeadCode = selected.constructorDeadCode;
  const constructorAttributes = safetyAttributes;
  return { kind: "function",
    name: "new",
    ...(constructorDeadCode === undefined ? {} : { deadCode: constructorDeadCode }),
    generics: emptyRustGenerics,
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: selected.constructorVisibility,
    ...(constructorAttributes.length === 0 ? {} : { attrs: constructorAttributes }),
    ...(errorBoundary === undefined ? {} : { errorType: rustErrorType(errorBoundary) }),
    params,
    returnType: classType,
    body: applyRustTailShape({ statements }, true, new Set(params.map(parameter => parameter.name))),
  };
}

function planClassFields(selected: RustNativeClassEmission, context: RustPlanContext): readonly PlannedProjectObjectField[] {
  return Object.freeze(selected.fields.map(field => {
    const type = rustTypeFromCarrierInContext(field.carrier, context);
    const storageType = type === undefined ? undefined : field.frameBinding === undefined
      ? rustCapturedFieldType(field.capturedStorage, type) : rustFrameBindingType(field.frameBinding, context);
    if (type === undefined || storageType === undefined) failRustPlannerInvariant("An admitted class field requires its renderable native storage.", field.declaration);
    return { declaration: field.declaration, sourceName: field.sourceName, targetName: field.targetName,
      storageIndex: field.storageIndex, carrier: field.carrier, type, storageType, visibility: field.visibility,
      ...(field.initializer === undefined ? {} : { initializer: field.initializer }),
      ...(field.deadCode === undefined ? {} : { deadCode: field.deadCode }) };
  }));
}
