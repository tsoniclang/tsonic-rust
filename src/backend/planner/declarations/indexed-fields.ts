import type { RustSourceTypeFamilyImplementation } from "../../../policy/types/type-families.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import type { RustGenerics, RustItem, RustType } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustGenericRequirementBounds } from "../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../types/associated-bounds.js";
import { readRustStoredObjectField, writeRustStoredObjectField } from "../objects/project-storage.js";
import { createRustSyntheticNameState } from "../names/synthetic.js";

export function planRustIndexedFieldImplementation(
  implementation: RustSourceTypeFamilyImplementation,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const field = implementation.field;
  const key = implementation.arguments[0];
  if (implementation.family.kind !== "indexed" || field === undefined || key?.kind !== "type") return undefined;
  const owner = rustTypeFromCarrierInContext(implementation.owner, context);
  const keyType = rustTypeFromCarrierInContext(key.type, context);
  const output = rustTypeFromCarrierInContext(implementation.output, context);
  const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  const boundary = rustCurrentErrorBoundary(context);
  const contract = context.input.program.declarationGenericRequirements.contractForCarrier({
    kind: "tuple", elements: [implementation.owner, implementation.output],
  });
  const parameters = rustTargetGenericReferences(implementation.owner);
  if (owner === undefined || keyType === undefined || output === undefined || error === undefined || boundary === undefined ||
    contract === undefined || parameters.lifetimes.length !== 0 || parameters.constIdentities.length !== 0) return undefined;
  const generics: RustGenerics = {
    parameters: contract.typeParameters.map(parameter => ({ kind: "type", name: parameter.name,
      bounds: rustGenericRequirementBounds(parameter.requirements) })),
    wherePredicates: rustAssociatedPredicates(contract.associatedTypes, context),
  };
  const handle = owner.kind === "named" && (owner.path === "rt::ObjectHandle" || owner.path === "rt::ObjectRef");
  const stateArgument = handle ? owner.genericArguments?.[0] : undefined;
  const storage = !handle ? owner : stateArgument?.kind === "type" ? stateArgument.type : undefined;
  if (storage === undefined) return undefined;
  const trait: RustType = { kind: "named", path: "rt::Field", genericArguments: [{ kind: "type", type: keyType }] };
  const items: RustItem[] = [{ kind: "impl", trait, target: storage, generics,
    associatedTypes: [{ name: "Output", type: output }, { name: "Storage", type: storage }], functions: [],
  }];
  for (const access of field.sharedWrite ? ["read", "write"] as const : ["read"] as const) {
    const bodyContext: RustPlanContext = { ...context, fallibleBoundary: boundary,
      syntheticNames: createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile,
        ["owner", "_key", "value"]),
    };
    const receiver = handle ? { kind: "path" as const, path: "owner" }
      : { kind: "dereference" as const, pointer: { kind: "path" as const, path: "owner" } };
    const value = access === "read" ? readRustStoredObjectField(field.storage, implementation.owner,
      receiver, field.storageIndex, implementation.output, bodyContext, [], handle)
      : writeRustStoredObjectField(field.storage, implementation.owner, receiver, field.storageIndex,
        "=", { kind: "path", path: "value" }, bodyContext, [], handle);
    if (value === undefined) return undefined;
    const result: RustType = { kind: "named", path: "Result", genericArguments: [
      { kind: "type", type: access === "read" ? output : { kind: "unit" } }, { kind: "type", type: error },
    ] };
    items.push({ kind: "impl", target: storage, generics,
      trait: { kind: "named", path: access === "read" ? "rt::ReadFieldOf" : "rt::WriteFieldOf", genericArguments: [
        { kind: "type", type: owner }, { kind: "type", type: keyType }, { kind: "type", type: error },
      ] },
      functions: [{ name: access === "read" ? "read_field" : "write_field", visibility: "private",
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
