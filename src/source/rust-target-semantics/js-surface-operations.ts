import type { TargetTypeRef } from "@tsonic/tsts";
import type { RustProviderOperationForm, RustTargetOperationFact } from "../rust-facts/keys.js";
import {
  isRustJsArrayCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  isRustVecCarrier,
  rustJsDateTargetId,
  rustJsDateTargetType,
  rustJsMapTargetId,
  rustJsMapTargetType,
  rustJsSetTargetId,
  rustJsSetTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../rust-target-types.js";

// Declarative JS surface operation rows. Rows are matched by the identity of
// the selected lib declaration (owner interface + member name) and the
// receiver carrier lane; the generic matcher below contains no per-name
// branching. Concrete owner/member spellings and Rust operation shapes exist
// only as row data.

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

type JsLane = "vec" | "js-array" | "string" | "map" | "set" | "date";

type JsCarrierRef =
  | { readonly ref: "int32" }
  | { readonly ref: "float64" }
  | { readonly ref: "bool" }
  | { readonly ref: "string" }
  | { readonly ref: "element" }
  | { readonly ref: "option-of-element" }
  | { readonly ref: "receiver" }
  | { readonly ref: "map-key" }
  | { readonly ref: "map-value" }
  | { readonly ref: "option-of-map-value" }
  | { readonly ref: "set-value" };

// "@copy" in a chain resolves to copied/cloned from the referenced carrier.
interface JsOperationRowData {
  readonly owner: string;
  readonly member: string;
  readonly operationKind: JsOperationRequest["operationKind"];
  readonly lane: JsLane;
  readonly elementGuard?: "numeric";
  readonly requiresOwnership?: readonly ("owned" | "borrowed" | "borrowed-mut")[];
  readonly shape:
    | {
        readonly op: "operation";
        readonly operationKind: "method" | "constructor" | "property" | "indexer";
        readonly target: RustProviderOperationForm;
        readonly castResult?: string;
        readonly result: JsCarrierRef;
        readonly params?: readonly JsCarrierRef[];
      }
    | {
        readonly op: "set";
        readonly target: RustProviderOperationForm;
        readonly params: readonly JsCarrierRef[];
      };
}

const jsOperationRows: readonly JsOperationRowData[] = [
  // Dense Vec<T> lane.
  { owner: "Array", member: "length", operationKind: "property", lane: "vec", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, castResult: "i32", result: { ref: "int32" } } },
  { owner: "Array", member: "push", operationKind: "call", lane: "vec", requiresOwnership: ["owned"], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "push" }, castResult: "i32", result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "includes", operationKind: "call", lane: "vec", elementGuard: "numeric", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::array_dense_includes", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["0"] }, result: { ref: "bool" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "indexOf", operationKind: "call", lane: "vec", elementGuard: "numeric", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::array_dense_index_of", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["0"] }, castResult: "i32", result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "indexer", lane: "vec", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get", argModes: ["value"], argCasts: ["usize"], chain: ["@copy"] }, result: { ref: "option-of-element" }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "index", operationKind: "index-set", lane: "vec", requiresOwnership: ["owned", "borrowed-mut"], shape: { op: "set", target: { form: "index" }, params: [{ ref: "int32" }, { ref: "element" }] } },

  // ReadonlyArray rows: read-only operations over dense/slice lanes.
  { owner: "ReadonlyArray", member: "length", operationKind: "property", lane: "vec", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, castResult: "i32", result: { ref: "int32" } } },
  { owner: "ReadonlyArray", member: "includes", operationKind: "call", lane: "vec", elementGuard: "numeric", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::array_dense_includes", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["0"] }, result: { ref: "bool" }, params: [{ ref: "element" }] } },
  { owner: "ReadonlyArray", member: "indexOf", operationKind: "call", lane: "vec", elementGuard: "numeric", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::array_dense_index_of", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["0"] }, castResult: "i32", result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner: "ReadonlyArray", member: "index", operationKind: "indexer", lane: "vec", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get", argModes: ["value"], argCasts: ["usize"], chain: ["@copy"] }, result: { ref: "option-of-element" }, params: [{ ref: "int32" }] } },

  // Sparse JsArray<T> lane.
  { owner: "Array", member: "length", operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, castResult: "i32", result: { ref: "int32" } } },
  { owner: "Array", member: "length", operationKind: "property-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set_len", argCasts: ["usize"] }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "at", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "at", argModes: ["value"], argCasts: ["isize"], chain: ["@copy"] }, result: { ref: "option-of-element" }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "push", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "push" }, castResult: "i32", result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "indexer", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get", argModes: ["value"], argCasts: ["usize"], chain: ["@copy"] }, result: { ref: "option-of-element" }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "index", operationKind: "index-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set", argCasts: ["usize", undefined] }, params: [{ ref: "int32" }, { ref: "element" }] } },

  // String lane (runtime string module through the js_string alias).
  { owner: "String", member: "length", operationKind: "property", lane: "string", shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_string::js_len", receiverMode: "ref" }, castResult: "i32", result: { ref: "int32" } } },
  { owner: "String", member: "includes", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::includes", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["0"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "startsWith", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::starts_with", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["0"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "endsWith", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::ends_with", receiverMode: "ref", argModes: ["ref"], trailingArgs: ["None"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "toUpperCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_upper_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "toLowerCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_lower_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "trim", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim", receiverMode: "ref" }, result: { ref: "string" } } },

  // Map lane.
  { owner: "Map", member: "set", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set" }, result: { ref: "receiver" }, params: [{ ref: "map-key" }, { ref: "map-value" }] } },
  { owner: "Map", member: "get", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"], chain: ["@copy"] }, result: { ref: "option-of-map-value" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "has", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "delete", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "size", operationKind: "property", lane: "map", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, castResult: "i32", result: { ref: "int32" } } },

  // Set lane.
  { owner: "Set", member: "add", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "has", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "size", operationKind: "property", lane: "set", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, castResult: "i32", result: { ref: "int32" } } },

  // Date lane.
  { owner: "DateConstructor", member: "now", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::now" }, result: { ref: "float64" } } },
  { owner: "Date", member: "getTime", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
];

interface JsLaneBindings {
  readonly element?: TargetTypeRef;
  readonly mapKey?: TargetTypeRef;
  readonly mapValue?: TargetTypeRef;
  readonly setValue?: TargetTypeRef;
  readonly receiver?: TargetTypeRef;
  readonly receiverOwnership?: "owned" | "borrowed" | "borrowed-mut";
}

function laneOf(carrier: TargetTypeRef | undefined, ownerName: string): { readonly lane: JsLane; readonly bindings: JsLaneBindings } | undefined {
  if (carrier !== undefined && isRustVecCarrier(carrier)) {
    return { lane: "vec", bindings: { element: carrier.element, receiver: carrier, receiverOwnership: "owned" } };
  }
  if (carrier?.kind === "pointer" && carrier.pointee.kind === "array") {
    const element = carrier.pointee.element;
    const receiverOwnership = carrier.mutability === "mut" ? "borrowed-mut" : "borrowed";
    return { lane: "vec", bindings: { element, receiver: carrier, receiverOwnership } };
  }
  if (carrier?.kind === "target-named") {
    if (isRustJsArrayCarrier(carrier)) {
      const element = carrier.typeArguments?.[0];
      return element === undefined ? undefined : { lane: "js-array", bindings: { element, receiver: carrier } };
    }
    if (carrier.id === rustJsMapTargetId) {
      const [mapKey, mapValue] = carrier.typeArguments ?? [];
      return mapKey === undefined || mapValue === undefined
        ? undefined
        : { lane: "map", bindings: { mapKey, mapValue, receiver: carrier } };
    }
    if (carrier.id === rustJsSetTargetId) {
      const setValue = carrier.typeArguments?.[0];
      return setValue === undefined ? undefined : { lane: "set", bindings: { setValue, receiver: carrier } };
    }
    if (carrier.id === rustJsDateTargetId) {
      return { lane: "date", bindings: { receiver: carrier } };
    }
  }
  if (isRustStringCarrier(carrier)) {
    return { lane: "string", bindings: { receiver: carrier } };
  }
  // Static owners have no receiver carrier; the lane comes from the owner row.
  if (carrier === undefined && ownerName === "DateConstructor") {
    return { lane: "date", bindings: {} };
  }
  return undefined;
}

function resolveCarrierRef(reference: JsCarrierRef, bindings: JsLaneBindings): TargetTypeRef | undefined {
  switch (reference.ref) {
    case "int32":
      return rustSourcePrimitiveTargetType("int32");
    case "float64":
      return rustSourcePrimitiveTargetType("float64");
    case "bool":
      return rustSourcePrimitiveTargetType("bool");
    case "string":
      return rustStringTargetType();
    case "element":
      return bindings.element;
    case "option-of-element":
      return bindings.element === undefined ? undefined : rustOptionTargetType(bindings.element);
    case "receiver":
      return bindings.receiver;
    case "map-key":
      return bindings.mapKey;
    case "map-value":
      return bindings.mapValue;
    case "option-of-map-value":
      return bindings.mapValue === undefined ? undefined : rustOptionTargetType(bindings.mapValue);
    case "set-value":
      return bindings.setValue;
  }
}

function copyStyleOf(carrier: TargetTypeRef | undefined): "copied" | "cloned" {
  return carrier !== undefined && (carrier.kind === "source-primitive" || isRustNumericCarrier(carrier)) ? "copied" : "cloned";
}

function materializeTarget(
  target: RustProviderOperationForm,
  copyCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm {
  if (target.form !== "receiver-method" || target.chain === undefined) {
    return target;
  }
  return {
    ...target,
    chain: target.chain.map((entry) => (entry === "@copy" ? copyStyleOf(copyCarrier) : entry)),
  };
}

export function selectJsSurfaceOperation(request: JsOperationRequest): JsOperationSelection | undefined {
  const laneMatch = laneOf(request.receiverCarrier, request.ownerName);
  if (laneMatch === undefined) {
    return undefined;
  }
  const { lane, bindings } = laneMatch;
  const row = jsOperationRows.find((candidate) =>
    candidate.owner === request.ownerName &&
    candidate.member === request.memberName &&
    candidate.operationKind === request.operationKind &&
    candidate.lane === lane &&
    (candidate.elementGuard !== "numeric" || isRustNumericCarrier(bindings.element)) &&
    (candidate.requiresOwnership === undefined ||
      (bindings.receiverOwnership !== undefined && candidate.requiresOwnership.includes(bindings.receiverOwnership))));
  if (row === undefined) {
    return undefined;
  }
  const operationId = `tsonic.rust.js.${row.owner}.${row.member}.${row.operationKind}`;
  const parameterCarriers = (row.shape.params ?? []).map((reference) => resolveCarrierRef(reference, bindings));
  if (row.shape.op === "set") {
    return {
      fact: { kind: "runtime-set", operationId, target: row.shape.target },
      parameterCarriers,
    };
  }
  const resultCarrier = resolveCarrierRef(row.shape.result, bindings);
  if (resultCarrier === undefined) {
    return undefined;
  }
  const copyReference = row.shape.result.ref === "option-of-map-value" ? bindings.mapValue : bindings.element;
  return {
    fact: {
      kind: "provider-operation",
      operationId,
      operationKind: row.shape.operationKind,
      target: materializeTarget(row.shape.target, copyReference),
      resultCarrier,
      ...(row.shape.castResult === undefined ? {} : { castResult: row.shape.castResult }),
    },
    resultCarrier,
    parameterCarriers,
  };
}

// Constructor rows: matched by lib class declaration identity plus argument
// and type-argument shape guards.
interface JsConstructorRowData {
  readonly className: string;
  readonly typeArgumentCount: number;
  readonly argumentCount: number;
  readonly path: string;
  readonly result: "map" | "set" | "date";
  readonly params?: readonly JsCarrierRef[];
}

const jsConstructorRows: readonly JsConstructorRowData[] = [
  { className: "Map", typeArgumentCount: 2, argumentCount: 0, path: "js_abi::JsMap::new", result: "map" },
  { className: "Set", typeArgumentCount: 1, argumentCount: 0, path: "js_abi::JsSet::new", result: "set" },
  { className: "Date", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::JsDate::from_millis", result: "date", params: [{ ref: "float64" }] },
];

export interface JsConstructorRequest {
  readonly className: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
}

export function selectJsSurfaceConstructor(request: JsConstructorRequest): JsOperationSelection | undefined {
  const row = jsConstructorRows.find((candidate) =>
    candidate.className === request.className &&
    candidate.typeArgumentCount === request.typeArgumentCarriers.length &&
    candidate.argumentCount === request.argumentCarriers.length);
  if (row === undefined) {
    return undefined;
  }
  const typeArguments = request.typeArgumentCarriers;
  if (!typeArguments.every((carrier) => carrier === undefined || isPrimitiveLaneCarrier(carrier))) {
    return undefined;
  }
  let resultCarrier: TargetTypeRef | undefined;
  if (row.result === "map") {
    const [key, value] = typeArguments;
    resultCarrier = key !== undefined && value !== undefined ? rustJsMapTargetType(key, value) : undefined;
  } else if (row.result === "set") {
    const [value] = typeArguments;
    resultCarrier = value !== undefined ? rustJsSetTargetType(value) : undefined;
  } else {
    resultCarrier = rustJsDateTargetType();
  }
  if (resultCarrier === undefined) {
    return undefined;
  }
  return {
    fact: {
      kind: "provider-operation",
      operationId: `tsonic.rust.js.${row.className}.constructor`,
      operationKind: "constructor",
      target: { form: "call", path: row.path },
      resultCarrier,
    },
    resultCarrier,
    parameterCarriers: (row.params ?? []).map((reference) => resolveCarrierRef(reference, {})),
  };
}

function isPrimitiveLaneCarrier(carrier: TargetTypeRef): boolean {
  return carrier.kind === "source-primitive" || isRustStringCarrier(carrier);
}
