import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustExpr, RustImplFunction, RustItem, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";
import { projectFieldStoragePath, type ProjectClassStateLayer } from "./model.js";
import { rustProjectRepresentationGenerics } from "./names.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField, rustProjectObjectStateField } from "../project-objects.js";
import { planCheckedProjectProjectionImplementation } from "../checked-project-projections.js";
import { rustProjectInstanceContracts } from "../../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { planRustErrorObjectFormatting } from "../../program/error-formatting.js";

const path = (name: string): RustExpr => ({ kind: "path", path: name });
const method = (receiver: RustExpr, name: string, ...args: readonly RustExpr[]): RustExpr =>
  ({ kind: "method-call", receiver, method: name, args });
const field = (receiver: RustExpr, name: string): RustExpr => ({ kind: "field", receiver, name });
const errorField: RustType = { kind: "named", path: "rt::ErrorField", genericArguments: [
  { kind: "lifetime", lifetime: { kind: "placeholder" } },
] };
const stackType: RustType = { kind: "named", path: "Option", genericArguments: [
  { kind: "type", type: errorField },
] };

export function rustProjectErrorSuperTraits(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
): readonly RustType[] {
  return context.input.program.projectTypes.externalBaseForDefinition(definition)?.programError === true
    ? [{ kind: "named", path: "rt::WritableRetainedErrorObject" }] : [];
}

export function planRustProjectErrorRoot(
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
  rootType: RustType,
  layers: readonly ProjectClassStateLayer[],
  context: RustPlanContext,
): readonly RustItem[] | undefined {
  const inherited = context.input.program.projectTypes.inheritedExternalBaseForDefinition(definition);
  if (inherited?.base.programError !== true) return [];
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (representation === undefined) return undefined;
  const functions: RustImplFunction[] = [];
  const setters: RustImplFunction[] = [];
  for (const name of ["name", "message", "stack"] as const) {
    const selected = inherited.base.fields.find(candidate => candidate.sourceName === name);
    const storage = selected === undefined ? undefined : projectFieldStoragePath(selected.declaration, layers, context);
    if (storage === undefined) return undefined;
    const value = storage.reduce(field, path("state"));
    const read: RustExpr = name === "stack"
      ? method(method({ kind: "call", path: "core::cell::Ref::filter_map", args: [
          method(field(path("self"), rustProjectObjectStateField), "borrow"),
          { kind: "closure", params: [{ name: "state", byRefCopy: false }], body: method(value, "as_deref") },
        ] }, "ok"), "map", path("rt::ErrorField::Project"))
      : { kind: "call", path: "rt::ErrorField::Project", args: [{
          kind: "call", path: "core::cell::Ref::map", args: [
            method(field(path("self"), rustProjectObjectStateField), "borrow"),
            { kind: "closure", params: [{ name: "state", byRefCopy: false }], body: method(value, "as_str") },
          ],
        }] };
    functions.push(errorFunction(`error_${name}`, name === "stack" ? stackType : errorField, read));
    const target = storage.reduce(field, path("state"));
    setters.push({ ...errorFunction(`set_error_${name}`, { kind: "unit" },
      method(field(path("self"), rustProjectObjectStateField), "with_mut", {
        kind: "closure", params: [{ name: "state", byRefCopy: false }],
        body: { kind: "assignment", operator: "=", target, value: path("value") },
      })), params: [{ name: "value", type: name === "stack"
        ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: { kind: "string" } }] } : { kind: "string" } }] });
  }
  functions.push(errorFunction("error_kind", { kind: "named", path: "rt::JsErrorKind" },
    path("rt::JsErrorKind::Error")));
  functions.push(errorFunction("error_identity_key", { kind: "primitive", name: "usize" },
    method(field(path("self"), rustProjectObjectIdentityField), "key")));
  const contracts = rustProjectInstanceContracts(context.input.program.projectTypes, definition, carrier);
  const projection = contracts === undefined ? undefined
    : planCheckedProjectProjectionImplementation("project_error", contracts, [], context);
  if (projection === undefined) return undefined;
  const generics = rustProjectRepresentationGenerics(representation, context);
  return [...planRustErrorObjectFormatting(rootType, generics), { kind: "impl", generics,
    trait: { kind: "named", path: "rt::ErrorObject" }, target: rootType, members: functions },
    { kind: "impl", generics,
      trait: { kind: "named", path: "rt::WritableErrorObject" }, target: rootType, members: setters },
    { kind: "impl", generics, trait: { kind: "named", path: "rt::ErrorStack" }, target: rootType,
      members: [{ ...errorFunction("set_stack", { kind: "unit" }, { kind: "call",
        path: "rt::WritableErrorObject::set_error_stack", args: [path("self"), path("value")] }),
        params: [{ name: "value", type: { kind: "named", path: "Option", genericArguments: [
          { kind: "type", type: { kind: "string" } },
        ] } }] }] },
    { kind: "impl", generics, trait: { kind: "named", path: "rt::RetainedErrorObject" },
      target: rootType, members: [projection] }];
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
  const generics = rustProjectRepresentationGenerics(representation, context);
  const retentionGenerics = { ...generics, wherePredicates: [...generics.wherePredicates,
    { kind: "type" as const, type: wrapperType, bounds: [
      { kind: "lifetime" as const, lifetime: { kind: "static" as const } },
    ] }] };
  return [{ kind: "impl", generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "rt::ErrorObject" }, target: wrapperType,
    members: [
      errorFunction("error_name", errorField, method(receiver, "error_name")),
      errorFunction("error_message", errorField, method(receiver, "error_message")),
      errorFunction("error_stack", stackType, method(receiver, "error_stack")),
      errorFunction("error_kind", { kind: "named", path: "rt::JsErrorKind" }, method(receiver, "error_kind")),
      errorFunction("error_identity_key", { kind: "primitive", name: "usize" }, method(receiver, "error_identity_key")),
    ],
  }, { kind: "impl", generics: rustProjectRepresentationGenerics(representation, context),
    trait: { kind: "named", path: "rt::WritableErrorObject" }, target: wrapperType,
    members: ["name", "message", "stack"].map(name => ({
      ...errorFunction(`set_error_${name}`, { kind: "unit" }, method(receiver, `set_error_${name}`, path("value"))),
      params: [{ name: "value", type: name === "stack" ? { kind: "named" as const, path: "Option", genericArguments: [
        { kind: "type" as const, type: { kind: "string" as const } },
      ] } : { kind: "string" as const } }],
    })) },
    ...["RetainedError", "WritableRetainedError"].map(name => ({
      kind: "impl" as const, generics: retentionGenerics,
      trait: { kind: "named" as const, path: "core::convert::From", genericArguments: [
        { kind: "type" as const, type: wrapperType },
      ] },
      target: { kind: "named" as const, path: `rt::${name}` },
      members: [{ kind: "function" as const, name: "from", visibility: "private" as const,
        generics: emptyRustGenerics, params: [{ name: "value", type: wrapperType }],
        returnType: { kind: "named" as const, path: "Self" },
        body: { statements: [{ kind: "tail" as const, expr: { kind: "call" as const,
          path: `Self::${name === "RetainedError" ? "WritableProject" : "Project"}`,
          args: [field(path("value"), rustProjectObjectDispatchField)],
        } }] },
      }],
    }))];
}

function errorFunction(name: string, returnType: RustType, value: RustExpr): RustImplFunction {
  return { kind: "function", name, visibility: "private", generics: emptyRustGenerics,
    selfParam: { kind: "reference", mutable: false }, params: [], returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
