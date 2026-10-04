import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustPattern, type RustType } from "../../target-ast/nodes.js";
import type { RustErrorTransportPlan } from "./error-transport.js";
import { planCheckedNativeProjectionImplementation } from "../objects/checked-project-projections.js";
import { planRustErrorObjectFormatting } from "./error-formatting.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";

const named = (path: string, ...types: readonly RustType[]): Extract<RustType, { kind: "named" }> => ({ kind: "named", path,
  ...(types.length === 0 ? {} : { genericArguments: types.map(type => ({ kind: "type" as const, type })) }) });
const path = (path: string): RustExpr => ({ kind: "path", path });
const call = (path: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path, args });
const field = (receiver: RustExpr, name: string): RustExpr => ({ kind: "field", receiver, name });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, value: RustPattern): RustPattern => ({ kind: "tuple-variant", path: name, elements: [value] });
const nativeError = named("tsonic_rust_runtime::RetainedError");
const suppression = named("SuppressedErrorPayload");

export function planRustRetainedErrorAdmission(plan: RustErrorTransportPlan): readonly RustItem[] {
  const items: RustItem[] = [];
  for (const writable of [false, true]) {
    const source = named(writable ? "WritableSourceError" : "SourceError");
    const destination = writable ? named("tsonic_rust_runtime::WritableRetainedError") : nativeError;
    const convert = (value: RustExpr): RustExpr => call(`${(destination as Extract<RustType, { kind: "named" }>).path}::from`, value);
    const own = path("error");
    const arms: Extract<RustExpr, { kind: "match" }>["arms"] = [
      { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: writable
        ? { kind: "match", expression: own, arms: [] } : convert(own) },
      { pattern: variant("ErrorTransport::SourceCreated", binding("error")), expression: convert(own) },
      ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")),
        expression: item.source === "thrown" ? { kind: "match" as const, expression: own, arms: [] }
          : item.source === "external" && rustTypeEquals(destination, writable ? item.writableSourceErrorType : item.sourceErrorType)
            ? own : convert(own) })),
      { pattern: variant("ErrorTransport::Suppressed", binding("error")), expression: writable
        ? { kind: "match", expression: own, arms: [] }
        : call("tsonic_rust_runtime::RetainedError::Project", call("alloc::rc::Rc::new", own)) },
    ];
    items.push({ kind: "impl", generics: emptyRustGenerics, target: destination,
      trait: named("core::convert::From", source), members: [{
        kind: "function", name: "from", visibility: "private", generics: emptyRustGenerics,
        params: [{ name: "value", type: source }], returnType: named("Self"),
        body: { statements: [{ kind: "tail", expr: { kind: "match",
          expression: field(path("value"), "value"), arms } }] },
      }] });
  }
  const errorField = named("tsonic_rust_runtime::ErrorField");
  const borrowedField: RustType = { ...errorField, genericArguments: [
    { kind: "lifetime", lifetime: { kind: "placeholder" } },
  ] };
  const getters = [
    { name: "error_name", type: borrowedField },
    { name: "error_message", type: borrowedField },
    { name: "error_stack", type: named("Option", borrowedField) },
    { name: "error_kind", type: named("tsonic_rust_runtime::JsErrorKind") },
    { name: "error_identity_key", type: { kind: "primitive", name: "usize" } as RustType },
  ];
  items.push(...planRustErrorObjectFormatting(suppression, emptyRustGenerics), { kind: "impl", generics: emptyRustGenerics, target: suppression,
    trait: named("tsonic_rust_runtime::ErrorObject"),
    members: getters.map(getter => borrowedFunction(getter.name, getter.type,
      call(`tsonic_rust_runtime::ErrorObject::${getter.name}`, { kind: "reference", expr: field(path("self"), "source") }))) },
    { kind: "impl", generics: emptyRustGenerics, target: suppression,
      trait: named("tsonic_rust_runtime::ErrorStack"), members: [{
        ...borrowedFunction("set_stack", { kind: "unit" },
          call("tsonic_rust_runtime::ErrorStack::set_stack",
            { kind: "reference", expr: field(path("self"), "source") }, path("value"))),
        params: [{ name: "value", type: named("Option", { kind: "string" }) }],
      }] },
    { kind: "impl", generics: emptyRustGenerics, target: suppression,
      trait: named("tsonic_rust_runtime::RetainedErrorObject"),
      members: [planCheckedNativeProjectionImplementation("project_error", [
        named("Option", named("alloc::rc::Rc", suppression)),
      ])] });
  return items;
}

function borrowedFunction(name: string, returnType: RustType, value: RustExpr): RustImplFunction {
  return { kind: "function", name, visibility: "private", generics: emptyRustGenerics,
    selfParam: { kind: "reference", mutable: false }, params: [], returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
