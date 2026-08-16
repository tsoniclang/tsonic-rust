import type { Node } from "@tsonic/tsts";
import type { RustItem, RustType } from "../rust-ast/nodes.js";
import type { RustProjectTypeDefinition } from "../../source/rust-target-semantics/project-type-policy.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
  readRustProjectDispatchedField,
} from "./project-objects.js";
import { planProjectClassConstructor } from "./project-polymorphism-construction.js";
import {
  planProjectDispatchTrait,
  planProjectRootImplementations,
  projectIdentityImplementations,
} from "./project-polymorphism-dispatch.js";
import {
  planProjectStaticMethods,
  projectClassStateLayers,
  projectStateType,
  rustRcType,
} from "./project-polymorphism-model.js";
import {
  rustProjectDispatchTraitType,
  rustProjectRootName,
  rustProjectRootType,
  rustProjectStateMarker,
  rustProjectStateType,
  rustProjectTypeParameters,
} from "./project-polymorphism-names.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";

export function planPolymorphicClassDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const definition = context.input.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class" || !context.input.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const openCarrier = context.input.projectTypes.openCarrier(definition);
  const wrapperType = rustTypeFromCarrierInContext(openCarrier, context);
  const dispatchType = rustProjectDispatchTraitType(openCarrier, context);
  const rootType = rustProjectRootType(openCarrier, context);
  const layers = projectClassStateLayers(definition, openCarrier, context);
  const stateType = layers === undefined ? undefined : projectStateType(layers, context);
  if (wrapperType === undefined || dispatchType === undefined || rootType === undefined ||
    layers === undefined || stateType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.project-polymorphism-carrier",
      "Polymorphic project class has no exact wrapper, dispatch, root, or state carrier.",
    ));
    return undefined;
  }
  const trait = planProjectDispatchTrait(definition, openCarrier, context);
  const constructor = planProjectClassConstructor(definition, wrapperType, rootType, layers, context);
  const rootImplementations = planProjectRootImplementations(
    definition,
    openCarrier,
    rootType,
    layers,
    context,
  );
  if (trait === undefined || constructor === undefined || rootImplementations === undefined) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  const typeParams = rustProjectTypeParameters(definition);
  const stateMarker = rustProjectStateMarker(definition, context);
  const ownLayer = layers[layers.length - 1]!;
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
  return [
    trait,
    {
      kind: "struct",
      name: definition.stateName,
      visibility: "crate",
      attrs: ["#[allow(dead_code)]"],
      derives: [],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        ...(baseStateType === undefined
          ? []
          : [{
              name: context.input.projectTypes.baseStateFieldName(definition),
              type: baseStateType,
              visibility: "crate" as const,
            }]),
        ...ownLayer.fields.map((field) => ({
          name: field.targetName,
          type: field.type,
          visibility: "crate" as const,
        })),
        ...(stateMarker === undefined
          ? []
          : [{ name: stateMarker.name, type: stateMarker.type, visibility: "crate" as const }]),
      ],
    },
    {
      kind: "struct",
      name: definition.targetName,
      visibility: context.input.projectTypes.programErrorVariant(definition) !== undefined
        ? "public"
        : context.input.ast.hasModifierKind(declaration, "export") ? "public" : "crate",
      attrs: [
        "#[allow(dead_code)]",
        ...(context.input.projectTypes.programErrorVariant(definition) === undefined
          ? []
          : ["#[doc(hidden)]"]),
      ],
      derives: ["Clone"],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: "crate",
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType({ kind: "trait-object", trait: dispatchType }),
          visibility: "crate",
        },
      ],
    },
    ...projectIdentityImplementations(definition, wrapperType),
    {
      kind: "struct",
      name: rustProjectRootName(definition),
      visibility: "crate",
      attrs: ["#[allow(dead_code)]"],
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
  return [
    trait,
    {
      kind: "struct",
      name: definition.targetName,
      visibility: context.input.ast.hasModifierKind(declaration, "export") ? "public" : "crate",
      attrs: ["#[allow(dead_code)]"],
      derives: ["Clone"],
      ...(typeParams.length === 0 ? {} : { typeParams }),
      fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: "crate",
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType({ kind: "trait-object", trait: dispatchType }),
          visibility: "crate",
        },
      ],
    },
    ...projectIdentityImplementations(definition, wrapperType),
  ];
}
