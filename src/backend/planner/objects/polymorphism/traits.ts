import {
  projectCallableShape,
  projectOwnAccessors,
  projectOwnMethodProperties,
  projectOwnFields,
  projectOwnMethods,
} from "./model.js";
import { projectAccessorCallableShape } from "./forwarders.js";
import { rustCallableSpecialization } from "../../declarations/callable-generics.js";
import { rustLintAttributes } from "../../../rust-ast/lint-policy.js";
import { rustProjectDispatchTraitName, rustProjectDispatchTraitType, rustProjectTypeParameters } from "./names.js";
import { rustProjectObjectIdentityField } from "../project-objects.js";
import type { RustItem, RustTraitFunction, RustType } from "../../../rust-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustErrorBoundaryForProjectMember, rustErrorType } from "../../program/plan-context.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../../policy/types/model.js";

export function projectIdentityImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
): readonly RustItem[] {
  const typeParams = rustProjectTypeParameters(definition);
  return [
    {
      kind: "impl",
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: { kind: "named", path: "std::fmt::Debug" },
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
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: { kind: "named", path: "PartialEq" },
      target: wrapperType,
      functions: [{
        name: "eq",
        visibility: "private",
        selfParam: "ref",
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
      ...(typeParams.length === 0 ? {} : { typeParams }),
      trait: { kind: "named", path: "Eq" },
      target: wrapperType,
      functions: [],
    },
  ];
}

export function planProjectDispatchTrait(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustItem | undefined {
  const fields = projectOwnFields(definition, carrier, context);
  if (fields === undefined) {
    return undefined;
  }
  const functions: RustTraitFunction[] = [];
  for (const field of fields) {
    const dispatch = context.input.projectFieldDispatch.planFor(field.declaration);
    const read = context.input.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined
      ? undefined
      : context.input.projectTypes.memberSlotName(field.declaration, "write");
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
      selfParam: dispatch.read.selfMode,
      params: [],
      returnType: field.type,
      ...(dispatch.read.fallible
        ? { errorType: rustErrorType(fieldErrorBoundary!) }
        : {}),
    });
    if (dispatch.write !== undefined) {
      functions.push({
        name: write!,
        selfParam: dispatch.write.selfMode,
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
    const slot = context.input.projectTypes.memberSlotName(
      accessor.declaration,
      accessor.role,
    );
    if (shape === undefined || slot === undefined) {
      return undefined;
    }
    functions.push({
      name: slot,
      selfParam: "rc",
      params: shape.params.map((parameter) => ({ ...parameter, mutable: false })),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
      ...(shape.isUnsafe ? { isUnsafe: true } : {}),
    });
  }
  for (const member of projectOwnMethods(definition, context)) {
    if (context.input.ast.hasModifierKind(member, "static")) {
      continue;
    }
    for (const variant of context.input.projectMethodDispatch.variantsForMember(member)) {
      const specialization = rustCallableSpecialization(
        variant.sourceTypeParameterNames,
        variant.targetTypeArguments,
      );
      const shape = specialization === undefined
        ? undefined
        : projectCallableShape(member, context, specialization);
      if (shape === undefined) {
        return undefined;
      }
      const signature = (name: string): RustTraitFunction => ({
        name,
        selfParam: "rc",
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
    const write = context.input.projectTypes.memberSlotName(
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
      selfParam: "ref",
      params: [{ name: "value", type: property.callableType }],
    });
  }
  const inheritedTraits = context.input.projectTypes.heritageForDefinition(definition).map((edge) =>
    rustProjectDispatchTraitType(edge.targetType, context));
  if (inheritedTraits.some((type) => type === undefined)) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  const superTraits: readonly RustType[] = [
    { kind: "named", path: "rt::ProjectObject" },
    ...inheritedTraits as readonly RustType[],
  ];
  const typeParams = rustProjectTypeParameters(definition);
  return {
    kind: "trait",
    name: rustProjectDispatchTraitName(definition),
    visibility: "crate",
    attrs: [rustLintAttributes.deadCode],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    superTraits,
    functions,
  };
}
