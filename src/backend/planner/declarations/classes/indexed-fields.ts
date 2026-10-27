import type { RustNativeDeclarationForms } from "../../../../target-model/records/native/native-declaration-forms.js";
import { rustPackageFallibleBoundary } from "../../program/fallible-boundaries.js";
import { rustProgramErrorTargetType } from "../../../../target-model/types/index.js";
import type { RustGenerics, RustItem, RustType } from "../../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext, rustTargetGenericArgumentToAstInContext } from "../../types/render.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustGenericRequirementBounds } from "../../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { readRustStoredObjectField, writeRustStoredObjectField } from "../../objects/project-storage.js";
import { createRustSyntheticNameState } from "../../names/synthetic.js";
import { rustGeneratedTypeParameterContext } from "../../names/type-parameters.js";

export function planRustIndexedFieldImplementation(
  admitted: RustNativeDeclarationForms["implementations"][number],
  context: RustPlanContext,
): readonly RustItem[] {
  const { implementation, genericContract: contract } = admitted;
  const field = implementation.field;
  const key = implementation.arguments[0];
  if (implementation.family.kind !== "indexed" || field === undefined || key?.kind !== "type")
    failRustPlannerInvariant("An admitted indexed-field implementation requires its exact field and key contract.");
  context = rustGeneratedTypeParameterContext(contract.typeParameters, [], context);
  const owner = rustTypeFromCarrierInContext(implementation.owner, context);
  const keyType = rustTypeFromCarrierInContext(key.type, context);
  const output = rustTypeFromCarrierInContext(implementation.output, context);
  const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  const boundary = rustCurrentErrorBoundary(context);
  if (owner === undefined || keyType === undefined || output === undefined || error === undefined || boundary === undefined)
    failRustPlannerInvariant("An admitted indexed-field implementation requires renderable native owner, key, payload and error types.");
  const generics: RustGenerics = {
    parameters: contract.typeParameters.map(parameter => ({ kind: "type", name: context.typeParameterNames?.get(parameter.identity) ?? parameter.name,
      bounds: rustGenericRequirementBounds(parameter.requirements) })),
    wherePredicates: rustAssociatedPredicates(contract.associatedTypes, context),
  };
  const handle = admitted.storage.kind === "structural-state";
  let storage: RustType = owner;
  if (admitted.storage.kind === "structural-state") {
    const selected = admitted.storage;
    const external = context.externalStructuralShapeModuleByFileName.get(selected.ownerFileName);
    const crate = context.externalCrateNameByFileName.get(selected.ownerFileName);
    const path = external !== undefined && crate !== context.crateName ? `${external}::${selected.targetName}`
      : context.moduleName === context.structuralShapesModuleName ? selected.targetName
      : `crate::${context.structuralShapesModuleName}::${selected.targetName}`;
    const arguments_ = selected.arguments.map(argument => rustTargetGenericArgumentToAstInContext(argument, context));
    if (arguments_.some(argument => argument === undefined))
      failRustPlannerInvariant("An admitted indexed-field storage requires renderable native generic arguments.");
    storage = { kind: "named", path, genericArguments: arguments_ as NonNullable<typeof arguments_[number]>[] };
  }
  const trait: RustType = { kind: "named", path: "rt::Field", genericArguments: [{ kind: "type", type: keyType }] };
  const items: RustItem[] = [{ kind: "impl", trait, target: storage, generics,
    members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, type: output },
      { kind: "type", name: "Storage", generics: emptyRustGenerics, type: storage }],
  }];
  for (const access of field.sharedWrite ? ["read", "write"] as const : ["read"] as const) {
    const bodyContext: RustPlanContext = { ...context, fallibleBoundary: rustPackageFallibleBoundary(boundary),
      syntheticNames: createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile,
        ["owner", "_key", "value"]),
    };
    const receiver = { kind: "path" as const, path: "owner" };
    const value = access === "read" ? readRustStoredObjectField(field.storage, implementation.owner,
      receiver, field.storageIndex, implementation.output, bodyContext, [], handle)
      : writeRustStoredObjectField(field.storage, implementation.owner, receiver, field.storageIndex,
        "=", { kind: "path", path: "value" }, bodyContext, [], handle);
    if (value === undefined) failRustPlannerInvariant("An admitted indexed-field operation requires its native storage expression.");
    const result: RustType = { kind: "named", path: "Result", genericArguments: [
      { kind: "type", type: access === "read" ? output : { kind: "unit" } }, { kind: "type", type: error },
    ] };
    items.push({ kind: "impl", target: storage, generics,
      trait: { kind: "named", path: access === "read" ? "rt::ReadFieldOf" : "rt::WriteFieldOf", genericArguments: [
        { kind: "type", type: owner }, { kind: "type", type: keyType }, { kind: "type", type: error },
      ] },
      members: [{ kind: "function", name: access === "read" ? "read_field" : "write_field", visibility: "private",
        generics: emptyRustGenerics,
        params: [
          { name: "owner", type: { kind: "reference", referent: owner, mutable: false } },
          { name: "_key", type: { kind: "reference", referent: keyType, mutable: false } },
          ...(access === "read" ? [] : [{ name: "value", type: output }]),
        ], returnType: result,
        body: { statements: access === "read"
          ? [{ kind: "tail", expr: { kind: "call", path: "Ok", args: [value] } }]
          : [{ kind: "expr", expr: value },
            { kind: "tail", expr: { kind: "call", path: "Ok", args: [{ kind: "tuple-literal", elements: [] }] } }],
        },
      }],
    });
  }
  return items;
}
