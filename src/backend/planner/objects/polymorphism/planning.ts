import type { Node } from "@tsonic/tsts";
import { emptyRustAstGenerics, type RustItem, type RustType } from "../../../target-ast/nodes.js";
import { rustDocHiddenAttribute, rustDeriveAttribute } from "../../../target-ast/attributes.js";
import {
  rustReferenceReceiver,
  rustTypeGenericArguments,
} from "../../../target-ast/builders.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
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
  rustProjectGenerics,
} from "./names.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import {
  rustProjectImplementationVisibility,
  rustProjectMemberStorageVisibility,
} from "../project-storage-abi.js";
import { planProjectPrivateStateAccessors } from "./private-fields.js";
import {
  planRustExplicitTraitImplementations,
} from "../../declarations/explicit-contracts.js";
import { unsupportedConstructDiagnostic } from "../../diagnostics.js";

export function planPolymorphicClassDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "class" ||
    !context.input.program.objectRepresentations.requiresDynamicDispatch(definition)) {
    return undefined;
  }
  const declarationContract = context.input.program.declarationContracts.forDeclaration(declaration);
  if (declarationContract?.nativeUnion === true ||
    (declarationContract?.representations.length ?? 0) > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.polymorphic-layout",
      "Explicit native layout requires a direct value representation and cannot describe a polymorphic object wrapper.",
    ));
    return undefined;
  }
  if (context.input.program.source.ast.members(declaration).some((member) =>
    member !== undefined &&
    context.input.program.declarationContracts.forDeclaration(member)?.nativeDrop === true)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.polymorphic-drop",
      "Native Drop cannot be attached to a cloneable polymorphic wrapper because that would run cleanup once per alias rather than once for the owned source value.",
    ));
    return undefined;
  }
  const diagnosticCountBeforeShape = context.diagnostics.length;
  const openCarrier = context.input.program.projectTypes.openCarrier(definition);
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
  const generics = rustProjectGenerics(definition, context);
  if (generics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.project-polymorphism-generics",
      "Polymorphic project class has no exact renderable Rust generic contract.",
    ));
    return undefined;
  }
  const stateMarker = rustProjectStateMarker(definition, context);
  const programErrorVariant = context.input.program.projectTypes.programErrorVariant(definition);
  const publiclyReachable = programErrorVariant !== undefined ||
    rustProjectTypeHasPublicImplementationAbi(context, definition.targetName);
  const exported = context.input.program.source.ast.hasModifierKind(declaration, "export");
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
  const identityImplementations = projectIdentityImplementations(
    definition,
    wrapperType,
    context,
  );
  if (identityImplementations === undefined) return undefined;
  const implementationVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const defaultImplementation = rustDefaultImplementation(
    wrapperType,
    generics,
    constructor.construct,
  );
  const explicitTraitImplementations = planRustExplicitTraitImplementations(
    declaration,
    wrapperType,
    generics,
    context,
  );
  if (explicitTraitImplementations === undefined) return undefined;
  return [
    trait,
    {
      kind: "struct",
      name: definition.stateName,
      visibility: implementationVisibility,
      attrs: [
        ...(publiclyReachable ? [rustDocHiddenAttribute] : []),
        rustLintAttributes.deadCode,
      ],
      generics,
      fields: { kind: "named", fields: [
        ...(baseStateType === undefined
          ? []
          : [{
              name: context.input.program.projectTypes.baseStateFieldName(definition),
              type: baseStateType,
              visibility: implementationVisibility,
              ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
            }]),
        ...ownLayer.fields.map((field) => ({
          name: field.targetName,
          type: field.type,
          visibility: rustProjectMemberStorageVisibility(
            context.input.program.source.ast,
            field.declaration,
            publiclyReachable,
          ),
        })),
        ...ownLayer.methodProperties.map((property) => ({
          name: property.targetName,
          type: {
            kind: "named" as const,
            path: "Option",
            genericArguments: rustTypeGenericArguments([property.callableType]),
          },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
        })),
        ...(stateMarker === undefined
          ? []
          : [{
              name: stateMarker.name,
              type: stateMarker.type,
              visibility: implementationVisibility,
              ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
            }]),
      ] },
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
          : [rustDocHiddenAttribute]),
        rustDeriveAttribute("Clone"),
      ],
      generics,
      fields: { kind: "named", fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType({
            kind: "trait-object",
            bounds: [{ kind: "trait", trait: dispatchType }],
          }),
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
        },
      ] },
    },
    ...identityImplementations,
    {
      kind: "struct",
      name: rustProjectRootName(definition),
      visibility: "crate",
      attrs: [rustLintAttributes.deadCode],
      generics,
      fields: { kind: "named", fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: "private",
        },
        {
          name: rustProjectObjectStateField,
          type: {
            kind: "named",
            path: "rt::LocalObjectHandle",
            genericArguments: rustTypeGenericArguments([stateType]),
          },
          visibility: "private",
        },
      ] },
    },
    {
      kind: "impl",
      generics,
      target: wrapperType,
      polarity: "positive",
      safety: "safe",
      functions: [constructor.initialize, constructor.construct, ...staticMethods],
      associatedTypes: [],
      associatedConstants: [],
    },
    ...(defaultImplementation === undefined ? [] : [defaultImplementation]),
    ...rootImplementations,
    ...externalErrorImplementations,
    ...explicitTraitImplementations,
  ];
}

function planProjectExternalErrorImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const external = context.input.program.projectTypes.externalBaseForDefinition(definition);
  if (external === undefined) {
    return [];
  }
  const name = external.fields.find((field) => field.sourceName === "name");
  const message = external.fields.find((field) => field.sourceName === "message");
  if (name === undefined || message === undefined) {
    return undefined;
  }
  const nameRead = context.input.program.projectTypes.memberSlotName(name.declaration, "read");
  const messageRead = context.input.program.projectTypes.memberSlotName(message.declaration, "read");
  if (nameRead === undefined || messageRead === undefined) {
    return undefined;
  }
  const self = { kind: "path" as const, path: "self" };
  return [{
    kind: "impl",
    generics: emptyRustAstGenerics,
    trait: { kind: "named", path: "std::fmt::Display" },
    target: wrapperType,
    polarity: "positive",
    safety: "safe",
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "fmt",
      visibility: "private",
      generics: emptyRustAstGenerics,
      receiver: rustReferenceReceiver(false),
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "std::fmt::Formatter",
            genericArguments: [{ kind: "lifetime", lifetime: { kind: "inferred" } }],
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
    generics: emptyRustAstGenerics,
    trait: { kind: "named", path: "rt::ToSourceString" },
    target: wrapperType,
    polarity: "positive",
    safety: "safe",
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "to_source_string",
      visibility: "private",
      generics: emptyRustAstGenerics,
      receiver: rustReferenceReceiver(false),
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
  const definition = context.input.program.projectTypes.definitionForDeclaration(declaration);
  if (definition?.kind !== "interface" ||
    !context.input.program.objectRepresentations.requiresDynamicDispatch(definition)) {
    return undefined;
  }
  const declarationContract = context.input.program.declarationContracts.forDeclaration(declaration);
  if (declarationContract?.nativeUnion === true ||
    (declarationContract?.representations.length ?? 0) > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.polymorphic-interface-layout",
      "Explicit native layout requires a direct value representation and cannot describe a polymorphic interface wrapper.",
    ));
    return undefined;
  }
  const carrier = context.input.program.projectTypes.openCarrier(definition);
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
  const generics = rustProjectGenerics(definition, context);
  if (generics === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.project-interface-generics",
      "Polymorphic project interface has no exact renderable Rust generic contract.",
    ));
    return undefined;
  }
  const exported = context.input.program.source.ast.hasModifierKind(declaration, "export");
  const publiclyReachable = rustProjectTypeHasPublicImplementationAbi(
    context,
    definition.targetName,
  );
  const implementationVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const identityImplementations = projectIdentityImplementations(
    definition,
    wrapperType,
    context,
  );
  if (identityImplementations === undefined) return undefined;
  const explicitTraitImplementations = planRustExplicitTraitImplementations(
    declaration,
    wrapperType,
    generics,
    context,
  );
  if (explicitTraitImplementations === undefined) return undefined;
  return [
    trait,
    {
      kind: "struct",
      name: definition.targetName,
      visibility: exported || publiclyReachable ? "public" : "crate",
      generics,
      attrs: [rustLintAttributes.deadCode, rustDeriveAttribute("Clone")],
      fields: { kind: "named", fields: [
        {
          name: rustProjectObjectIdentityField,
          type: { kind: "named", path: "rt::ObjectIdentity" },
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
        },
        {
          name: rustProjectObjectDispatchField,
          type: rustRcType({
            kind: "trait-object",
            bounds: [{ kind: "trait", trait: dispatchType }],
          }),
          visibility: implementationVisibility,
          ...(publiclyReachable ? { attrs: [rustDocHiddenAttribute] } : {}),
        },
      ] },
    },
    ...identityImplementations,
    ...explicitTraitImplementations,
  ];
}
