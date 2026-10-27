import { rustHiddenAttribute } from "../../../target-ast/syntax/attributes.js";
import { projectCallableShape, projectOwnFields, renderProjectMethodProperty } from "./model.js";
import { projectAccessorCallableShape, projectDowncastReturnType } from "./forwarders.js";
import { rustCallableSpecialization } from "../../declarations/callables/generics.js";
import { rustProjectDispatchTraitName, rustProjectDispatchTraitType, rustProjectRepresentationGenerics } from "./names.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../project-objects.js";
import { rustProjectCloneImplementation } from "../project-wrapper-traits.js";
import type { RustGenericArgument, RustItem, RustTraitFunction, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustErrorBoundaryForProjectMember } from "../../program/plan-context.js";
import { rustErrorType } from "../../program/fallible-boundaries.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustObjectRepresentation } from "../../../../target-model/records/objects/object-representation.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustProjectImplementationVisibility } from "../project-storage-abi.js";
import { rustProjectObjectIdentityImplementation } from "../project-identity.js";
import { rustArrayFieldMutationName, rustArrayFieldMutationType } from "./array-fields.js";
import { planRustProjectProjectionImplementations } from "../project-projections.js";
import { rustStructuralDispatchType } from "../project-structural-types.js";
import { checkedProjectProjectionSignature } from "../checked-project-projections.js";
import { rustProjectTypeParameterContext } from "../../names/type-parameters.js";
import { rustProjectErrorSuperTraits } from "./project-errors.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustTargetGenericArgumentToAstInContext } from "../../types/render.js";

export function projectIdentityImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  representation: RustObjectRepresentation,
  context: RustPlanContext,
): readonly RustItem[] {
  const generics = rustProjectRepresentationGenerics(representation, context);
  return [
    rustProjectCloneImplementation(wrapperType, generics, [rustProjectObjectIdentityField, rustProjectObjectDispatchField]),
    ...planRustProjectProjectionImplementations(definition, context),
    {
      kind: "impl",
      generics,
      trait: { kind: "named", path: "core::fmt::Debug" },
      target: wrapperType,
      members: [{ kind: "function",
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
      members: [{ kind: "function",
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
      members: [],
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
  definition: RustProjectTypeDefinition, carrier: TargetTypeRef, context: RustPlanContext,
): RustItem | undefined {
  context = rustProjectTypeParameterContext(definition, context, "implementation");
  const representation = context.input.program.records.objectRepresentation.get(definition);
  const selected = context.input.program.records.projectDispatchEmission.get(definition);
  if (representation === undefined || selected === undefined)
    failRustPlannerInvariant("An admitted project dispatch trait requires its exact sealed representation and native selections.", definition.declaration);
  const fields = projectOwnFields(definition, carrier, context);
  if (fields === undefined) failRustPlannerInvariant("An admitted project dispatch trait requires its exact instantiated fields.", definition.declaration);
  const functions: RustTraitFunction[] = [];
  if (selected.projection !== undefined) functions.push({ ...checkedProjectProjectionSignature(selected.projection.slot),
    ...(selected.projection.deadCode === undefined ? {} : { deadCode: selected.projection.deadCode }) });
  for (const { route, deadCode } of selected.routes) {
    const returnType = projectDowncastReturnType(route, context);
    if (returnType === undefined) failRustPlannerInvariant("An admitted downcast slot requires its exact native return type.", definition.declaration);
    functions.push({ kind: "function", name: route.slot, ...(deadCode === undefined ? {} : { deadCode }),
      generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"), params: [], returnType,
      body: { statements: [{ kind: "tail", expr: { kind: "none" } }] } });
  }
  for (const field of fields) {
    const chosen = selected.fields.get(field.declaration);
    if (chosen === undefined) failRustPlannerInvariant("An admitted native dispatch field requires its sealed slots and effects.", field.declaration);
    const { dispatch, read, write } = chosen;
    if (chosen.capture !== undefined) functions.push({ kind: "function", name: chosen.capture, generics: emptyRustGenerics,
      ...(chosen.deadCode.capture === undefined ? {} : { deadCode: chosen.deadCode.capture }),
      selfParam: rustSelfParameter("ref"), params: [], returnType: field.storageType });
    const boundary = dispatch.read.fallible || dispatch.write?.fallible === true
      ? rustErrorBoundaryForProjectMember(field.declaration, context) : undefined;
    if ((dispatch.read.fallible || dispatch.write?.fallible === true) && boundary === undefined)
      failRustPlannerInvariant("An admitted fallible dispatch field requires its exact native error ABI.", field.declaration);
    if (chosen.contentMutation) functions.push({ kind: "function", name: rustArrayFieldMutationName(read),
      generics: emptyRustGenerics, ...(chosen.deadCode.content === undefined ? {} : { deadCode: chosen.deadCode.content }),
      selfParam: rustSelfParameter("ref"), params: [{ name: "action", type: rustArrayFieldMutationType(field.type) }] });
    functions.push({ kind: "function", name: read, ...(chosen.deadCode.read === undefined ? {} : { deadCode: chosen.deadCode.read }),
      generics: emptyRustGenerics, selfParam: rustSelfParameter(dispatch.read.selfMode), params: [], returnType: field.type,
      ...(dispatch.read.fallible ? { errorType: rustErrorType(boundary!) } : {}) });
    if (dispatch.write !== undefined) {
      if (write === undefined) failRustPlannerInvariant("An admitted native dispatch write requires its exact slot.", field.declaration);
      functions.push({ kind: "function", name: write, ...(chosen.deadCode.write === undefined ? {} : { deadCode: chosen.deadCode.write }),
        generics: emptyRustGenerics, selfParam: rustSelfParameter(dispatch.write.selfMode),
        params: [{ name: "value", type: field.type }], ...(dispatch.write.fallible ? { errorType: rustErrorType(boundary!) } : {}) });
    }
  }
  for (const accessor of selected.accessors) {
    const shape = projectAccessorCallableShape(definition, carrier, accessor.declaration, accessor.role, context);
    if (shape === undefined) failRustPlannerInvariant("An admitted native dispatch accessor requires its exact callable ABI.", accessor.declaration);
    functions.push({ kind: "function", name: accessor.slot, ...(accessor.deadCode === undefined ? {} : { deadCode: accessor.deadCode }),
      generics: emptyRustGenerics, selfParam: rustSelfParameter("rc"),
      params: shape.params.map(parameter => ({ ...parameter, mutable: false })),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }), ...(shape.isUnsafe ? { isUnsafe: true } : {}) });
  }
  for (const method of selected.methods) {
    const specialization = rustCallableSpecialization(method.variant.sourceTypeParameterIdentities, method.variant.targetTypeArguments);
    const shape = specialization === undefined ? undefined : projectCallableShape(method.declaration, context, {
      methodTypeArgumentSubstitutions: specialization,
    });
    if (shape === undefined) failRustPlannerInvariant("An admitted native dispatch method requires its exact specialized callable ABI.", method.declaration);
    const signature = (name: string, deadCode: typeof method.virtualDeadCode): RustTraitFunction => ({
      kind: "function", name, ...(deadCode === undefined ? {} : { deadCode }), generics: emptyRustGenerics,
      selfParam: rustSelfParameter("rc"), params: shape.params.map(parameter => ({ ...parameter, mutable: false })),
      ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
      ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }), ...(shape.isUnsafe ? { isUnsafe: true } : {}),
    });
    functions.push(signature(method.variant.virtualSlot, method.virtualDeadCode));
    if (method.exact) functions.push(signature(method.variant.exactSlot, method.exactDeadCode));
  }
  for (const write of selected.methodWrites) {
    const property = renderProjectMethodProperty(write.property, context);
    functions.push({ kind: "function", name: write.slot, ...(write.deadCode === undefined ? {} : { deadCode: write.deadCode }),
      generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"), params: [{ name: "value", type: property.callableType }] });
  }
  const superTraits = [{ kind: "named" as const, path: "rt::ObjectIdentityCarrier" },
    ...rustProjectErrorSuperTraits(definition, context),
    ...selected.projectSupers.map(carrier => rustProjectDispatchTraitType(carrier, context)),
    ...selected.structuralSupers.map(supertrait => {
      const type = rustStructuralDispatchType(supertrait.carrier, context);
      const genericArguments = supertrait.genericArguments.map(argument => rustTargetGenericArgumentToAstInContext(argument, context));
      if (type?.kind !== "named" || genericArguments.some(argument => argument === undefined))
        failRustPlannerInvariant("An admitted structural supertrait requires its exact rendered native arguments.", definition.declaration);
      return { ...type, genericArguments: genericArguments as readonly RustGenericArgument[] };
    })];
  if (superTraits.some(type => type === undefined))
    failRustPlannerInvariant("An admitted native dispatch trait requires its exact native supertraits.", definition.declaration);
  return { kind: "trait", name: rustProjectDispatchTraitName(definition),
    visibility: rustProjectImplementationVisibility(selected.publiclyReachable),
    ...(selected.publiclyReachable ? { attrs: [rustHiddenAttribute] } : {}),
    ...(selected.deadCode === undefined ? {} : { deadCode: selected.deadCode }),
    generics: rustProjectRepresentationGenerics(representation, context),
    ...(superTraits.length === 0 ? {} : { superTraits: superTraits as readonly RustType[] }), members: functions };
}
