import type { TargetTypeRef } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../rust-facts/keys.js";
import {
  isRustIntegerCarrier,
  isRustJsArrayCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  isRustVecCarrier,
  rustJsDateTargetType,
  rustJsMapTargetType,
  rustJsSetTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../rust-target-types.js";

// JS surface operation table. Rows are keyed by the identity of the selected
// lib declaration (owner interface name + member name), never by expression
// spelling: the owner/member names below describe the TypeScript lib
// declaration model, and the Rust side is runtime crate metadata.

export interface JsOperationRequest {
  readonly ownerName: string;
  readonly memberName: string;
  readonly operationKind: "call" | "property" | "indexer" | "constructor" | "property-set" | "index-set";
  readonly receiverCarrier?: TargetTypeRef;
  readonly argumentCarriers?: readonly (TargetTypeRef | undefined)[];
}

export interface JsOperationSelection {
  readonly fact: RustTargetOperationFact;
  readonly resultCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
}

const int32Carrier = rustSourcePrimitiveTargetType("int32");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const boolCarrier = rustSourcePrimitiveTargetType("bool");
const stringCarrier = rustStringTargetType();

function operationId(request: JsOperationRequest): string {
  return `tsonic.rust.js.${request.ownerName}.${request.memberName}.${request.operationKind}`;
}

function vecElement(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier !== undefined && isRustVecCarrier(carrier) ? carrier.element : undefined;
}

function jsArrayElement(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && isRustJsArrayCarrier(carrier)
    ? carrier.typeArguments?.[0]
    : undefined;
}

function copyStyle(element: TargetTypeRef): "copied" | "cloned" {
  return isRustNumericCarrier(element) || element.kind === "source-primitive" ? "copied" : "cloned";
}

function providerOperation(
  request: JsOperationRequest,
  operationKind: "method" | "constructor" | "property" | "indexer",
  target: RustTargetOperationFact & { kind: "provider-operation" } extends never ? never : Extract<RustTargetOperationFact, { kind: "provider-operation" }>["target"],
  resultCarrier: TargetTypeRef,
  extras?: { readonly castResult?: string; readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[] },
): JsOperationSelection {
  return {
    fact: {
      kind: "provider-operation",
      operationId: operationId(request),
      operationKind,
      target,
      resultCarrier,
      ...(extras?.castResult === undefined ? {} : { castResult: extras.castResult }),
    },
    resultCarrier,
    ...(extras?.parameterCarriers === undefined ? {} : { parameterCarriers: extras.parameterCarriers }),
  };
}

export function selectJsSurfaceOperation(request: JsOperationRequest): JsOperationSelection | undefined {
  const { ownerName, memberName, operationKind, receiverCarrier } = request;

  // Dense Vec<T> lane (Array interface members over proven dense carriers).
  const denseElement = vecElement(receiverCarrier);
  if (ownerName === "Array" && denseElement !== undefined) {
    if (operationKind === "property" && memberName === "length") {
      return providerOperation(request, "property", { form: "receiver-method", name: "len" }, int32Carrier, { castResult: "i32" });
    }
    if (operationKind === "call" && memberName === "push") {
      return providerOperation(request, "method", { form: "receiver-method", name: "push" }, int32Carrier, {
        castResult: "i32",
        parameterCarriers: [denseElement],
      });
    }
    if (operationKind === "call" && memberName === "includes" && isRustNumericCarrier(denseElement)) {
      return providerOperation(request, "method", {
        form: "free-call",
        path: "js_abi::array_dense_includes",
        receiverMode: "ref",
        argModes: ["ref"],
        trailingArgs: ["0"],
      }, boolCarrier, { parameterCarriers: [denseElement] });
    }
    if (operationKind === "call" && memberName === "indexOf" && isRustNumericCarrier(denseElement)) {
      return providerOperation(request, "method", {
        form: "free-call",
        path: "js_abi::array_dense_index_of",
        receiverMode: "ref",
        argModes: ["ref"],
        trailingArgs: ["0"],
      }, int32Carrier, { castResult: "i32", parameterCarriers: [denseElement] });
    }
    if (operationKind === "indexer") {
      return providerOperation(request, "indexer", {
        form: "receiver-method",
        name: "get",
        argCasts: ["usize"],
        argModes: ["value"],
        chain: [copyStyle(denseElement)],
      }, rustOptionTargetType(denseElement), { parameterCarriers: [int32Carrier] });
    }
    if (operationKind === "index-set") {
      return {
        fact: {
          kind: "runtime-set",
          operationId: operationId(request),
          target: { form: "index" },
        },
        parameterCarriers: [int32Carrier, denseElement],
      };
    }
  }

  // Sparse JsArray<T> lane.
  const sparseElement = jsArrayElement(receiverCarrier);
  if (ownerName === "Array" && sparseElement !== undefined) {
    if (operationKind === "property" && memberName === "length") {
      return providerOperation(request, "property", { form: "receiver-method", name: "len" }, int32Carrier, { castResult: "i32" });
    }
    if (operationKind === "property-set" && memberName === "length") {
      return {
        fact: {
          kind: "runtime-set",
          operationId: operationId(request),
          target: { form: "receiver-method", name: "set_len", argCasts: ["usize"] },
        },
        parameterCarriers: [int32Carrier],
      };
    }
    if (operationKind === "call" && memberName === "at") {
      return providerOperation(request, "method", {
        form: "receiver-method",
        name: "at",
        argModes: ["value"],
        argCasts: ["isize"],
        chain: [copyStyle(sparseElement)],
      }, rustOptionTargetType(sparseElement), { parameterCarriers: [int32Carrier] });
    }
    if (operationKind === "call" && memberName === "push") {
      return providerOperation(request, "method", { form: "receiver-method", name: "push" }, int32Carrier, {
        castResult: "i32",
        parameterCarriers: [sparseElement],
      });
    }
    if (operationKind === "indexer") {
      return providerOperation(request, "indexer", {
        form: "receiver-method",
        name: "get",
        argModes: ["value"],
        argCasts: ["usize"],
        chain: [copyStyle(sparseElement)],
      }, rustOptionTargetType(sparseElement), { parameterCarriers: [int32Carrier] });
    }
    if (operationKind === "index-set") {
      return {
        fact: {
          kind: "runtime-set",
          operationId: operationId(request),
          target: { form: "receiver-method", name: "set", argCasts: ["usize", undefined] },
        },
        parameterCarriers: [int32Carrier, sparseElement],
      };
    }
  }

  // String members (crate-root string module through the js_string alias).
  if (ownerName === "String" && receiverCarrier !== undefined && isRustStringCarrier(receiverCarrier)) {
    if (operationKind === "property" && memberName === "length") {
      return providerOperation(request, "property", {
        form: "free-call",
        path: "js_string::js_len",
        receiverMode: "ref",
      }, int32Carrier, { castResult: "i32" });
    }
    const zeroDefault: Record<string, string> = {
      includes: "js_string::includes",
      startsWith: "js_string::starts_with",
    };
    const stringFn = zeroDefault[memberName];
    if (operationKind === "call" && stringFn !== undefined) {
      return providerOperation(request, "method", {
        form: "free-call",
        path: stringFn,
        receiverMode: "ref",
        argModes: ["ref"],
        trailingArgs: ["0"],
      }, boolCarrier, { parameterCarriers: [stringCarrier] });
    }
    if (operationKind === "call" && memberName === "endsWith") {
      return providerOperation(request, "method", {
        form: "free-call",
        path: "js_string::ends_with",
        receiverMode: "ref",
        argModes: ["ref"],
        trailingArgs: ["None"],
      }, boolCarrier, { parameterCarriers: [stringCarrier] });
    }
    const passthrough: Record<string, string> = {
      toUpperCase: "js_string::to_upper_case",
      toLowerCase: "js_string::to_lower_case",
      trim: "js_string::trim",
    };
    const passFn = passthrough[memberName];
    if (operationKind === "call" && passFn !== undefined) {
      return providerOperation(request, "method", {
        form: "free-call",
        path: passFn,
        receiverMode: "ref",
      }, stringCarrier);
    }
  }

  // Map / Set (primitive keys and values only in this lane).
  const mapArguments = receiverCarrier?.kind === "target-named" && receiverCarrier.id === "rust.js.JsMap"
    ? receiverCarrier.typeArguments
    : undefined;
  if (ownerName === "Map" && mapArguments !== undefined && mapArguments.length === 2) {
    const [keyCarrier, valueCarrier] = mapArguments;
    if (keyCarrier === undefined || valueCarrier === undefined) {
      return undefined;
    }
    if (operationKind === "call" && memberName === "set") {
      return providerOperation(request, "method", { form: "receiver-method", name: "set" }, receiverCarrier!, {
        parameterCarriers: [keyCarrier, valueCarrier],
      });
    }
    if (operationKind === "call" && memberName === "get") {
      return providerOperation(request, "method", {
        form: "receiver-method",
        name: "get",
        argModes: ["ref"],
        chain: [copyStyle(valueCarrier)],
      }, rustOptionTargetType(valueCarrier), { parameterCarriers: [keyCarrier] });
    }
    if (operationKind === "call" && (memberName === "has" || memberName === "delete")) {
      return providerOperation(request, "method", {
        form: "receiver-method",
        name: memberName === "has" ? "has" : "delete",
        argModes: ["ref"],
      }, boolCarrier, { parameterCarriers: [keyCarrier] });
    }
    if (operationKind === "property" && memberName === "size") {
      return providerOperation(request, "property", { form: "receiver-method", name: "len" }, int32Carrier, { castResult: "i32" });
    }
  }
  const setArguments = receiverCarrier?.kind === "target-named" && receiverCarrier.id === "rust.js.JsSet"
    ? receiverCarrier.typeArguments
    : undefined;
  if (ownerName === "Set" && setArguments !== undefined && setArguments.length === 1) {
    const valueCarrier = setArguments[0];
    if (valueCarrier === undefined) {
      return undefined;
    }
    if (operationKind === "call" && memberName === "add") {
      return providerOperation(request, "method", { form: "receiver-method", name: "add" }, receiverCarrier!, {
        parameterCarriers: [valueCarrier],
      });
    }
    if (operationKind === "call" && (memberName === "has" || memberName === "delete")) {
      return providerOperation(request, "method", {
        form: "receiver-method",
        name: memberName,
        argModes: ["ref"],
      }, boolCarrier, { parameterCarriers: [valueCarrier] });
    }
    if (operationKind === "property" && memberName === "size") {
      return providerOperation(request, "property", { form: "receiver-method", name: "len" }, int32Carrier, { castResult: "i32" });
    }
  }

  // Date.
  if (ownerName === "DateConstructor" && operationKind === "call" && memberName === "now") {
    return providerOperation(request, "method", { form: "call", path: "js_abi::JsDate::now" }, float64Carrier);
  }
  if (ownerName === "Date" && operationKind === "call" && memberName === "getTime" && receiverCarrier?.kind === "target-named" && receiverCarrier.id === "rust.js.JsDate") {
    return providerOperation(request, "method", { form: "receiver-method", name: "get_time" }, float64Carrier);
  }
  return undefined;
}

export interface JsConstructorRequest {
  readonly className: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
}

export function selectJsSurfaceConstructor(request: JsConstructorRequest): JsOperationSelection | undefined {
  if (request.className === "Map" && request.argumentCarriers.length === 0) {
    const [key, value] = request.typeArgumentCarriers;
    if (key === undefined || value === undefined || !isPrimitiveLaneCarrier(key) || !isPrimitiveLaneCarrier(value)) {
      return undefined;
    }
    const carrier = rustJsMapTargetType(key, value);
    return {
      fact: {
        kind: "provider-operation",
        operationId: "tsonic.rust.js.Map.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "js_abi::JsMap::new" },
        resultCarrier: carrier,
      },
      resultCarrier: carrier,
    };
  }
  if (request.className === "Set" && request.argumentCarriers.length === 0) {
    const [value] = request.typeArgumentCarriers;
    if (value === undefined || !isPrimitiveLaneCarrier(value)) {
      return undefined;
    }
    const carrier = rustJsSetTargetType(value);
    return {
      fact: {
        kind: "provider-operation",
        operationId: "tsonic.rust.js.Set.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "js_abi::JsSet::new" },
        resultCarrier: carrier,
      },
      resultCarrier: carrier,
    };
  }
  if (request.className === "Date" && request.argumentCarriers.length === 1) {
    const carrier = rustJsDateTargetType();
    return {
      fact: {
        kind: "provider-operation",
        operationId: "tsonic.rust.js.Date.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "js_abi::JsDate::from_millis" },
        resultCarrier: carrier,
      },
      resultCarrier: carrier,
      parameterCarriers: [float64Carrier],
    };
  }
  return undefined;
}

function isPrimitiveLaneCarrier(carrier: TargetTypeRef): boolean {
  return carrier.kind === "source-primitive" || isRustStringCarrier(carrier);
}

export function isJsIntegerIndexCarrier(carrier: TargetTypeRef | undefined): boolean {
  return isRustIntegerCarrier(carrier);
}
