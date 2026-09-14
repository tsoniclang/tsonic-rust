export const rustSourceErrorConstructors = Object.freeze([
  { sourceName: "Error", ownerName: "ErrorConstructor", errorKind: "any", operationId: "tsonic.rust.error.constructor", path: "rt::JsError::error" },
  { sourceName: "RangeError", ownerName: "RangeErrorConstructor", errorKind: "RangeError", operationId: "tsonic.rust.error.range.constructor", path: "js_abi::range_error" },
  { sourceName: "TypeError", ownerName: "TypeErrorConstructor", errorKind: "TypeError", operationId: "tsonic.rust.error.type.constructor", path: "js_abi::type_error" },
  { sourceName: "URIError", ownerName: "URIErrorConstructor", errorKind: "URIError", operationId: "tsonic.rust.error.uri.constructor", path: "js_abi::uri_error" },
] as const);
