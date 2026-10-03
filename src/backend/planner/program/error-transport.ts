import { rustDeriveAttributes, rustHiddenAttribute, rustListAttribute, rustWordAttribute } from "../../target-ast/attributes.js";
import { emptyRustGenerics, type RustExpr, type RustGenerics, type RustItem, type RustPattern, type RustType } from "../../target-ast/nodes.js";

export interface RustErrorTransportVariant {
  readonly name: string;
  readonly type: RustType;
  readonly source: "error" | "thrown" | "external";
  readonly sourceErrorType?: RustType;
}

export interface RustErrorTransportPlan {
  readonly variants: readonly RustErrorTransportVariant[];
  readonly generics: RustGenerics;
  readonly declarationType: RustType;
  readonly sourceErrorType: RustType;
  readonly declaration: RustItem;
  readonly aliases: readonly RustItem[];
}

const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const method = (receiver: RustExpr, name: string, ...args: readonly RustExpr[]): RustExpr =>
  ({ kind: "method-call", receiver, method: name, args });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });
const named = (name: string, ...types: readonly RustType[]): RustType => ({ kind: "named", path: name,
  ...(types.length === 0 ? {} : { genericArguments: types.map(type => ({ kind: "type" as const, type })) }) });
const sourceView = named("SourceError");
const fullTransport = named("TsonicError");
const jsError = named("tsonic_rust_runtime::JsError");
const runtimeError = named("tsonic_rust_runtime::TsonicError");
const infallible = named("core::convert::Infallible");
const payloadField = "value";

export function planRustErrorTransport(variants: readonly RustErrorTransportVariant[]): RustErrorTransportPlan | undefined {
  if (variants.some(item => item.source === "external" && item.sourceErrorType === undefined) ||
    new Set(variants.map(item => item.name)).size !== variants.length ||
    variants.some(item => item.name === "Runtime" || item.name === "Suppressed")) return undefined;
  const parameters = variants.filter(item => item.source !== "error");
  const parameterNames = new Map(parameters.map((item, index) => [item, `Payload${index}`]));
  const generics: RustGenerics = { parameters: parameters.map(item => ({ kind: "type", name: parameterNames.get(item)!, bounds: [] })),
    wherePredicates: [] };
  const declarationType = named("ErrorTransport", ...parameters.map(item => named(parameterNames.get(item)!)));
  const fullType = named("ErrorTransport", ...parameters.map(item => item.type));
  const sourceType = named("ErrorTransport", ...parameters.map(item => item.source === "thrown" ? infallible : item.sourceErrorType!));
  return {
    variants, generics, declarationType, sourceErrorType: sourceType,
    declaration: { kind: "enum", name: "ErrorTransport", visibility: "public", attrs: [rustHiddenAttribute, ...rustDeriveAttributes(["Clone"])],
      generics, variants: [
        { name: "Runtime", fields: [runtimeError] },
        ...variants.map(item => ({ name: item.name, fields: [item.source === "error" ? item.type : named(parameterNames.get(item)!)] })),
        { name: "Suppressed", fields: [named("Box", fullTransport), named("Box", fullTransport), jsError] },
      ],
    },
    aliases: [
      { kind: "type-alias", name: "TsonicError", visibility: "public", generics: emptyRustGenerics, target: fullType },
      { kind: "struct", name: "SourceError", visibility: "public", generics: emptyRustGenerics,
        attrs: [rustHiddenAttribute, rustListAttribute("repr", [rustWordAttribute("transparent")]), ...rustDeriveAttributes(["Clone"])],
        fields: [{ name: payloadField, visibility: "private", type: sourceType }] },
    ],
  };
}

export function planRustSourceErrorTransport(plan: RustErrorTransportPlan): readonly RustItem[] {
  const input = path("value");
  const own = path("error");
  const sourceConstructor = (value: RustExpr): RustExpr =>
    ({ kind: "struct-literal", path: "Self", fields: [{ name: payloadField, value }] });
  const projected = (name: string, value: RustExpr): RustExpr => call("Ok", sourceConstructor(call(`ErrorTransport::${name}`, value)));
  const arms: Extract<RustExpr, { kind: "match" }>["arms"] = [
    { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: projected("Runtime", own) },
    ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")),
      expression: item.source === "error" ? projected(item.name, own)
        : item.source === "thrown" ? call("Err", call(`ErrorTransport::${item.name}`, own))
        : { kind: "match" as const, expression: method(own, "try_into_source_error"), arms: [
            { pattern: variant("Ok", binding("source")), expression: projected(item.name, path("source")) },
            { pattern: variant("Err", binding("original")), expression: call("Err", call(`ErrorTransport::${item.name}`, path("original"))) },
          ] },
    })),
    { pattern: variant("ErrorTransport::Suppressed", binding("error"), binding("suppressed"), binding("source")),
      expression: call("Ok", sourceConstructor(call("ErrorTransport::Suppressed", own, path("suppressed"), path("source")))) },
  ];
  const restored: Extract<RustExpr, { kind: "match" }>["arms"] = [
    { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: call("ErrorTransport::Runtime", own) },
    ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")),
      expression: item.source === "thrown" ? { kind: "match" as const, expression: own, arms: [] }
        : call(`ErrorTransport::${item.name}`, item.source === "external" ? method(own, "into_transport") : own) })),
    { pattern: variant("ErrorTransport::Suppressed", binding("error"), binding("suppressed"), binding("source")),
      expression: call("ErrorTransport::Suppressed", own, path("suppressed"), path("source")) },
  ];
  const fromVariant = (source: RustType, name: string, runtime: boolean): RustItem => ({
    kind: "impl", generics: emptyRustGenerics, target: sourceView, trait: named("core::convert::From", source),
    members: [nativeFunction("from", sourceView, sourceConstructor(call(`ErrorTransport::${name}`,
      runtime ? call("tsonic_rust_runtime::TsonicError::from", input) : input)), [{ name: "value", type: source }])],
  });
  return [
    { kind: "impl", generics: emptyRustGenerics, target: sourceView,
      trait: named("core::convert::TryFrom", fullTransport), members: [
        { kind: "type", name: "Error", type: fullTransport },
        nativeFunction("try_from", named("Result", sourceView, fullTransport), { kind: "match", expression: input, arms },
          [{ name: "value", type: fullTransport }]),
      ] },
    { kind: "impl", generics: emptyRustGenerics, target: fullTransport, trait: named("core::convert::From", sourceView), members: [
      nativeFunction("from", fullTransport, { kind: "match", expression: { kind: "field", receiver: input, name: payloadField }, arms: restored },
        [{ name: "value", type: sourceView }]),
    ] },
    fromVariant(jsError, "Runtime", true), fromVariant(runtimeError, "Runtime", false),
    ...plan.variants.filter(item => item.source !== "thrown").map(item =>
      fromVariant(item.source === "external" ? item.sourceErrorType! : item.type, item.name, false)),
    { kind: "impl", generics: emptyRustGenerics, target: fullTransport, members: [
      { ...nativeFunction("try_into_source_error", named("Result", sourceView, fullTransport),
          call("SourceError::try_from", path("self")), []),
        visibility: "public", selfParam: { kind: "value" } },
    ] },
    { kind: "impl", generics: emptyRustGenerics, target: sourceView, members: [
      { ...nativeFunction("as_transport", { kind: "reference", mutable: false, referent: plan.sourceErrorType },
          { kind: "reference", expr: { kind: "field", receiver: path("self"), name: payloadField } }, []),
        visibility: "public", selfParam: { kind: "reference", mutable: false } },
      { ...nativeFunction("into_transport", fullTransport, call("TsonicError::from", path("self")), []),
        visibility: "public", selfParam: { kind: "value" } },
    ] },
  ];
}

export function rustErrorTransportDisplayGenerics(plan: RustErrorTransportPlan): RustGenerics {
  const parameters = plan.variants.filter(variant => variant.source !== "error");
  return { ...plan.generics, parameters: plan.generics.parameters.map((parameter, index) => {
    const item = parameters[index];
    return parameter.kind !== "type" || item?.source !== "external" ? parameter
      : { ...parameter, bounds: [{ kind: "trait", path: "core::fmt::Display" }] };
  }) };
}

function nativeFunction(
  name: string, returnType: RustType, value: RustExpr,
  params: readonly { readonly name: string; readonly type: RustType }[],
): Extract<RustItem, { kind: "impl" }>["members"][number] & { readonly kind: "function" } {
  return { kind: "function", name, visibility: "private", generics: emptyRustGenerics, params, returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
