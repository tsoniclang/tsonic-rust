import type { Node } from "@tsonic/tsts";
import type { RustItem } from "../rust-ast/nodes.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import {
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
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
  if (wrapperType === undefined || dispatchType === undefined || rootType === undefined || layers === undefined) {
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
  const staticMethods = planProjectStaticMethods(definition, context);
  if (staticMethods === undefined) {
    return undefined;
  }
  return [
    trait,
    {
      kind: "struct",
      name: definition.sourceName,
      visibility: context.input.ast.hasModifierKind(declaration, "export") ? "public" : "private",
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
      attrs: [
        "#[allow(non_camel_case_types)]",
        "#[allow(clippy::type_complexity)]",
      ],
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
            typeArguments: [projectStateType(layers)],
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
  ];
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
      name: definition.sourceName,
      visibility: context.input.ast.hasModifierKind(declaration, "export") ? "public" : "private",
      ...(context.input.ast.hasModifierKind(declaration, "export")
        ? {}
        : { attrs: ["#[allow(dead_code)]"] }),
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
