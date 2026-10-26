import { rustHiddenAttribute } from "../../../target-ast/syntax/attributes.js";
import { planRustAuthoredStructScope } from "../../declarations/scoped-types.js";
import type { Node } from "@tsonic/tsts";
import type { RustItem, RustStructField, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustDefaultImplementation } from "../../declarations/default-implementation.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
  readRustProjectDispatchedField,
} from "../project-objects.js";
import { planProjectClassConstructor } from "./construction.js";
import { planProjectDispatchTrait, projectIdentityImplementations } from "./traits.js";
import { planProjectRootImplementations } from "./roots.js";
import {
  projectClassStateLayers,
  projectStateType,
  rustRcType,
} from "./model.js";
import { planProjectStaticMethods } from "../../declarations/index.js";
import {
  rustProjectDispatchObjectType,
  rustProjectRootName,
  rustProjectRootType,
  rustProjectRepresentationGenerics,
  rustProjectStateMarker,
  rustProjectStateType,
} from "./names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import {
  rustProjectImplementationVisibility,
  rustProjectMemberStorageVisibility,
} from "../project-storage-abi.js";
import { planProjectPrivateStateAccessors } from "./private-fields.js";
import { rustClassEnvironmentHandleType } from "../class-environment-types.js";
import { rustProjectTypeParameterContext } from "../../names/type-parameters.js";
import { planRustProjectErrorWrapper } from "./project-errors.js";
import { planRustStateConstruction } from "./state-construction.js";

export function planPolymorphicClassDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const selected = context.input.program.records.projectPolymorphicEmission.get(declaration);
  if (selected === undefined || selected.definition.kind !== "class")
    failRustPlannerInvariant("An admitted polymorphic class requires its sealed native declaration.", declaration);
  const { definition, carrier: openCarrier, representation } = selected;
  context = rustProjectTypeParameterContext(definition, context, "declaration");
  const wrapperType = rustTypeFromCarrierInContext(openCarrier, context);
  const dispatchObjectType = rustProjectDispatchObjectType(openCarrier, context);
  const rootType = rustProjectRootType(openCarrier, context);
  const layers = projectClassStateLayers(definition, openCarrier, context);
  const stateType = layers === undefined ? undefined : projectStateType(layers, context);
  if (wrapperType === undefined || dispatchObjectType === undefined || rootType === undefined || layers === undefined || stateType === undefined)
    failRustPlannerInvariant("An admitted polymorphic class requires exact native wrapper, dispatch, root and state syntax.", declaration);
  const trait = planProjectDispatchTrait(definition, openCarrier, context);
  if (trait === undefined) failRustPlannerInvariant("An admitted polymorphic class requires its exact native dispatch trait.", declaration);
  const implementationContext = rustProjectTypeParameterContext(definition,
    { ...context, nativeHeaderPlacement: definition.declaration, nativeHeaderParent: undefined }, "implementation");
  const implementationType = rustTypeFromCarrierInContext(openCarrier, implementationContext);
  const implementationRoot = rustProjectRootType(openCarrier, implementationContext);
  const implementationLayers = projectClassStateLayers(definition, openCarrier, implementationContext);
  if (implementationType === undefined || implementationRoot === undefined || implementationLayers === undefined)
    failRustPlannerInvariant("An admitted polymorphic class requires its exact native implementation context.", declaration);
  const implementationGenerics = rustProjectRepresentationGenerics(representation, implementationContext);
  const constructor = planProjectClassConstructor(definition, implementationType, implementationRoot, implementationLayers, implementationContext);
  if (constructor === undefined) failRustPlannerInvariant("An admitted polymorphic class requires its exact native constructor.", declaration);
  const rootImplementations = constructor.construct === undefined ? [] : planProjectRootImplementations(
    definition, openCarrier, implementationRoot, implementationLayers, implementationContext);
  if (rootImplementations === undefined) failRustPlannerInvariant("An admitted polymorphic class requires its exact native root implementation.", declaration);
  context.usedAliases?.add("rt");
  const generics = rustProjectRepresentationGenerics(representation, context);
  const stateMarker = rustProjectStateMarker(definition, context);
  const publiclyReachable = selected.publiclyReachable;
  const ownLayer = layers[layers.length - 1]!;
  const privateStateAccessors = planProjectPrivateStateAccessors(
    stateType,
    ownLayer,
    publiclyReachable,
    context,
  );
  if (privateStateAccessors === undefined) failRustPlannerInvariant("An admitted polymorphic class requires its exact private native state accessors.", declaration);
  const baseLayer = layers[layers.length - 2];
  const baseStateType = baseLayer === undefined
    ? undefined
    : rustProjectStateType(baseLayer.carrier, context);
  if (baseLayer !== undefined && baseStateType === undefined) failRustPlannerInvariant("An admitted polymorphic class requires its exact native base-state type.", declaration);
  const staticMethods = planProjectStaticMethods(definition, implementationContext);
  const externalErrorImplementations = planProjectExternalErrorImplementations(
    definition,
    wrapperType,
    representation,
    context,
  );
  const errorObservations = planRustProjectErrorWrapper(definition, implementationType, implementationContext);
  if (staticMethods === undefined || externalErrorImplementations === undefined || errorObservations === undefined)
    failRustPlannerInvariant("An admitted polymorphic class requires its native static and error implementations.", declaration);
  const implementationVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const wrapperVisibility = selected.visibility;
  const wrapperDeadCode = selected.wrapperDeadCode;
  const defaultImplementation = constructor.construct === undefined ? undefined : rustDefaultImplementation(
    implementationType,
    implementationGenerics,
    context.input.program.records.classDeclaration.get(declaration)?.defaultConstructor,
  );
  const environment = selected.environment;
  const environmentType = environment === undefined ? undefined : rustClassEnvironmentHandleType(environment.carrier, context);
  if (environment !== undefined && environmentType === undefined)
    failRustPlannerInvariant("An admitted native instance environment requires its exact handle type.", declaration);
  const rootStateDeadCode = selected.rootStateDeadCode;
  const implementationBase = implementationLayers[implementationLayers.length - 2];
  const implementationBaseState = implementationBase === undefined ? undefined
    : rustProjectStateType(implementationBase.carrier, implementationContext);
  if (implementationBase !== undefined && implementationBaseState === undefined) failRustPlannerInvariant("An admitted native implementation requires its exact base-state type.", declaration);
  const stateConstruction = planRustStateConstruction(implementationLayers[implementationLayers.length - 1]!,
    implementationBaseState, implementationContext);
  if (stateConstruction === undefined) failRustPlannerInvariant("An admitted native state requires its exact aggregate construction.", declaration);
  const identityImplementations = projectIdentityImplementations(definition, wrapperType, representation, context);
  const stateConstructionSelection = context.input.program.records.projectStateConstruction.get(definition);
  if (stateConstructionSelection === undefined) failRustPlannerInvariant("An admitted native state requires its exact physical base slot.", declaration);
  return [
    trait,
    stateConstruction,
    {
      kind: "struct",
      name: definition.stateName,
      visibility: implementationVisibility,
      ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
      generics,
      fields: [
        ...(baseStateType === undefined
          ? []
          : [{
              name: stateConstructionSelection.baseName,
              type: baseStateType,
              visibility: implementationVisibility,
              ...(() => {
                const attrs = publiclyReachable ? [rustHiddenAttribute] : [];
                const deadCode = selected.baseStateDeadCode;
                return {
                  ...(attrs.length === 0 ? {} : { attrs }),
                  ...(deadCode === undefined ? {} : { deadCode }),
                };
              })(),
            }]),
        ...ownLayer.fields.map((field): RustStructField => {
          const visibility = rustProjectMemberStorageVisibility(
            context.input.program.records,
            field.declaration,
            publiclyReachable,
          );
          return {
            name: field.targetName,
            type: field.storageType,
            visibility,
          };
        }),
        ...ownLayer.methodProperties.map((property) => ({
            name: property.targetName,
            type: {
              kind: "named" as const,
              path: "Option",
              genericArguments: [{ kind: "type" as const, type: property.callableType }],
            },
            visibility: implementationVisibility,
            ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
          })),
        ...(stateMarker === undefined
          ? []
          : [{
              name: stateMarker.name,
              type: stateMarker.type,
              visibility: implementationVisibility,
              ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
            }]),
      ],
    },
    ...privateStateAccessors,
    planRustAuthoredStructScope(declaration, {
      kind: "struct",
      name: definition.targetName,
      visibility: wrapperVisibility,
      ...(selected.programError ? { attrs: [rustHiddenAttribute] } : {}),
      ...(wrapperDeadCode === undefined ? {} : { deadCode: wrapperDeadCode }),
      generics,
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType(dispatchObjectType),
          visibility: implementationVisibility,
          ...(() => {
            const attrs = publiclyReachable ? [rustHiddenAttribute] : [];
            return {
              ...(attrs.length === 0 ? {} : { attrs }),
            };
          })(),
        },
      ],
    }, context),
    ...identityImplementations,
    ...(constructor.construct === undefined ? [] : [{
      kind: "struct" as const,
      name: rustProjectRootName(definition),
      visibility: "crate",
      generics,
      fields: [
        ...(environment === undefined || environmentType === undefined ? [] : [{
          name: environment.instanceFieldName, type: environmentType, visibility: "private" as const,
        }]),
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: "private",
        },
        {
          name: rustProjectObjectStateField,
          type: {
            kind: "named",
            path: "rt::ObjectState",
            genericArguments: [{ kind: "type" as const, type: stateType }],
          },
          visibility: "private",
          ...(() => {
            return rootStateDeadCode === undefined
              ? {}
              : { deadCode: rootStateDeadCode };
          })(),
        },
      ],
    } satisfies RustItem]),
    {
      kind: "impl",
      generics: implementationGenerics,
      target: implementationType,
      members: [...(constructor.construct === undefined ? [] : [constructor.construct]), ...staticMethods],
    },
    ...(defaultImplementation === undefined ? [] : [defaultImplementation]),
    ...rootImplementations,
    ...externalErrorImplementations,
    ...errorObservations,
  ];
}

function planProjectExternalErrorImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  representation: import("../../../../target-model/records/object-representation.js").RustObjectRepresentation,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const external = context.input.program.records.projectError.get(definition);
  if (external === undefined) failRustPlannerInvariant("An admitted native class requires its exact external error classification.", definition.declaration);
  if (!external.inherited) return [];
  const name = external.fields.find(field => field.name === "name");
  const message = external.fields.find(field => field.name === "message");
  const stack = external.fields.find(field => field.name === "stack");
  const nameRead = name?.read;
  const messageRead = message?.read;
  const stackWrite = stack?.write;
  if (nameRead === undefined || messageRead === undefined || stackWrite === undefined)
    failRustPlannerInvariant("An admitted native error requires its exact name, message and stack slots.", definition.declaration);
  const self = { kind: "path" as const, path: "self" };
  const errorName = readRustProjectDispatchedField(self, nameRead);
  const errorMessage = readRustProjectDispatchedField(self, messageRead);
  if (errorName === undefined || errorMessage === undefined) failRustPlannerInvariant("An admitted native error requires its exact field read syntax.", definition.declaration);
  return [{
    kind: "impl",
    generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "rt::ErrorStack" },
    target: wrapperType,
    members: [{ kind: "function",
      name: "set_stack", visibility: "private", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [{ name: "stack", type: { kind: "named", path: "Option", genericArguments: [
        { kind: "type", type: { kind: "string" } },
      ] } }],
      body: { statements: [{ kind: "expr", expr: {
        kind: "method-call", receiver: { kind: "field", receiver: self, name: rustProjectObjectDispatchField },
        method: stackWrite, args: [{ kind: "path", path: "stack" }],
      } }] },
    }],
  }, {
    kind: "impl",
    generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "core::fmt::Display" },
    target: wrapperType,
    members: [{ kind: "function",
      name: "fmt",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "core::fmt::Formatter",
            genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
          },
        },
      }],
      returnType: { kind: "named", path: "core::fmt::Result" },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "format-write",
            writer: { kind: "path", path: "formatter" },
            format: "{}: {}",
            args: [errorName, errorMessage],
          },
        }],
      },
    }],
  }, {
    kind: "impl",
    generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "rt::ToSourceString" },
    target: wrapperType,
    members: [{ kind: "function",
      name: "to_source_string",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [],
      returnType: { kind: "string" },
      body: {
        statements: [{
          kind: "tail",
          expr: { kind: "method-call", receiver: self, method: "to_string", args: [] },
        }],
      },
    }],
  }];
}

export function planPolymorphicInterfaceDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const selected = context.input.program.records.projectPolymorphicEmission.get(declaration);
  if (selected === undefined || selected.definition.kind !== "interface")
    failRustPlannerInvariant("An admitted polymorphic interface requires its exact sealed native declaration.", declaration);
  const { definition, carrier, representation, publiclyReachable } = selected;
  context = rustProjectTypeParameterContext(definition, context, "declaration");
  const wrapperType = rustTypeFromCarrierInContext(carrier, context);
  const dispatchObjectType = rustProjectDispatchObjectType(carrier, context);
  const trait = planProjectDispatchTrait(definition, carrier, context);
  if (wrapperType === undefined || dispatchObjectType === undefined || trait === undefined)
    failRustPlannerInvariant("An admitted polymorphic interface requires its exact native wrapper and dispatch syntax.", declaration);
  context.usedAliases?.add("rt");
  const generics = rustProjectRepresentationGenerics(representation, context);
  const implementationVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const wrapperVisibility = selected.visibility;
  const wrapperDeadCode = selected.wrapperDeadCode;
  const identityImplementations = projectIdentityImplementations(definition, wrapperType, representation, context);
  return [
    trait,
    {
      kind: "struct",
      name: definition.targetName,
      visibility: wrapperVisibility,
      ...(wrapperDeadCode === undefined ? {} : { deadCode: wrapperDeadCode }),
      generics,
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType(dispatchObjectType),
          visibility: implementationVisibility,
          ...(() => {
            const attrs = publiclyReachable ? [rustHiddenAttribute] : [];
            return {
              ...(attrs.length === 0 ? {} : { attrs }),
            };
          })(),
        },
      ],
    },
    ...identityImplementations,
  ];
}
