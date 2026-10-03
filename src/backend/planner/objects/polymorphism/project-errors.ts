import type { RustProjectTypeDefinition } from "../../../../policy/types/project-types.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustExpr, RustImplFunction, RustItem, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import { projectFieldStoragePath, type ProjectClassStateLayer } from "./model.js";
import { rustProjectRepresentationGenerics } from "./names.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField, rustProjectObjectStateField } from "../project-objects.js";

const path = (name: string): RustExpr => ({ kind: "path", path: name });
const method = (receiver: RustExpr, name: string, ...args: readonly RustExpr[]): RustExpr =>
  ({ kind: "method-call", receiver, method: name, args });
const field = (receiver: RustExpr, name: string): RustExpr => ({ kind: "field", receiver, name });
const errorField: RustType = { kind: "named", path: "rt::ErrorField", genericArguments: [
  { kind: "lifetime", lifetime: { kind: "placeholder" } },
] };
const stackType: RustType = { kind: "named", path: "Option", genericArguments: [
  { kind: "type", type: { kind: "string" } },
] };

export function rustProjectErrorSuperTraits(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly RustType[] {
  return context.input.program.projectTypes.externalBaseForDefinition(definition)?.programError === true
    ? [{ kind: "named", path: "rt::ErrorObject" }] : [];
}

export function planRustProjectErrorRoot(
  definition: RustProjectTypeDefinition,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const inherited = context.input.program.projectTypes.inheritedExternalBaseForDefinition(definition);
  if (inherited?.base.programError !== true) return [];
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (representation === undefined) return undefined;
  const functions: RustImplFunction[] = [];
  for (const name of ["name", "message", "stack"] as const) {
    const selected = inherited.base.fields.find(candidate => candidate.sourceName === name);
    const storage = selected === undefined ? undefined : projectFieldStoragePath(selected.declaration, layers, context);
    if (storage === undefined) return undefined;
    const value = storage.reduce(field, path("state"));
    const read: RustExpr = name === "stack"
      ? method(field(path("self"), rustProjectObjectStateField), "with", {
          kind: "closure", params: [{ name: "state", byRefCopy: false }], body: method(value, "clone"),
        })
      : { kind: "call", path: "rt::ErrorField::Project", args: [{
          kind: "call", path: "core::cell::Ref::map", args: [
            method(field(path("self"), rustProjectObjectStateField), "borrow"),
            { kind: "closure", params: [{ name: "state", byRefCopy: false }], body: method(value, "as_str") },
          ],
        }] };
    functions.push(errorFunction(`error_${name}`, name === "stack" ? stackType : errorField, read));
  }
  functions.push(errorFunction("error_kind", { kind: "named", path: "rt::JsErrorKind" },
    path("rt::JsErrorKind::Error")));
  functions.push(errorFunction("error_identity_key", { kind: "primitive", name: "usize" },
    method(field(path("self"), rustProjectObjectIdentityField), "key")));
  return [{ kind: "impl", generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "rt::ErrorObject" }, target: rootType, members: functions }];
}

export function planRustProjectErrorWrapper(
  definition: RustProjectTypeDefinition,
  wrapperType: RustType,
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  if (context.input.program.projectTypes.inheritedExternalBaseForDefinition(definition)?.base.programError !== true) return [];
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (representation === undefined) return undefined;
  const receiver = field(path("self"), rustProjectObjectDispatchField);
  return [{ kind: "impl", generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "rt::ErrorObject" }, target: wrapperType,
    members: [
      errorFunction("error_name", errorField, method(receiver, "error_name")),
      errorFunction("error_message", errorField, method(receiver, "error_message")),
      errorFunction("error_stack", stackType, method(receiver, "error_stack")),
      errorFunction("error_kind", { kind: "named", path: "rt::JsErrorKind" }, method(receiver, "error_kind")),
      errorFunction("error_identity_key", { kind: "primitive", name: "usize" }, method(receiver, "error_identity_key")),
    ],
  }];
}

function errorFunction(name: string, returnType: RustType, value: RustExpr): RustImplFunction {
  return { kind: "function", name, visibility: "private", generics: emptyRustGenerics,
    selfParam: { kind: "reference", mutable: false }, params: [], returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
