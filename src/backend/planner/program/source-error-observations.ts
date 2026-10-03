import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustPattern, type RustType } from "../../target-ast/nodes.js";
import type { RustErrorTransportPlan } from "./error-transport.js";

const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const method = (receiver: RustExpr, name: string, ...args: readonly RustExpr[]): RustExpr =>
  ({ kind: "method-call", receiver, method: name, args });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const named = (name: string): RustType => ({ kind: "named", path: name });
const boolean: RustType = { kind: "primitive", name: "bool" };
const errorField: RustType = { kind: "named", path: "tsonic_rust_runtime::ErrorField", genericArguments: [
  { kind: "lifetime", lifetime: { kind: "placeholder" } },
] };
const stack: RustType = { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: errorField }] };
const getters: readonly { readonly name: string; readonly native: string; readonly type: RustType }[] = [
  { name: "name", native: "error_name", type: errorField },
  { name: "message", native: "error_message", type: errorField },
  { name: "stack", native: "error_stack", type: stack },
  { name: "kind", native: "error_kind", type: named("tsonic_rust_runtime::JsErrorKind") },
  { name: "identity_key", native: "error_identity_key", type: { kind: "primitive", name: "usize" } },
];

export function planRustSourceErrorObservations(plan: RustErrorTransportPlan, writable = false): readonly RustItem[] {
  const source = named(writable ? "WritableSourceError" : "SourceError");
  const functions = getters.map(getter => observation(getter.name, getter.type, {
    kind: "match", expression: method(path("self"), "as_transport"), arms: [
      { pattern: variant("ErrorTransport::Runtime", binding("error")),
        expression: writable ? { kind: "match", expression: { kind: "dereference", pointer: path("error") }, arms: [] }
          : call(`tsonic_rust_runtime::ErrorObject::${getter.native}`, method(path("error"), "source_error")) },
      { pattern: variant("ErrorTransport::SourceCreated", binding("error")),
        expression: call(`tsonic_rust_runtime::ErrorObject::${getter.native}`, path("error")) },
      ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")),
        expression: item.source === "thrown"
          ? { kind: "match" as const, expression: { kind: "dereference" as const, pointer: path("error") }, arms: [] }
          : call(`tsonic_rust_runtime::ErrorObject::${getter.native}`, path("error")) })),
      { pattern: variant("ErrorTransport::Suppressed", { kind: "wildcard" }, { kind: "wildcard" }, binding("source")),
        expression: writable ? { kind: "match", expression: { kind: "dereference", pointer: path("source") }, arms: [] }
          : call(`tsonic_rust_runtime::ErrorObject::${getter.native}`, path("source")) },
    ],
  }));
  functions.push(observation("is_error", boolean, { kind: "bool-literal", value: true }));
  const jsError = named("tsonic_rust_runtime::JsError");
  functions.push(observation("native_error_value", { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: jsError }] }, {
    kind: "match", expression: method(path("self"), "as_transport"), arms: [
      { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: call("Some", method(method(path("error"), "source_error"), "clone")) },
      { pattern: variant("ErrorTransport::SourceCreated", { kind: "wildcard" }), expression: { kind: "none" } },
      ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`,
          item.source === "error" ? { kind: "wildcard" as const } : binding("error")),
        expression: item.source === "thrown"
          ? { kind: "match" as const, expression: { kind: "dereference" as const, pointer: path("error") }, arms: [] }
          : item.source === "external" ? method(path("error"), "native_error_value") : { kind: "none" as const } })),
      { pattern: variant("ErrorTransport::Suppressed", { kind: "wildcard" }, { kind: "wildcard" }, binding("source")),
        expression: call("Some", method(path("source"), "clone")) },
    ],
  }));
  if (writable) {
    const native = functions.find(item => item.name === "native_error_value")!;
    functions[functions.indexOf(native)] = observation("native_error_value", { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: jsError }] }, { kind: "none" });
  }
  functions.push(observation("is_error_kind", boolean, { kind: "binary", operator: "==",
    left: method(path("self"), "kind"), right: path("kind") }, [{ name: "kind", type: named("tsonic_rust_runtime::JsErrorKind") }]));
  const other: RustType = { kind: "reference", mutable: false, referent: source };
  for (const [name, operator] of [["has_same_identity", "=="], ["has_distinct_identity", "!="]] as const) {
    functions.push(observation(name, boolean, { kind: "binary", operator,
      left: method(path("self"), "identity_key"), right: method(path("other"), "identity_key") }, [{ name: "other", type: other }]));
  }
  const items: RustItem[] = [
    { kind: "impl", generics: emptyRustGenerics, target: source, members: functions },
    { kind: "impl", generics: emptyRustGenerics, target: source, trait: named("tsonic_rust_runtime::ErrorObject"),
      members: getters.map(getter => ({ ...observation(getter.native, getter.type,
        method(path("self"), getter.name)), visibility: "private" })) },
  ];
  if (writable) {
    items.push({ kind: "impl", generics: emptyRustGenerics, target: source,
      trait: named("tsonic_rust_runtime::WritableErrorObject"), members: ["name", "message", "stack"].map(name => ({
        ...observation(`set_error_${name}`, { kind: "unit" }, { kind: "match", expression: method(path("self"), "as_transport"), arms: [
          { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: { kind: "match", expression: { kind: "dereference", pointer: path("error") }, arms: [] } },
          { pattern: variant("ErrorTransport::SourceCreated", binding("error")), expression: call(`tsonic_rust_runtime::WritableErrorObject::set_error_${name}`, path("error"), path("value")) },
          ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")), expression: item.source === "thrown"
            ? { kind: "match" as const, expression: { kind: "dereference" as const, pointer: path("error") }, arms: [] }
            : call(`tsonic_rust_runtime::WritableErrorObject::set_error_${name}`, path("error"), path("value")) })),
          { pattern: variant("ErrorTransport::Suppressed", { kind: "wildcard" }, { kind: "wildcard" }, binding("source")), expression: { kind: "match", expression: { kind: "dereference", pointer: path("source") }, arms: [] } },
        ] }, [{ name: "value", type: name === "stack" ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: { kind: "string" } }] } : { kind: "string" } }]),
        visibility: "private" as const,
      })) });
  }
  const formatterType: RustType = { kind: "reference", mutable: true, referent: {
    kind: "named", path: "core::fmt::Formatter", genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
  } };
  for (const trait of ["core::fmt::Display", "core::fmt::Debug"] as const) {
    items.push({ kind: "impl", generics: emptyRustGenerics, target: source, trait: named(trait),
      members: [{ ...observation("fmt", named("core::fmt::Result"), {
        kind: "format-write", writer: path("formatter"), format: "{}: {}",
        args: [method(path("self"), "name"), method(path("self"), "message")],
      }, [{ name: "formatter", type: formatterType }]), visibility: "private" }] });
  }
  items.push({ kind: "impl", generics: emptyRustGenerics, target: source, trait: named("core::error::Error"), members: [] },
    { kind: "impl", generics: emptyRustGenerics, target: source, trait: named("tsonic_rust_runtime::ToSourceString"),
      members: [{ ...observation("to_source_string", { kind: "string" }, method(path("self"), "to_string")), visibility: "private" }] },
    { kind: "impl", generics: emptyRustGenerics, target: source, trait: named("PartialEq"),
      members: [{ ...observation("eq", boolean, method(path("self"), "has_same_identity", path("other")), [{ name: "other", type: other }]), visibility: "private" }] },
    { kind: "impl", generics: emptyRustGenerics, target: source, trait: named("Eq"), members: [] });
  return items;
}

function observation(
  name: string, returnType: RustType, value: RustExpr,
  params: readonly { readonly name: string; readonly type: RustType }[] = [],
): RustImplFunction {
  return { kind: "function", name, visibility: "public", generics: emptyRustGenerics,
    selfParam: { kind: "reference", mutable: false }, params, returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
