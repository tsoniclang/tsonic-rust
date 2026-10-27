import type { RustStructuralShapeDefinition } from "../../../target-model/records/objects/structural-shapes.js";
import type { RustExpr, RustGenerics, RustItem, RustTraitFunction, RustType, RustVisibility } from "../../target-ast/syntax/nodes.js";
import type { RustDeadCodeDisposition } from "../../../target-model/records/native/native-liveness.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { rustProjectObjectIdentityImplementation } from "./project-identity.js";
import type { RustConstructorShapeEmission } from "../../../target-model/records/objects/structural-emission.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustLifetimeToAst } from "../types/lifetime-syntax.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function planRustConstructorShape(
  definition: RustStructuralShapeDefinition,
  selected: RustConstructorShapeEmission,
  generics: RustGenerics,
  type: RustType,
  visibility: RustVisibility,
  errorType: RustType,
  render: (carrier: TargetTypeRef) => RustType | undefined,
  superTraits: readonly RustType[],
  fieldDeadCode: (index: number, role: "value" | "getter" | "setter") => RustDeadCodeDisposition | undefined,
): readonly RustItem[] | undefined {
  if (definition.dispatchName === undefined || type.kind !== "named") failRustPlannerInvariant("An admitted constructor shape requires its named native dispatch type.");
  const functions: RustTraitFunction[] = [];
  for (const member of selected.members) {
    const result = render(member.result);
    const parameters = member.parameters.map((parameter, index) => {
      const type = render(parameter);
      return type === undefined ? undefined : { name: `argument${index}`, type };
    });
    if (result === undefined || parameters.some(parameter => parameter === undefined)) failRustPlannerInvariant("An admitted constructor member requires its exact native signature.");
    const field = member.field;
    const params = parameters as NonNullable<typeof parameters[number]>[];
    functions.push({ kind: "function", name: member.name, generics: emptyRustGenerics,
      ...(field === undefined ? {} : { deadCode: fieldDeadCode(field.index, field.role) }),
      selfParam: rustSelfParameter(member.selfMode), params: field?.role === "setter" ? [{ name: "value", type: params[0]!.type }] : params,
      returnType: result, errorType });
  }
  const traitGenerics: RustGenerics = { ...generics, parameters: selected.genericParameterIndices.map(index => generics.parameters[index]!) };
  const trait: RustType = { kind: "named", path: definition.dispatchName,
    genericArguments: selected.genericParameterIndices.map(index => type.genericArguments![index]!) };
  const dispatch: RustType = { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: {
    kind: "trait-object", principal: { trait }, autoTraits: [],
    ...(selected.lifetime === undefined ? {} : { lifetime: rustLifetimeToAst(selected.lifetime) }),
  } }] };
  const field = (owner: string, name: string): RustExpr => ({ kind: "field", receiver: { kind: "path", path: owner }, name });
  return [
    { kind: "trait", name: definition.dispatchName, visibility, generics: traitGenerics, members: functions,
      superTraits: [{ kind: "named", path: "rt::ObjectIdentityCarrier" }, ...superTraits] },
    { kind: "struct", name: definition.targetName, visibility, generics, fields: [
      { name: "dispatch", visibility, type: dispatch },
    ] },
    { kind: "impl", generics, target: type, trait: { kind: "named", path: "Clone" }, members: [{ kind: "function",
      name: "clone", visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"), params: [],
      returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: {
        kind: "struct-literal", path: "Self", fields: [
          { name: "dispatch", value: { kind: "method-call", receiver: field("self", "dispatch"), method: "clone", args: [] } },
        ],
      } }] },
    }] },
    { kind: "impl", generics, target: type, trait: { kind: "named", path: "PartialEq" }, members: [{ kind: "function",
      name: "eq", visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"),
      params: [{ name: "other", type: { kind: "reference", mutable: false, referent: { kind: "named", path: "Self" } } }],
      returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: {
        kind: "call", path: "alloc::rc::Rc::ptr_eq", args: [
          { kind: "reference", expr: field("self", "dispatch") }, { kind: "reference", expr: field("other", "dispatch") },
        ],
      } }] },
    }] },
    { kind: "impl", generics, target: type, trait: { kind: "named", path: "Eq" }, members: [] },
    rustProjectObjectIdentityImplementation(type, generics, {
      kind: "method-call", receiver: field("self", "dispatch"), method: "object_identity", args: [],
    }, {
      kind: "method-call", receiver: field("self", "dispatch"), method: "object_identity_key", args: [],
    }),
  ];
}
