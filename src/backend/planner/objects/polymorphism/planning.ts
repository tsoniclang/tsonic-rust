import type { Node } from "@tsonic/tsts";
import type { RustItem, RustType } from "../../../rust-ast/nodes.js";
import { rustLintAttributes } from "../../../rust-ast/lint-policy.js";
import { rustDefaultImplementation } from "../../declarations/default-implementation.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import {
  diagnosticInput,
  rustProjectTypeHasPublicImplementationAbi,
} from "../../program/plan-context.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
  readRustProjectDispatchedField,
} from "../project-objects.js";
import { planProjectClassConstructor } from "./construction.js";
import {
  planProjectDispatchTrait,
  planProjectRootImplementations,
  projectIdentityImplementations,
} from "./dispatch.js";
import {
  projectClassStateLayers,
  projectStateType,
  rustRcType,
} from "./model.js";
import { planProjectStaticMethods } from "../../declarations/nominal.js";
import {
  rustProjectDispatchTraitType,
  rustProjectRootName,
  rustProjectRootType,
  rustProjectStateMarker,
  rustProjectStateType,
  rustProjectTypeParameters,
} from "./names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import {
  rustProjectImplementationVisibility,
  rustProjectMemberStorageVisibility,
} from "../project-storage-abi.js";
import { planProjectPrivateStateAccessors } from "./private-fields.js";

export function planPolymorphicClassDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const definition = context.input.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class" || !context.input.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const diagnosticCountBeforeShape = context.diagnostics.length;
  const openCarrier = context.input.projectTypes.openCarrier(definition);
  const wrapperType = rustTypeFromCarrierInContext(openCarrier, context);
  const dispatchType = rustProjectDispatchTraitType(openCarrier, context);
  const rootType = rustProjectRootType(openCarrier, context);
  const layers = projectClassStateLayers(definition, openCarrier, context);
  const stateType = layers === undefined ? undefined : projectStateType(layers, context);
  if (wrapperType === undefined || dispatchType === undefined || rootType === undefined ||
    layers === undefined || stateType === undefined) {
    if (context.diagnostics.length === diagnosticCountBeforeShape) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.project-polymorphism-carrier",
        "Polymorphic project class has no exact wrapper, dispatch, root, or state carrier.",
      ));
    }
    return undefined;
  }
  const diagnosticCountBeforeTrait = context.diagnostics.length;
  const trait = planProjectDispatchTrait(definition, openCarrier, context);
  if (trait === undefined) {
    if (context.diagnostics.length === diagnosticCountBeforeTrait) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.project-polymorphism-dispatch",
        "Polymorphic project class has no complete exact dispatch-trait plan.",
      ));
    }
    return undefined;
  }
  const diagnosticCountBeforeConstructor = context.diagnostics.length;
  const constructor = planProjectClassConstructor(definition, wrapperType, rootType, layers, context);
  if (constructor === undefined) {
    if (context.diagnostics.length === diagnosticCountBeforeConstructor) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.project-polymorphism-construction",
        "Polymorphic project class has no complete exact construction plan.",
      ));
    }
    return undefined;
  }
  const diagnosticCountBeforeRootImplementations = context.diagnostics.length;
  const rootImplementations = planProjectRootImplementations(
    definition,
    openCarrier,
    rootType,
    layers,
    context,
  );
  if (rootImplementations === undefined) {
    if (context.diagnostics.length === diagnosticCountBeforeRootImplementations) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.project-polymorphism-root",
        "Polymorphic project class has no complete exact root implementation plan.",
      ));
    }
    return undefined;
  }
  context.usedAliases?.add("rt");
  const typeParams = rustProjectTypeParameters(definition);
  const stateMarker = rustProjectStateMarker(definition, context);
  const programErrorVariant = context.input.projectTypes.programErrorVariant(definition);
  const publiclyReachable = programErrorVariant !== undefined ||
    rustProjectTypeHasPublicImplementationAbi(context, definition.targetName);
  const exported = context.input.ast.hasModifierKind(declaration, "export");
  const ownLayer = layers[layers.length - 1]!;
  const privateStateAccessors = planProjectPrivateStateAccessors(
    stateType,
    ownLayer,
    publiclyReachable,
    context,
  );
  if (privateStateAccessors === undefined) {
    return undefined;
  }
  const baseLayer = layers[layers.length - 2];
  const baseStateType = baseLayer === undefined
    ? undefined
    : rustProjectStateType(baseLayer.carrier, context);
  if (baseLayer !== undefined && baseStateType === undefined) {
    return undefined;
  }
  const staticMethods = planProjectStaticMethods(definition, context);
  const externalErrorImplementations = planProjectExternalErrorImplementations(
    definition,
    wrapperType,
    context,
  );
  if (staticMethods === undefined || externalErrorImplementations === undefined) {
    return undefined;
  }
  const implementationVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const defaultImplementation = rustDefaultImplementation(
    wrapperType,
    typeParams,
    constructor.construct,
  );
  return [
    trait,
    {
      kind: "struct",
      name: definition.stateName,
      visibility: implementationVisibility,
      attrs: [
        ...(publiclyReachable ? ["#[doc(hidden)]"] : []),
        rustLintAttributes.deadCode,
      ],
      derives: [],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        ...(baseStateType === undefined
          ? []
          : [{
              name: context.input.projectTypes.baseStateFieldName(definition),
              type: baseStateType,
              visibility: implementationVisibility,
              ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
            }]),
        ...ownLayer.fields.map((field) => ({
          name: field.targetName,
          type: field.type,
          visibility: rustProjectMemberStorageVisibility(
            context.input.ast,
            field.declaration,
            publiclyReachable,
          ),
        })),
        ...ownLayer.methodProperties.map((property) => ({
          name: property.targetName,
          type: {
            kind: "named" as const,
            path: "Option",
            typeArguments: [property.callableType],
          },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        })),
        ...(stateMarker === undefined
          ? []
          : [{
              name: stateMarker.name,
              type: stateMarker.type,
              visibility: implementationVisibility,
              ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
            }]),
      ],
    },
    ...privateStateAccessors,
    {
      kind: "struct",
      name: definition.targetName,
      visibility: exported || publiclyReachable ? "public" : "crate",
      attrs: [
        rustLintAttributes.deadCode,
        ...(programErrorVariant === undefined
          ? []
          : ["#[doc(hidden)]"]),
      ],
      derives: ["Clone"],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType({ kind: "trait-object", trait: dispatchType }),
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        },
      ],
    },
    ...projectIdentityImplementations(definition, wrapperType),
    {
      kind: "struct",
      name: rustProjectRootName(definition),
      visibility: "crate",
      attrs: [rustLintAttributes.deadCode],
      derives: [],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: "private",
        },
        {
          name: rustProjectObjectStateField,
          type: {
            kind: "named",
            path: "rt::ObjectHandle",
            typeArguments: [stateType],
          },
          visibility: "private",
        },
      ],
    },
    {
      kind: "impl",
      ...(typeParams.length === 0 ? {} : { typeParams }),
      target: wrapperType,
      functions: [constructor.initialize, constructor.construct, ...staticMethods],
    },
    ...(defaultImplementation === undefined ? [] : [defaultImplementation]),
    ...rootImplementations,
    ...externalErrorImplementations,
  ];
}

function planProjectExternalErrorImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const external = context.input.projectTypes.externalBaseForDefinition(definition);
  if (external === undefined) {
    return [];
  }
  const name = external.fields.find((field) => field.sourceName === "name");
  const message = external.fields.find((field) => field.sourceName === "message");
  if (name === undefined || message === undefined) {
    return undefined;
  }
  const nameRead = context.input.projectTypes.memberSlotName(name.declaration, "read");
  const messageRead = context.input.projectTypes.memberSlotName(message.declaration, "read");
  if (nameRead === undefined || messageRead === undefined) {
    return undefined;
  }
  const self = { kind: "path" as const, path: "self" };
  return [{
    kind: "impl",
    trait: { kind: "named", path: "std::fmt::Display" },
    target: wrapperType,
    functions: [{
      name: "fmt",
      visibility: "private",
      selfParam: "ref",
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "std::fmt::Formatter",
            lifetimeArguments: ["_"],
          },
        },
      }],
      returnType: { kind: "named", path: "std::fmt::Result" },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "format-write",
            writer: { kind: "path", path: "formatter" },
            format: "{}: {}",
            args: [
              readRustProjectDispatchedField(self, nameRead),
              readRustProjectDispatchedField(self, messageRead),
            ],
          },
        }],
      },
    }],
  }, {
    kind: "impl",
    trait: { kind: "named", path: "rt::ToSourceString" },
    target: wrapperType,
    functions: [{
      name: "to_source_string",
      visibility: "private",
      selfParam: "ref",
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
  const definition = context.input.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "interface" || !context.input.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const carrier = context.input.projectTypes.openCarrier(definition);
  const wrapperType = rustTypeFromCarrierInContext(carrier, context);
  const dispatchType = rustProjectDispatchTraitType(carrier, context);
  const trait = planProjectDispatchTrait(definition, carrier, context);
  if (wrapperType === undefined || dispatchType === undefined || trait === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.project-interface-carrier",
      "Polymorphic project interface has no exact wrapper or dispatch carrier.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const typeParams = rustProjectTypeParameters(definition);
  const exported = context.input.ast.hasModifierKind(declaration, "export");
  const publiclyReachable = rustProjectTypeHasPublicImplementationAbi(
    context,
    definition.targetName,
  );
  const implementationVisibility = rustProjectImplementationVisibility(publiclyReachable);
  return [
    trait,
    {
      kind: "struct",
      name: definition.targetName,
      visibility: exported || publiclyReachable ? "public" : "crate",
      attrs: [rustLintAttributes.deadCode],
      derives: ["Clone"],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType({ kind: "trait-object", trait: dispatchType }),
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        },
      ],
    },
    ...projectIdentityImplementations(definition, wrapperType),
  ];
}
