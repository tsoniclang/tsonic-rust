import {
  projectCallableShape,
  projectOwnAccessors,
  projectOwnMethodProperties,
  projectOwnFields,
  projectOwnMethods,
} from "./model.js";
import { projectAccessorCallableShape, projectDowncastReturnType } from "./forwarders.js";
import { rustCallableSpecialization } from "../../declarations/callable-generics.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import { rustProjectDispatchTraitName, rustProjectDispatchTraitType, rustProjectRepresentationGenerics } from "./names.js";
import { rustProjectObjectIdentityField } from "../project-objects.js";
import type { RustItem, RustTraitFunction, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import { rustSelfParameter } from "../../declarations/self-parameter.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  rustProjectTypeHasPublicImplementationAbi,
} from "../../program/plan-context.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { RustObjectRepresentation } from "../../../../analysis/project-types/object-representation.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustProjectImplementationVisibility } from "../project-storage-abi.js";
import { rustProjectObjectIdentityImplementation } from "../project-identity.js";

export function projectIdentityImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  representation: RustObjectRepresentation,
): readonly RustItem[] {
  const generics = rustProjectRepresentationGenerics(representation);
  return [
    {
      kind: "impl",
      generics,
      trait: { kind: "named", path: "std::fmt::Debug" },
      target: wrapperType,
      functions: [{
        name: "fmt",
        visibility: "private",
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"),
        params: [{
          name: "formatter",
          type: {
            kind: "reference",
            mutable: true,
            referent: {
              kind: "named",
              path: "std::fmt::Formatter",
              genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
            },
          },
        }],
        returnType: { kind: "named", path: "std::fmt::Result" },
        body: {
          statements: [{
            kind: "tail",
            expr: {
              kind: "method-call",
              receiver: { kind: "path", path: "formatter" },
              method: "write_str",
              args: [{ kind: "str-literal", value: definition.targetName }],
            },
          }],
        },
      }],
    },
    {
      kind: "impl",
      generics,
      trait: { kind: "named", path: "PartialEq" },
      target: wrapperType,
      functions: [{
        name: "eq",
        visibility: "private",
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("ref"),
        params: [{
          name: "other",
          type: {
            kind: "reference",
            referent: { kind: "named", path: "Self" },
            mutable: false,
          },
        }],
        returnType: { kind: "primitive", name: "bool" },
        body: {
          statements: [{
            kind: "tail",
            expr: {
              kind: "binary",
              operator: "==",
              left: {
                kind: "field",
                receiver: { kind: "path", path: "self" },
                name: rustProjectObjectIdentityField,
              },
              right: {
                kind: "field",
                receiver: { kind: "path", path: "other" },
                name: rustProjectObjectIdentityField,
              },
            },
          }],
        },
      }],
    },
    {
      kind: "impl",
      generics,
      trait: { kind: "named", path: "Eq" },
      target: wrapperType,
      functions: [],
    },
    rustProjectObjectIdentityImplementation(wrapperType, generics, {
      kind: "reference",
      expr: {
        kind: "field",
        receiver: { kind: "path", path: "self" },
        name: rustProjectObjectIdentityField,
      },
    }),
  ];
}

export function planProjectDispatchTrait(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustItem | undefined {
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (representation === undefined) {
    return undefined;
  }
  const fields = projectOwnFields(definition, carrier, context);
  if (fields === undefined) {
    return undefined;
  }
  const functions: RustTraitFunction[] = [];
  for (const route of context.input.program.projectTypes.downcastRoutesFor(definition)) {
    const returnType = projectDowncastReturnType(route, context);
    if (returnType === undefined) {
      return undefined;
    }
    functions.push({
      name: route.slot,
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter("rc"),
      params: [],
      returnType,
    });
  }
  for (const field of fields) {
    const dispatch = context.input.program.projectFieldDispatch.planFor(field.declaration);
    const read = context.input.program.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined
      ? undefined
      : context.input.program.projectTypes.memberSlotName(field.declaration, "write");
    if (dispatch === undefined || read === undefined ||
      dispatch.write !== undefined && write === undefined) {
      return undefined;
    }
    const fieldErrorBoundary = dispatch.read.fallible || dispatch.write?.fallible === true
      ? rustErrorBoundaryForProjectMember(field.declaration, context)
      : undefined;
    if ((dispatch.read.fallible || dispatch.write?.fallible === true) &&
      fieldErrorBoundary === undefined) {
      return undefined;
    }
    functions.push({
      name: read,
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter(dispatch.read.selfMode),
      params: [],
      returnType: field.type,
      ...(dispatch.read.fallible
        ? { errorType: rustErrorType(fieldErrorBoundary!) }
        : {}),
    });
    if (dispatch.write !== undefined) {
      functions.push({
        name: write!,
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter(dispatch.write.selfMode),
        params: [{ name: "value", type: field.type }],
        ...(dispatch.write.fallible
          ? { errorType: rustErrorType(fieldErrorBoundary!) }
          : {}),
      });
    }
  }
  for (const accessor of projectOwnAccessors(definition, context)) {
    const shape = projectAccessorCallableShape(
      definition,
      carrier,
      accessor.declaration,
      accessor.role,
      context,
    );
    const slot = context.input.program.projectTypes.memberSlotName(
      accessor.declaration,
      accessor.role,
    );
    if (shape === undefined || slot === undefined) {
      return undefined;
    }
    functions.push({
      name: slot,
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter("rc"),
      params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
      ...(shape.isUnsafe ? { isUnsafe: true } : {}),
    });
  }
  for (const member of projectOwnMethods(definition, context)) {
    if (context.input.program.source.ast.hasModifierKind(member, "static")) {
      continue;
    }
    for (const variant of context.input.program.projectMethodDispatch.variantsForMember(member)) {
      const specialization = rustCallableSpecialization(
        variant.sourceTypeParameterNames,
        variant.targetTypeArguments,
      );
      const shape = specialization === undefined
        ? undefined
        : projectCallableShape(member, context, {
            methodTypeArgumentSubstitutions: specialization,
          });
      if (shape === undefined) {
        return undefined;
      }
      const signature = (name: string): RustTraitFunction => ({
        name,
        generics: emptyRustGenerics,
        selfParam: rustSelfParameter("rc"),
        params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
        ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
        ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
        ...(shape.isUnsafe ? { isUnsafe: true } : {}),
      });
      functions.push(signature(variant.virtualSlot));
      if (definition.kind === "class") {
        functions.push(signature(variant.exactSlot));
      }
    }
  }
  const methodProperties = projectOwnMethodProperties(definition, carrier, context);
  if (methodProperties === undefined) {
    return undefined;
  }
  for (const property of methodProperties) {
    const write = context.input.program.projectTypes.memberSlotName(
      property.declaration,
      "method-write",
    );
    if (write === undefined || functions.some((candidate) => candidate.name === write)) {
      if (write === undefined) {
        return undefined;
      }
      continue;
    }
    functions.push({
      name: write,
      generics: emptyRustGenerics,
      selfParam: rustSelfParameter("ref"),
      params: [{ name: "value", type: property.callableType }],
    });
  }
  const superTraits = context.input.program.projectTypes.heritageForDefinition(definition).map((edge) =>
    rustProjectDispatchTraitType(edge.targetType, context));
  if (superTraits.some((type) => type === undefined)) {
    return undefined;
  }
  const generics = rustProjectRepresentationGenerics(representation);
  const publiclyReachable = context.input.program.projectTypes.programErrorVariant(definition) !== undefined ||
    rustProjectTypeHasPublicImplementationAbi(context, definition.targetName);
  return {
    kind: "trait",
    name: rustProjectDispatchTraitName(definition),
    visibility: rustProjectImplementationVisibility(publiclyReachable),
    attrs: [
      ...(publiclyReachable ? ["#[doc(hidden)]"] : []),
      rustLintAttributes.deadCode,
    ],
    generics,
    ...(superTraits.length === 0 ? {} : { superTraits: superTraits as readonly RustType[] }),
    functions,
  };
}
