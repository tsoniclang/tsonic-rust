import {
  projectCallableShape,
  projectOwnAccessors,
  projectOwnMethodProperties,
  projectOwnFields,
  projectOwnMethods,
} from "./model.js";
import { projectAccessorCallableShape, projectDowncastReturnType } from "./forwarders.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";
import { rustProjectDispatchTraitName, rustProjectDispatchTraitType, rustProjectGenerics } from "./names.js";
import { rustProjectObjectIdentityField } from "../project-objects.js";
import { emptyRustAstGenerics, type RustItem, type RustTraitFunction, type RustType } from "../../../target-ast/nodes.js";
import { rustDocHiddenAttribute } from "../../../target-ast/attributes.js";
import { rustReferenceReceiver } from "../../../target-ast/builders.js";
import { projectFieldReceiver } from "../project-field-dispatch.js";
import { rustSharedSelfReceiver } from "./model.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import {
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  rustProjectTypeHasPublicImplementationAbi,
} from "../../program/plan-context.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustProjectImplementationVisibility } from "../project-storage-abi.js";

export function projectIdentityImplementations(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const generics = rustProjectGenerics(definition, context);
  if (generics === undefined) return undefined;
  return [
    {
      kind: "impl",
      generics,
      trait: { kind: "named", path: "std::fmt::Debug" },
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
      polarity: "positive",
      safety: "safe",
      associatedTypes: [],
      associatedConstants: [],
      functions: [{
        name: "eq",
        visibility: "private",
        generics: emptyRustAstGenerics,
        receiver: rustReferenceReceiver(false),
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
      polarity: "positive",
      safety: "safe",
      functions: [],
      associatedTypes: [],
      associatedConstants: [],
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
  for (const route of context.input.program.projectTypes.downcastRoutesFor(definition)) {
    const returnType = projectDowncastReturnType(route, context);
    if (returnType === undefined) {
      return undefined;
    }
    functions.push({
      name: route.slot,
      generics: emptyRustAstGenerics,
      receiver: rustSharedSelfReceiver(),
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
      generics: emptyRustAstGenerics,
      receiver: projectFieldReceiver(dispatch.read),
      params: [],
      returnType: field.type,
      ...(dispatch.read.fallible
        ? { errorType: rustErrorType(fieldErrorBoundary!) }
        : {}),
    });
    if (dispatch.write !== undefined) {
      functions.push({
        name: write!,
        generics: emptyRustAstGenerics,
        receiver: projectFieldReceiver(dispatch.write),
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
      generics: shape.generics,
      receiver: rustSharedSelfReceiver(),
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
      const shape = projectCallableShape(member, context, {
        methodGenericSubstitutions: variant.specialization,
      });
      if (shape === undefined) {
        return undefined;
      }
      const signature = (name: string): RustTraitFunction => ({
        name,
        generics: shape.generics,
        receiver: rustSharedSelfReceiver(),
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
      generics: emptyRustAstGenerics,
      receiver: rustReferenceReceiver(false),
      params: [{ name: "value", type: property.callableType }],
    });
  }
  const superTraits = context.input.program.projectTypes.heritageForDefinition(definition).map((edge) =>
    rustProjectDispatchTraitType(edge.targetType, context));
  if (superTraits.some((type) => type === undefined)) {
    return undefined;
  }
  const generics = rustProjectGenerics(definition, context);
  if (generics === undefined) return undefined;
  const publiclyReachable = context.input.program.projectTypes.programErrorVariant(definition) !== undefined ||
    rustProjectTypeHasPublicImplementationAbi(context, definition.targetName);
  const explicitContract = context.input.program.declarationContracts.forDeclaration(
    definition.declaration,
  );
  return {
    kind: "trait",
    name: rustProjectDispatchTraitName(definition),
    visibility: rustProjectImplementationVisibility(publiclyReachable),
    attrs: [
      ...(publiclyReachable ? [rustDocHiddenAttribute] : []),
      rustLintAttributes.deadCode,
      ...(explicitContract?.unsafeTrait === true
        ? [rustLintAttributes.missingSafetyDoc]
        : []),
    ],
    generics,
    safety: explicitContract?.unsafeTrait === true ? "unsafe" : "safe",
    auto: false,
    superTraits: (superTraits as readonly RustType[]).map((trait) => ({
      kind: "trait",
      trait,
    })),
    functions,
    associatedTypes: [],
    associatedConstants: [],
  };
}
