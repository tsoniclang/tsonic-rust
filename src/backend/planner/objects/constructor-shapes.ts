import type { RustStructuralShapeDefinition } from "../../../analysis/objects/structural-shape-plan.js";
import type { RustDeadCodeDisposition, RustExpr, RustGenerics, RustItem, RustTraitFunction, RustType, RustVisibility } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";
import { rustProjectObjectIdentityImplementation } from "./project-identity.js";
import { rustCallableProtocol } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function planRustConstructorShape(
  definition: RustStructuralShapeDefinition,
  generics: RustGenerics,
  type: RustType,
  visibility: RustVisibility,
  errorType: RustType,
  render: (carrier: TargetTypeRef) => RustType | undefined,
  superTraits: readonly RustType[] = [],
  fieldDeadCode: (index: number, role: "getter" | "setter") => RustDeadCodeDisposition | undefined = () => undefined,
): readonly RustItem[] | undefined {
  if (definition.dispatchName === undefined || type.kind !== "named") return undefined;
  const functions: RustTraitFunction[] = [];
  const callable = (name: string, carrier: TargetTypeRef, construction: boolean): boolean => {
    const protocol = rustCallableProtocol(carrier);
    const result = protocol === undefined ? undefined : render(protocol.result);
    const parameters = protocol?.parameters.map((parameter, index) => {
      const type = render(parameter);
      return type === undefined ? undefined : { name: `argument${index}`, type };
    });
    if (result === undefined || parameters === undefined || parameters.some(parameter => parameter === undefined)) return false;
    functions.push({ name, generics: emptyRustGenerics, selfParam: rustSelfParameter(construction || definition.construction === undefined ? "rc" : "ref"),
      params: parameters as NonNullable<typeof parameters[number]>[], returnType: result, errorType });
    return true;
  };
  if (definition.construction !== undefined && !callable(definition.construction.targetName, definition.construction.carrier, true)) return undefined;
  for (const [index, field] of definition.fields.entries()) {
    if (field.method) {
      if (!callable(field.targetName, field.carrier, false)) return undefined;
    } else {
      const selected = render(field.carrier);
      if (selected === undefined || field.property === undefined) return undefined;
      functions.push({ name: field.property.getterTargetName, generics: emptyRustGenerics,
        deadCode: fieldDeadCode(index, "getter"),
        selfParam: rustSelfParameter(field.property.selfMode), params: [], returnType: selected, errorType });
      if (field.property.setterTargetName !== undefined) functions.push({ name: field.property.setterTargetName,
        deadCode: fieldDeadCode(index, "setter"),
        generics: emptyRustGenerics, selfParam: rustSelfParameter(field.property.selfMode), params: [{ name: "value", type: selected }],
        returnType: { kind: "unit" }, errorType });
    }
  }
  const trait: RustType = { kind: "named", path: definition.dispatchName, genericArguments: type.genericArguments };
  const dispatch: RustType = { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type: {
    kind: "trait-object", principal: { trait }, autoTraits: [],
    ...(definition.genericParameters.filter(parameter => parameter.kind === "lifetime").length === 1
      ? { lifetime: { kind: "named" as const, name: definition.genericParameters.find(parameter => parameter.kind === "lifetime")!.lifetime.name } } : {}),
  } }] };
  const field = (owner: string, name: string): RustExpr => ({ kind: "field", receiver: { kind: "path", path: owner }, name });
  return [
    { kind: "trait", name: definition.dispatchName, visibility, generics, functions,
      superTraits: [{ kind: "named", path: "rt::ObjectIdentityCarrier" }, ...superTraits] },
    { kind: "struct", name: definition.targetName, visibility, generics, derives: [], fields: [
      { name: "dispatch", visibility, type: dispatch },
    ] },
    { kind: "impl", generics, target: type, trait: { kind: "named", path: "Clone" }, functions: [{
      name: "clone", visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"), params: [],
      returnType: { kind: "named", path: "Self" }, body: { statements: [{ kind: "tail", expr: {
        kind: "struct-literal", path: "Self", fields: [
          { name: "dispatch", value: { kind: "method-call", receiver: field("self", "dispatch"), method: "clone", args: [] } },
        ],
      } }] },
    }] },
    { kind: "impl", generics, target: type, trait: { kind: "named", path: "PartialEq" }, functions: [{
      name: "eq", visibility: "private", generics: emptyRustGenerics, selfParam: rustSelfParameter("ref"),
      params: [{ name: "other", type: { kind: "reference", mutable: false, referent: { kind: "named", path: "Self" } } }],
      returnType: { kind: "primitive", name: "bool" }, body: { statements: [{ kind: "tail", expr: {
        kind: "call", path: "alloc::rc::Rc::ptr_eq", args: [
          { kind: "reference", expr: field("self", "dispatch") }, { kind: "reference", expr: field("other", "dispatch") },
        ],
      } }] },
    }] },
    { kind: "impl", generics, target: type, trait: { kind: "named", path: "Eq" }, functions: [] },
    rustProjectObjectIdentityImplementation(type, generics, {
      kind: "method-call", receiver: field("self", "dispatch"), method: "object_identity", args: [],
    }, {
      kind: "method-call", receiver: field("self", "dispatch"), method: "object_identity_key", args: [],
    }),
  ];
}
