import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import {
  rustJsRegExpTargetId,
  rustJsStringTargetId,
  rustStringTargetId,
  rustUndefinedTargetId,
} from "../../../target-model/types/index.js";
import type {
  RustCallbackOperationTemplate,
  RustProviderOperationForm,
} from "../../../target-model/operations/model.js";
import type { JsCarrierRef, JsOperationRowData } from "./model.js";

const identity = jsRegExpSourceProfileIdentity;
const owners = identity.owners;
const members = identity.regExpMembers;
const constructorMembers = identity.regExpConstructorMembers;
const resultMembers = identity.regExpResultMembers;
const stringMembers = identity.stringMembers;
const symbols = identity.wellKnownMemberKeys;

type StringLane = "native" | "exact";

interface StringLanePolicy {
  readonly lane: StringLane;
  readonly carrierId: string;
  readonly value: Extract<JsCarrierRef, { readonly ref: "string" | "js-string" }>;
  readonly array: Extract<JsCarrierRef, { readonly ref: "string-array" | "js-string-array" }>;
  readonly optionValue: Extract<JsCarrierRef, { readonly ref: "option-of-string" | "option-of-js-string" }>;
  readonly execArray: Extract<JsCarrierRef, { readonly ref: "regexp-exec-array" | "js-regexp-exec-array" }>;
  readonly matchArray: Extract<JsCarrierRef, { readonly ref: "regexp-match-array" | "js-regexp-match-array" }>;
  readonly optionExecArray: Extract<JsCarrierRef, { readonly ref: "option-of-regexp-exec-array" | "option-of-js-regexp-exec-array" }>;
  readonly optionMatchArray: Extract<JsCarrierRef, { readonly ref: "option-of-regexp-match-array" | "option-of-js-regexp-match-array" }>;
  readonly indices: Extract<JsCarrierRef, { readonly ref: "regexp-indices" | "js-regexp-indices" }>;
  readonly optionIndices: Extract<JsCarrierRef, { readonly ref: "option-of-regexp-indices" | "option-of-js-regexp-indices" }>;
  readonly namedGroups: Extract<JsCarrierRef, { readonly ref: "regexp-named-groups" | "js-regexp-named-groups" }>;
  readonly optionNamedGroups: Extract<JsCarrierRef, { readonly ref: "option-of-regexp-named-groups" | "option-of-js-regexp-named-groups" }>;
  readonly namedIndices: Extract<JsCarrierRef, { readonly ref: "regexp-named-indices" | "js-regexp-named-indices" }>;
  readonly optionNamedIndices: Extract<JsCarrierRef, { readonly ref: "option-of-regexp-named-indices" | "option-of-js-regexp-named-indices" }>;
  readonly iterator: Extract<JsCarrierRef, { readonly ref: "regexp-string-iterator" | "js-regexp-string-iterator" }>;
  readonly resultOwners: {
    readonly exec: string;
    readonly match: string;
    readonly indices: string;
    readonly groups: string;
    readonly namedIndices: string;
    readonly iterator: string;
  };
  readonly pathSuffix: "_native" | "";
}

const native: StringLanePolicy = {
  lane: "native",
  carrierId: rustStringTargetId,
  value: { ref: "string" },
  array: { ref: "string-array" },
  optionValue: { ref: "option-of-string" },
  execArray: { ref: "regexp-exec-array" },
  matchArray: { ref: "regexp-match-array" },
  optionExecArray: { ref: "option-of-regexp-exec-array" },
  optionMatchArray: { ref: "option-of-regexp-match-array" },
  indices: { ref: "regexp-indices" },
  optionIndices: { ref: "option-of-regexp-indices" },
  namedGroups: { ref: "regexp-named-groups" },
  optionNamedGroups: { ref: "option-of-regexp-named-groups" },
  namedIndices: { ref: "regexp-named-indices" },
  optionNamedIndices: { ref: "option-of-regexp-named-indices" },
  iterator: { ref: "regexp-string-iterator" },
  resultOwners: {
    exec: owners.regExpExecArray,
    match: owners.regExpMatchArray,
    indices: owners.regExpIndicesArray,
    groups: owners.regExpNamedGroups,
    namedIndices: owners.regExpNamedIndices,
    iterator: owners.regExpStringIterator,
  },
  pathSuffix: "_native",
};

const exact: StringLanePolicy = {
  lane: "exact",
  carrierId: rustJsStringTargetId,
  value: { ref: "js-string" },
  array: { ref: "js-string-array" },
  optionValue: { ref: "option-of-js-string" },
  execArray: { ref: "js-regexp-exec-array" },
  matchArray: { ref: "js-regexp-match-array" },
  optionExecArray: { ref: "option-of-js-regexp-exec-array" },
  optionMatchArray: { ref: "option-of-js-regexp-match-array" },
  indices: { ref: "js-regexp-indices" },
  optionIndices: { ref: "option-of-js-regexp-indices" },
  namedGroups: { ref: "js-regexp-named-groups" },
  optionNamedGroups: { ref: "option-of-js-regexp-named-groups" },
  namedIndices: { ref: "js-regexp-named-indices" },
  optionNamedIndices: { ref: "option-of-js-regexp-named-indices" },
  iterator: { ref: "js-regexp-string-iterator" },
  resultOwners: {
    exec: owners.jsRegExpExecArray,
    match: owners.jsRegExpMatchArray,
    indices: owners.jsRegExpIndicesArray,
    groups: owners.jsRegExpNamedGroups,
    namedIndices: owners.jsRegExpNamedIndices,
    iterator: owners.jsRegExpStringIterator,
  },
  pathSuffix: "",
};

const lanes = [native, exact] as const;

const regexpCallRows: readonly JsOperationRowData[] = [
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "empty", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_empty_native" }, result: { ref: "regexp" }, params: [] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "native", firstArgCarrierId: rustStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_string_native", argModes: ["ref"] }, result: { ref: "regexp" }, params: [{ ref: "string" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "native-flags", firstArgCarrierId: rustStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_string_with_flags_native", argModes: ["ref", "ref"] }, result: { ref: "regexp" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "native-undefined-flags", firstArgCarrierId: rustStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_string_with_undefined_flags_native", argModes: ["ref", "value"] }, result: { ref: "regexp" }, params: [{ ref: "string" }, { ref: "undefined" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "exact", firstArgCarrierId: rustJsStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_exact", argModes: ["ref"] }, result: { ref: "regexp" }, params: [{ ref: "js-string" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "exact-flags", firstArgCarrierId: rustJsStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_exact_with_flags", argModes: ["ref", "ref"] }, result: { ref: "regexp" }, params: [{ ref: "js-string" }, { ref: "string" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "exact-undefined-flags", firstArgCarrierId: rustJsStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_exact_with_undefined_flags", argModes: ["ref", "value"] }, result: { ref: "regexp" }, params: [{ ref: "js-string" }, { ref: "undefined" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "undefined", firstArgCarrierId: rustUndefinedTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_undefined_native" }, result: { ref: "regexp" }, params: [{ ref: "undefined" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "undefined-flags", firstArgCarrierId: rustUndefinedTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_undefined_with_flags_native", argModes: ["value", "ref"] }, result: { ref: "regexp" }, params: [{ ref: "undefined" }, { ref: "string" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "undefined-undefined-flags", firstArgCarrierId: rustUndefinedTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_from_undefined_with_undefined_flags_native" }, result: { ref: "regexp" }, params: [{ ref: "undefined" }, { ref: "undefined" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "regexp", firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_call_from_regexp_native", argModes: ["ref"] }, result: { ref: "regexp" }, params: [{ ref: "regexp" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "regexp-flags", firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_call_from_regexp_with_flags_native", argModes: ["ref", "ref"] }, result: { ref: "regexp" }, params: [{ ref: "regexp" }, { ref: "string" }] } },
  { owner: owners.regExpConstructor, member: "call", operationKind: "call", lane: "regexp", variant: "regexp-undefined-flags", firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_call_from_regexp_with_undefined_flags_native", argModes: ["ref", "value"] }, result: { ref: "regexp" }, params: [{ ref: "regexp" }, { ref: "undefined" }] } },
];

function callback(
  lane: StringLane,
  target: RustProviderOperationForm,
): RustCallbackOperationTemplate {
  return {
    shape: "direct",
    sourceArgumentIndex: 1,
    argumentAdapter: { kind: "regexp-replacement", lane },
    fallibleTarget: target,
  };
}

function regexpResultRows(policy: StringLanePolicy): readonly JsOperationRowData[] {
  const { resultOwners } = policy;
  return [
    { owner: resultOwners.exec, member: resultMembers.first, operationKind: "indexer", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "required_group", argModes: ["value"] }, result: policy.value, params: [{ ref: "float64" }] } },
    { owner: resultOwners.exec, member: resultMembers.index, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "index" }, result: { ref: "float64" } } },
    { owner: resultOwners.exec, member: resultMembers.input, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "input" }, result: policy.value } },
    { owner: resultOwners.exec, member: resultMembers.groups, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "groups" }, result: policy.optionNamedGroups, sourceResult: policy.namedGroups, sourceAbsence: "undefined" } },
    { owner: resultOwners.exec, member: resultMembers.indices, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "indices" }, result: policy.optionIndices, sourceResult: policy.indices, sourceAbsence: "undefined" } },
    { owner: resultOwners.match, member: resultMembers.first, operationKind: "indexer", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "required_group", argModes: ["value"] }, result: policy.value, params: [{ ref: "float64" }] } },
    { owner: resultOwners.match, member: resultMembers.index, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "index" }, result: { ref: "option-of-float64" }, sourceResult: { ref: "float64" }, sourceAbsence: "undefined" } },
    { owner: resultOwners.match, member: resultMembers.input, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "input" }, result: policy.optionValue, sourceResult: policy.value, sourceAbsence: "undefined" } },
    { owner: resultOwners.match, member: resultMembers.groups, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "groups" }, result: policy.optionNamedGroups, sourceResult: policy.namedGroups, sourceAbsence: "undefined" } },
    { owner: resultOwners.match, member: resultMembers.indices, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "indices" }, result: policy.optionIndices, sourceResult: policy.indices, sourceAbsence: "undefined" } },
    { owner: resultOwners.indices, member: resultMembers.groups, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "groups" }, result: policy.optionNamedIndices, sourceResult: policy.namedIndices, sourceAbsence: "undefined" } },
    { owner: resultOwners.iterator, member: symbols.iterator, operationKind: "call", lane: "regexp-string-iterator", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "iterator" }, result: policy.iterator } },
  ];
}

function namedResultRows(policy: StringLanePolicy): readonly JsOperationRowData[] {
  const suffix = policy.pathSuffix;
  const groupPath = `js_abi::regexp_named_groups`;
  const indexPath = `js_abi::regexp_named_indices`;
  return [
    { owner: policy.resultOwners.groups, member: "index", operationKind: "property", lane: "regexp-named-groups", authoredPropertyKey: true, shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: `${groupPath}_get${suffix}`, receiverMode: "ref" }, result: policy.optionValue, sourceResult: policy.value, sourceAbsence: "undefined" } },
    { owner: policy.resultOwners.groups, member: "index", operationKind: "indexer", lane: "regexp-named-groups", shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: `${groupPath}_get${suffix}`, receiverMode: "ref", argModes: ["ref"] }, result: policy.optionValue, sourceResult: policy.value, sourceAbsence: "undefined", params: [{ ref: "string" }] } },
    { owner: policy.resultOwners.groups, member: "index", operationKind: "property-set", lane: "regexp-named-groups", authoredPropertyKey: true, shape: { op: "set", target: { form: "free-call", path: `${groupPath}_set${suffix}`, receiverMode: "ref" }, params: [policy.optionValue] } },
    { owner: policy.resultOwners.groups, member: "index", operationKind: "index-set", lane: "regexp-named-groups", shape: { op: "set", target: { form: "free-call", path: `${groupPath}_set${suffix}`, receiverMode: "ref", argModes: ["value", "ref"], argOrder: [1, 0] }, params: [{ ref: "string" }, policy.optionValue] } },
    { owner: policy.resultOwners.groups, member: "index", operationKind: "delete", lane: "regexp-named-groups", variant: "property", authoredPropertyKey: true, shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: `${groupPath}_delete${suffix}`, receiverMode: "ref" }, result: { ref: "bool" } } },
    { owner: policy.resultOwners.groups, member: "index", operationKind: "delete", lane: "regexp-named-groups", variant: "element", shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: `${groupPath}_delete${suffix}`, receiverMode: "ref", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
    { owner: policy.resultOwners.namedIndices, member: "index", operationKind: "property", lane: "regexp-named-indices", authoredPropertyKey: true, shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: `${indexPath}_get${suffix}`, receiverMode: "ref" }, result: { ref: "option-of-regexp-index-pair" }, sourceResult: { ref: "regexp-index-pair" }, sourceAbsence: "undefined" } },
    { owner: policy.resultOwners.namedIndices, member: "index", operationKind: "indexer", lane: "regexp-named-indices", shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: `${indexPath}_get${suffix}`, receiverMode: "ref", argModes: ["ref"] }, result: { ref: "option-of-regexp-index-pair" }, sourceResult: { ref: "regexp-index-pair" }, sourceAbsence: "undefined", params: [{ ref: "string" }] } },
    { owner: policy.resultOwners.namedIndices, member: "index", operationKind: "property-set", lane: "regexp-named-indices", authoredPropertyKey: true, shape: { op: "set", target: { form: "free-call", path: `${indexPath}_set${suffix}`, receiverMode: "ref" }, params: [{ ref: "option-of-regexp-index-pair" }] } },
    { owner: policy.resultOwners.namedIndices, member: "index", operationKind: "index-set", lane: "regexp-named-indices", shape: { op: "set", target: { form: "free-call", path: `${indexPath}_set${suffix}`, receiverMode: "ref", argModes: ["value", "ref"], argOrder: [1, 0] }, params: [{ ref: "string" }, { ref: "option-of-regexp-index-pair" }] } },
    { owner: policy.resultOwners.namedIndices, member: "index", operationKind: "delete", lane: "regexp-named-indices", variant: "property", authoredPropertyKey: true, shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: `${indexPath}_delete${suffix}`, receiverMode: "ref" }, result: { ref: "bool" } } },
    { owner: policy.resultOwners.namedIndices, member: "index", operationKind: "delete", lane: "regexp-named-indices", variant: "element", shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: `${indexPath}_delete${suffix}`, receiverMode: "ref", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  ];
}

function regexpMethodRows(policy: StringLanePolicy): readonly JsOperationRowData[] {
  const nativeLane = policy.lane === "native";
  const path = (name: string): string => `js_abi::regexp_${name}${policy.pathSuffix}`;
  const target = (exactMethod: string, nativeName = exactMethod): RustProviderOperationForm =>
    nativeLane
      ? { form: "free-call", path: path(nativeName), receiverMode: "ref", argModes: ["ref"] }
      : { form: "receiver-method", name: exactMethod, argModes: ["ref"] };
  const replaceTarget: RustProviderOperationForm = nativeLane
    ? { form: "free-call", path: path("replace"), receiverMode: "ref", argModes: ["ref", "ref"] }
    : { form: "receiver-method", name: "replace", argModes: ["ref", "ref"] };
  const callbackTarget: RustProviderOperationForm = nativeLane
    ? { form: "free-call", path: path("try_replace_with"), receiverMode: "ref", argModes: ["ref", "value"] }
    : { form: "receiver-method", name: "replace_with", argModes: ["ref", "value"] };
  const callbackFallibleTarget: RustProviderOperationForm = nativeLane
    ? callbackTarget
    : { form: "receiver-method", name: "try_replace_with", argModes: ["ref", "value"] };
  return [
    { owner: owners.regExp, member: members.test, operationKind: "call", lane: "regexp", firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: target("test"), result: { ref: "bool" }, params: [policy.value] } },
    { owner: owners.regExp, member: members.exec, operationKind: "call", lane: "regexp", firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: target("exec"), result: policy.optionExecArray, sourceResult: policy.execArray, sourceAbsence: "null", params: [policy.value] } },
    { owner: owners.regExp, member: symbols.match, operationKind: "call", lane: "regexp", firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: target("match_result", "match"), result: policy.optionMatchArray, sourceResult: policy.matchArray, sourceAbsence: "null", params: [policy.value] } },
    { owner: owners.regExp, member: symbols.matchAll, operationKind: "call", lane: "regexp", firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: target("match_all"), result: policy.iterator, params: [policy.value] } },
    { owner: owners.regExp, member: symbols.replace, operationKind: "call", lane: "regexp", variant: `${policy.lane}-string`, firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: replaceTarget, result: policy.value, params: [policy.value, policy.value] } },
    { owner: owners.regExp, member: symbols.replace, operationKind: "call", lane: "regexp", variant: `${policy.lane}-callback`, firstArgCarrierId: policy.carrierId, fallible: true, callback: callback(policy.lane, callbackFallibleTarget), shape: { op: "operation", operationKind: "method", target: callbackTarget, result: policy.value, params: [policy.value, { ref: "argument", index: 1 }] } },
    { owner: owners.regExp, member: symbols.search, operationKind: "call", lane: "regexp", firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: target("search"), result: { ref: "float64" }, params: [policy.value] } },
    { owner: owners.regExp, member: symbols.split, operationKind: "call", lane: "regexp", variant: `${policy.lane}-default`, firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: target("split_all"), result: policy.array, params: [policy.value] } },
    { owner: owners.regExp, member: symbols.split, operationKind: "call", lane: "regexp", variant: `${policy.lane}-limit`, firstArgCarrierId: policy.carrierId, fallible: true, shape: { op: "operation", operationKind: "method", target: nativeLane ? { form: "free-call", path: path("split_with_limit"), receiverMode: "ref", argModes: ["ref", "value"] } : { form: "receiver-method", name: "split_with_limit", argModes: ["ref", "value"] }, result: policy.array, params: [policy.value, { ref: "float64" }] } },
  ];
}

function stringRegExpRows(policy: StringLanePolicy): readonly JsOperationRowData[] {
  const lane = policy.lane === "native" ? "string" : "js-string";
  const suffix = policy.pathSuffix;
  const call = (path: string, argModes: readonly ("value" | "ref" | "mut-ref")[]): RustProviderOperationForm => ({ form: "free-call", path: `js_abi::${path}${suffix}`, receiverMode: "ref", argModes });
  const callbackTarget = call("string_try_replace_regexp_with", ["ref", "value"]);
  const replaceCallbackTarget = policy.lane === "native"
    ? callbackTarget
    : call("string_replace_regexp_with", ["ref", "value"]);
  const callbackAllTarget = call("string_try_replace_all_regexp_with", ["ref", "value"]);
  const replaceAllCallbackTarget = policy.lane === "native"
    ? callbackAllTarget
    : call("string_replace_all_regexp_with", ["ref", "value"]);
  return [
    { owner: owners.string, member: stringMembers.match, operationKind: "call", lane, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_match_regexp", ["ref"]), result: policy.optionMatchArray, sourceResult: policy.matchArray, sourceAbsence: "null", params: [{ ref: "regexp" }] } },
    { owner: owners.string, member: stringMembers.matchAll, operationKind: "call", lane, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_match_all_regexp", ["ref"]), result: policy.iterator, params: [{ ref: "regexp" }] } },
    { owner: owners.string, member: stringMembers.replace, operationKind: "call", lane, variant: `${policy.lane}-regexp-string`, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_replace_regexp", ["ref", "ref"]), result: policy.value, params: [{ ref: "regexp" }, policy.value] } },
    { owner: owners.string, member: stringMembers.replace, operationKind: "call", lane, variant: `${policy.lane}-regexp-callback`, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, callback: callback(policy.lane, callbackTarget), shape: { op: "operation", operationKind: "method", target: replaceCallbackTarget, result: policy.value, params: [{ ref: "regexp" }, { ref: "argument", index: 1 }] } },
    { owner: owners.string, member: stringMembers.replaceAll, operationKind: "call", lane, variant: `${policy.lane}-regexp-string`, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_replace_all_regexp", ["ref", "ref"]), result: policy.value, params: [{ ref: "regexp" }, policy.value] } },
    { owner: owners.string, member: stringMembers.replaceAll, operationKind: "call", lane, variant: `${policy.lane}-regexp-callback`, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, callback: callback(policy.lane, callbackAllTarget), shape: { op: "operation", operationKind: "method", target: replaceAllCallbackTarget, result: policy.value, params: [{ ref: "regexp" }, { ref: "argument", index: 1 }] } },
    { owner: owners.string, member: stringMembers.search, operationKind: "call", lane, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_search_regexp", ["ref"]), result: { ref: "float64" }, params: [{ ref: "regexp" }] } },
    { owner: owners.string, member: stringMembers.split, operationKind: "call", lane, variant: `${policy.lane}-regexp-default`, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_split_regexp", ["ref"]), result: policy.array, params: [{ ref: "regexp" }] } },
    { owner: owners.string, member: stringMembers.split, operationKind: "call", lane, variant: `${policy.lane}-regexp-limit`, firstArgCarrierId: rustJsRegExpTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: call("string_split_regexp_with_limit", ["ref", "value"]), result: policy.array, params: [{ ref: "regexp" }, { ref: "float64" }] } },
  ];
}

function directStringCallbackRows(policy: StringLanePolicy): readonly JsOperationRowData[] {
  const lane = policy.lane === "native" ? "string" : "js-string";
  const module = policy.lane === "native" ? "js_string" : "js_exact_string";
  const baseFallible = policy.lane === "native";
  const replaceTarget: RustProviderOperationForm = { form: "free-call", path: `${module}::replace_with`, receiverMode: "ref", argModes: ["ref", "value"] };
  const replaceAllTarget: RustProviderOperationForm = { form: "free-call", path: `${module}::replace_all_with`, receiverMode: "ref", argModes: ["ref", "value"] };
  const fallibleReplaceTarget: RustProviderOperationForm = { form: "free-call", path: `${module}::try_replace_with`, receiverMode: "ref", argModes: ["ref", "value"] };
  const fallibleReplaceAllTarget: RustProviderOperationForm = { form: "free-call", path: `${module}::try_replace_all_with`, receiverMode: "ref", argModes: ["ref", "value"] };
  return [
    { owner: owners.string, member: stringMembers.replace, operationKind: "call", lane, variant: `${policy.lane}-string`, firstArgCarrierId: policy.carrierId, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `${module}::replace`, receiverMode: "ref", argModes: ["ref", "ref"] }, result: policy.value, params: [policy.value, policy.value] } },
    { owner: owners.string, member: stringMembers.replace, operationKind: "call", lane, variant: `${policy.lane}-string-callback`, firstArgCarrierId: policy.carrierId, ...(baseFallible ? { fallible: true as const } : {}), callback: callback(policy.lane, fallibleReplaceTarget), shape: { op: "operation", operationKind: "method", target: replaceTarget, result: policy.value, params: [policy.value, { ref: "argument", index: 1 }] } },
    { owner: owners.string, member: stringMembers.replaceAll, operationKind: "call", lane, variant: `${policy.lane}-string`, firstArgCarrierId: policy.carrierId, ...(baseFallible ? { fallible: true as const } : {}), shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `${module}::replace_all`, receiverMode: "ref", argModes: ["ref", "ref"] }, result: policy.value, params: [policy.value, policy.value] } },
    { owner: owners.string, member: stringMembers.replaceAll, operationKind: "call", lane, variant: `${policy.lane}-string-callback`, firstArgCarrierId: policy.carrierId, ...(baseFallible ? { fallible: true as const } : {}), callback: callback(policy.lane, fallibleReplaceAllTarget), shape: { op: "operation", operationKind: "method", target: replaceAllTarget, result: policy.value, params: [policy.value, { ref: "argument", index: 1 }] } },
  ];
}

export const regexpOperationRows: readonly JsOperationRowData[] = Object.freeze([
  ...regexpCallRows,
  ...lanes.flatMap(regexpResultRows),
  ...lanes.flatMap(namedResultRows),
  ...lanes.flatMap(regexpMethodRows),
  ...lanes.flatMap(stringRegExpRows),
  ...lanes.flatMap(directStringCallbackRows),
  { owner: owners.regExpConstructor, member: constructorMembers.escape, operationKind: "call", lane: "regexp", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_escape_native", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: owners.regExpConstructor, member: constructorMembers.escape, operationKind: "call", lane: "regexp", variant: "exact", firstArgCarrierId: rustJsStringTargetId, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::regexp_escape_exact_native", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "js-string" }] } },
  { owner: owners.regExp, member: members.toString, operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::regexp_to_string_native", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: owners.regExp, member: members.source, operationKind: "property", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_abi::regexp_source_native", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: owners.regExp, member: members.flags, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_abi::regexp_flags_native", receiverMode: "ref" }, result: { ref: "string" } } },
  ...([
    [members.global, "global"],
    [members.hasIndices, "has_indices"],
    [members.ignoreCase, "ignore_case"],
    [members.multiline, "multiline"],
    [members.dotAll, "dot_all"],
    [members.sticky, "sticky"],
    [members.unicode, "unicode"],
    [members.unicodeSets, "unicode_sets"],
  ] as const).map(([member, name]): JsOperationRowData => ({ owner: owners.regExp, member, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name }, result: { ref: "bool" } } })),
  { owner: owners.regExp, member: members.lastIndex, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "last_index" }, result: { ref: "float64" } } },
  { owner: owners.regExp, member: members.lastIndex, operationKind: "property-set", lane: "regexp", shape: { op: "set", target: { form: "receiver-method", name: "set_last_index" }, params: [{ ref: "float64" }] } },
  { owner: owners.string, member: stringMembers.match, operationKind: "call", lane: "string", firstArgCarrierId: rustStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::regexp_match_string_native", receiverMode: "ref", argModes: ["ref"] }, result: native.optionMatchArray, sourceResult: native.matchArray, sourceAbsence: "null", params: [native.value] } },
  { owner: owners.string, member: stringMembers.search, operationKind: "call", lane: "string", firstArgCarrierId: rustStringTargetId, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::regexp_search_string_native", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "float64" }, params: [native.value] } },
]);
