import { rustDeriveAttributes, rustHiddenAttribute, rustListAttribute, rustWordAttribute } from "../../target-ast/attributes.js";
import { emptyRustGenerics, type RustExpr, type RustGenerics, type RustItem, type RustPattern, type RustType } from "../../target-ast/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";

export interface RustErrorTransportVariant {
  readonly name: string;
  readonly type: RustType;
  readonly source: "error" | "thrown" | "external";
  readonly sourceErrorType?: RustType;
  readonly writableSourceErrorType?: RustType;
}

export interface RustErrorTransportPlan {
  readonly variants: readonly RustErrorTransportVariant[];
  readonly generics: RustGenerics;
  readonly fullTransportType: RustType;
  readonly sourceErrorType: RustType;
  readonly writableSourceErrorType: RustType;
  readonly declaration: RustItem;
  readonly aliases: readonly RustItem[];
}

const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });
const named = (name: string, ...types: readonly RustType[]): RustType => ({ kind: "named", path: name,
  ...(types.length === 0 ? {} : { genericArguments: types.map(type => ({ kind: "type" as const, type })) }) });
const sourceView = named("SourceError");
const writableView = named("WritableSourceError");
const fullTransport = named("TsonicError");
const jsError = named("tsonic_rust_runtime::JsError");
const runtimeError = named("tsonic_rust_runtime::TsonicError");
const mutableError = named("tsonic_rust_runtime::MutableJsError");
const infallible = named("core::convert::Infallible");
const payloadField = "value";

export function rustSuppressedErrorPattern(
  writable: boolean,
  error: RustPattern,
  suppressed: RustPattern,
  source: RustPattern,
): RustPattern {
  return variant("ErrorTransport::Suppressed", writable ? source : { kind: "struct", path: "SuppressedErrorPayload",
    fields: [{ name: "error", pattern: error }, { name: "suppressed", pattern: suppressed }, { name: "source", pattern: source }] });
}

export function rustSuppressedErrorValue(error: RustExpr, suppressed: RustExpr, source: RustExpr): RustExpr {
  return call("ErrorTransport::Suppressed", { kind: "struct-literal", path: "SuppressedErrorPayload",
    fields: [{ name: "error", value: error }, { name: "suppressed", value: suppressed }, { name: "source", value: source }] });
}

export function planRustErrorTransport(variants: readonly RustErrorTransportVariant[]): RustErrorTransportPlan | undefined {
  if (variants.some(item => item.source === "external" && (item.sourceErrorType?.kind !== "named" || item.writableSourceErrorType?.kind !== "named")) ||
    new Set(variants.map(item => item.name)).size !== variants.length ||
    variants.some(item => item.name === "Runtime" || item.name === "SourceCreated" || item.name === "Suppressed")) return undefined;
  const parameters = variants.filter(item => item.source !== "error");
  const parameterNames = new Map(parameters.map((item, index) => [item, `Payload${index}`]));
  const generics: RustGenerics = { parameters: ["RuntimePayload", "SourceCreatedPayload", "SuppressedPayload", ...parameters.map(item => parameterNames.get(item)!)].map(name => ({ kind: "type", name, bounds: [] })),
    wherePredicates: [] };
  const suppression = named("SuppressedErrorPayload");
  const fullType = named("ErrorTransport", runtimeError, mutableError, suppression, ...parameters.map(item => item.type));
  const sourceType = named("ErrorTransport", runtimeError, mutableError, suppression, ...parameters.map(item => item.source === "thrown" ? infallible : item.sourceErrorType!));
  const writableType = named("ErrorTransport", infallible, mutableError, infallible, ...parameters.map(item => item.source === "thrown" ? infallible : item.writableSourceErrorType!));
  return {
    variants, generics, fullTransportType: fullType, sourceErrorType: sourceType, writableSourceErrorType: writableType,
    declaration: { kind: "enum", name: "ErrorTransport", visibility: "public", attrs: [rustHiddenAttribute, ...rustDeriveAttributes(["Clone"])],
      generics, variants: [
        { name: "Runtime", fields: [named("RuntimePayload")] },
        { name: "SourceCreated", fields: [named("SourceCreatedPayload")] },
        ...variants.map(item => ({ name: item.name, fields: [item.source === "error" ? item.type : named(parameterNames.get(item)!)] })),
        { name: "Suppressed", fields: [named("SuppressedPayload")] },
      ],
    },
    aliases: [
      { kind: "struct", name: "SuppressedErrorPayload", visibility: "public", generics: emptyRustGenerics,
        attrs: [rustHiddenAttribute, ...rustDeriveAttributes(["Clone"])], fields: [
          { name: "error", visibility: "private", type: named("Box", fullTransport) },
          { name: "suppressed", visibility: "private", type: named("Box", fullTransport) },
          { name: "source", visibility: "private", type: jsError },
        ] },
      { kind: "type-alias", name: "TsonicError", visibility: "public", generics: emptyRustGenerics, target: fullType },
      { kind: "struct", name: "SourceError", visibility: "public", generics: emptyRustGenerics,
        attrs: [rustHiddenAttribute, rustListAttribute("repr", [rustWordAttribute("transparent")]), ...rustDeriveAttributes(["Clone"])],
        fields: [{ name: payloadField, visibility: "private", type: sourceType }] },
      { kind: "struct", name: "WritableSourceError", visibility: "public", generics: emptyRustGenerics,
        attrs: [rustHiddenAttribute, rustListAttribute("repr", [rustWordAttribute("transparent")]), ...rustDeriveAttributes(["Clone"])],
        fields: [{ name: payloadField, visibility: "private", type: writableType }] },
    ],
  };
}

export function planRustSourceErrorTransport(plan: RustErrorTransportPlan, writable = false): readonly RustItem[] {
  const view = writable ? writableView : sourceView;
  const input = path("value");
  const own = path("error");
  const sourceConstructor = (value: RustExpr): RustExpr =>
    ({ kind: "struct-literal", path: "Self", fields: [{ name: payloadField, value }] });
  const projected = (name: string, value: RustExpr): RustExpr => call("Ok", sourceConstructor(call(`ErrorTransport::${name}`, value)));
  const arms: Extract<RustExpr, { kind: "match" }>["arms"] = [
    { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: writable
      ? call("Err", call("ErrorTransport::Runtime", own)) : projected("Runtime", own) },
    { pattern: variant("ErrorTransport::SourceCreated", binding("error")), expression: projected("SourceCreated", own) },
    ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")),
      expression: item.source === "error" ? projected(item.name, own)
        : item.source === "thrown" ? call("Err", call(`ErrorTransport::${item.name}`, own))
        : rustTypeEquals(item.type, writable ? item.writableSourceErrorType : item.sourceErrorType) ? projected(item.name, own)
        : { kind: "match" as const, expression: call(`${((writable ? item.writableSourceErrorType : item.sourceErrorType) as Extract<RustType, { kind: "named" }>).path}::try_from`, own), arms: [
            { pattern: variant("Ok", binding("source")), expression: projected(item.name, path("source")) },
            { pattern: variant("Err", binding("original")), expression: call("Err", call(`ErrorTransport::${item.name}`, path("original"))) },
          ] },
    })),
    { pattern: variant("ErrorTransport::Suppressed", binding("suppression")),
      expression: writable ? call("Err", call("ErrorTransport::Suppressed", path("suppression")))
        : call("Ok", sourceConstructor(call("ErrorTransport::Suppressed", path("suppression")))) },
  ];
  const restored: Extract<RustExpr, { kind: "match" }>["arms"] = [
    { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: writable
      ? { kind: "match", expression: own, arms: [] } : call("ErrorTransport::Runtime", own) },
    { pattern: variant("ErrorTransport::SourceCreated", binding("error")), expression: call("ErrorTransport::SourceCreated", own) },
    ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")),
      expression: item.source === "thrown" ? { kind: "match" as const, expression: own, arms: [] }
        : call(`ErrorTransport::${item.name}`, item.source === "external" &&
          !rustTypeEquals(item.type, writable ? item.writableSourceErrorType : item.sourceErrorType)
          ? call(`${(item.type as Extract<RustType, { kind: "named" }>).path}::from`, own) : own) })),
    { pattern: variant("ErrorTransport::Suppressed", binding("source")),
      expression: writable ? { kind: "match", expression: path("source"), arms: [] }
        : call("ErrorTransport::Suppressed", path("source")) },
  ];
  const fromVariant = (source: RustType, name: string, runtime: boolean): RustItem => ({
    kind: "impl", generics: emptyRustGenerics, target: view, trait: named("core::convert::From", source),
    members: [nativeFunction("from", view, sourceConstructor(call(`ErrorTransport::${name}`,
      runtime ? call("tsonic_rust_runtime::TsonicError::from", input) : input)), [{ name: "value", type: source }])],
  });
  const readonlyAdmission: RustItem[] = writable ? [] : [{
    kind: "impl", generics: emptyRustGenerics, target: sourceView, trait: named("core::convert::From", writableView), members: [
      nativeFunction("from", sourceView, sourceConstructor({ kind: "match", expression: { kind: "field", receiver: input, name: payloadField }, arms: [
        { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: { kind: "match", expression: own, arms: [] } },
        { pattern: variant("ErrorTransport::SourceCreated", binding("error")), expression: call("ErrorTransport::SourceCreated", own) },
        ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, binding("error")), expression: item.source === "thrown"
          ? { kind: "match" as const, expression: own, arms: [] }
          : call(`ErrorTransport::${item.name}`, item.source === "external"
            ? call(`${(item.sourceErrorType as Extract<RustType, { kind: "named" }>).path}::from`, own) : own) })),
        { pattern: variant("ErrorTransport::Suppressed", binding("source")),
          expression: { kind: "match", expression: path("source"), arms: [] } },
      ] }), [{ name: "value", type: writableView }]),
    ],
  }];
  return [
    ...readonlyAdmission,
    { kind: "impl", generics: emptyRustGenerics, target: view,
      trait: named("core::convert::TryFrom", fullTransport), members: [
        { kind: "type", name: "Error", type: fullTransport },
        nativeFunction("try_from", named("Result", view, fullTransport), { kind: "match", expression: input, arms },
          [{ name: "value", type: fullTransport }]),
      ] },
    { kind: "impl", generics: emptyRustGenerics, target: fullTransport, trait: named("core::convert::From", view), members: [
      nativeFunction("from", fullTransport, { kind: "match", expression: { kind: "field", receiver: input, name: payloadField }, arms: restored },
        [{ name: "value", type: view }]),
    ] },
    ...writable ? [] : [fromVariant(jsError, "Runtime", true), fromVariant(runtimeError, "Runtime", false)],
    fromVariant(mutableError, "SourceCreated", false),
    ...plan.variants.filter(item => item.source !== "thrown").map(item =>
      fromVariant(item.source === "external" ? writable ? item.writableSourceErrorType! : item.sourceErrorType! : item.type, item.name, false)),
    { kind: "impl", generics: emptyRustGenerics, target: view, members: [
      { ...nativeFunction("as_transport", { kind: "reference", mutable: false, referent: writable ? plan.writableSourceErrorType : plan.sourceErrorType },
          { kind: "reference", expr: { kind: "field", receiver: path("self"), name: payloadField } }, []),
        visibility: "public", selfParam: { kind: "reference", mutable: false } },
      { ...nativeFunction("into_transport", fullTransport, call("TsonicError::from", path("self")), []),
        visibility: "public", selfParam: { kind: "value" } },
      { ...nativeFunction("into_admitted_transport", writable ? plan.writableSourceErrorType : plan.sourceErrorType,
          { kind: "field", receiver: path("self"), name: payloadField }, []),
        visibility: "public", selfParam: { kind: "value" } },
    ] },
  ];
}

function nativeFunction(
  name: string, returnType: RustType, value: RustExpr,
  params: readonly { readonly name: string; readonly type: RustType }[],
): Extract<RustItem, { kind: "impl" }>["members"][number] & { readonly kind: "function" } {
  return { kind: "function", name, visibility: "private", generics: emptyRustGenerics, params, returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
