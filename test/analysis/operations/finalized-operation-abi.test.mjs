import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finalizeRustProviderOperationAbi,
  validateRustFinalizedOperationAbi,
} from "../../../dist/analysis/facts/finalized-operation-abi.js";
import {
  closedMetadataKey,
  isClosedMetadata,
  snapshotClosedMetadata,
} from "../../../dist/target-model/metadata/closed-data.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../../../dist/target-model/types/equality.js";
import {
  rustProviderOperationFormDeclaresWritableInput,
} from "../../../dist/policy/operations/forms.js";

const bool = { kind: "source-primitive", name: "bool" };
const float64 = { kind: "source-primitive", name: "float64" };
const int32 = { kind: "source-primitive", name: "int32" };
const isize = { kind: "source-primitive", name: "native-int" };
const jsValue = { kind: "target-named", id: "rust.js.JsValue" };
const providerError = { kind: "target-named", id: "rust.test.ProviderError" };
const string = { kind: "target-named", id: "rust.std.String" };
const sourceNullish = { kind: "target-specific", target: "rust", name: "source-nullish" };
const unit = { kind: "tuple", elements: [] };
const usize = { kind: "source-primitive", name: "native-uint" };
const typeArgument = (type) => ({ kind: "type", type });

test("provider calls retain closed target-only generic arguments", () => {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call", path: "core::mem::size_of" },
    sourceArgumentCarriers: [],
    resultCarrier: usize,
    targetGenericArguments: [typeArgument(int32)],
    isAsync: false,
    isFallible: false,
  });

  assert.ok(abi);
  assert.deepEqual(abi.targetGenericArguments, [typeArgument(int32)]);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  assert.equal(finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call", path: "core::mem::size_of" },
    sourceArgumentCarriers: [],
    resultCarrier: usize,
    targetGenericArguments: [typeArgument({ kind: "type-parameter", name: "" })],
    isAsync: false,
    isFallible: false,
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    operationKind: "property",
    form: { form: "path", path: "acme::VALUE" },
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    targetGenericArguments: [typeArgument(int32)],
    isAsync: false,
    isFallible: false,
  }), undefined);
});

test("provider evaluation effects are conservative by default and require an exact pure opt-in", () => {
  const array = {
    kind: "target-named",
    id: "rust.js.JsArray",
    genericArguments: [typeArgument(int32)],
  };
  const taggedForm = {
    form: "receiver-tagged-array",
    name: "mutating_values",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: {
      kind: "target-named",
      id: "acme.MutableInput",
      genericArguments: [typeArgument(int32)],
    },
    alternatives: [{
      inputCarrier: int32,
      mode: "mut-ref",
      constructorPath: "acme::MutableInput::Value",
    }],
  };
  const observable = finalizeRustProviderOperationAbi({
    operationKind: "property",
    form: { form: "call", path: "acme::observable" },
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
  });
  const pure = finalizeRustProviderOperationAbi({
    operationKind: "property",
    form: { form: "call", path: "acme::pure" },
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
    evaluation: "pure",
  });
  const mutatingObservable = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: {
      form: "call",
      path: "acme::mutating",
      argModes: ["mut-ref"],
    },
    sourceArgumentCarriers: [int32],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
  });
  const nestedMutatingObservable = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: taggedForm,
    sourceReceiverCarrier: array,
    sourceArgumentCarriers: [int32],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
  });

  assert.equal(observable?.effects.evaluation, "observable");
  assert.equal(pure?.effects.evaluation, "pure");
  assert.equal(mutatingObservable?.effects.evaluation, "observable");
  assert.equal(nestedMutatingObservable?.effects.evaluation, "observable");
  assert.equal(finalizeRustProviderOperationAbi({
    operationKind: "constructor",
    form: { form: "call", path: "acme::Value::new" },
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
    evaluation: "pure",
  }), undefined);
  assert.equal(validateRustFinalizedOperationAbi({
    ...mutatingObservable,
    effects: { ...mutatingObservable?.effects, evaluation: "pure" },
  }), false);
  assert.equal(finalizeRustProviderOperationAbi({
    operationKind: "property",
    form: { form: "call", path: "acme::invalid" },
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
    evaluation: "guess",
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: {
      form: "call",
      path: "acme::mutating",
      argModes: ["mut-ref"],
    },
    sourceArgumentCarriers: [int32],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
    evaluation: "pure",
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: taggedForm,
    sourceReceiverCarrier: array,
    sourceArgumentCarriers: [int32],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
    evaluation: "pure",
  }), undefined);
});

test("operation-form writability is one exhaustive structural policy", () => {
  const mutableForms = [
    { form: "call", path: "acme::call", argModes: ["mut-ref"] },
    { form: "call-c-variadic", path: "acme::variadic", fixedArgumentModes: ["mut-ref"] },
    { form: "free-call-str-slice", path: "acme::slice", receiverMode: "mut-ref" },
    {
      form: "call-value-array",
      path: "acme::array",
      leadingArguments: [{ carrier: int32, mode: "mut-ref" }],
      elementCarrier: int32,
    },
    {
      form: "receiver-value-array",
      name: "array",
      receiverMode: "mut-ref",
      leadingArguments: [],
      elementCarrier: int32,
    },
    {
      form: "receiver-tagged-array",
      name: "tagged",
      receiverMode: "ref",
      leadingArguments: [],
      elementCarrier: int32,
      alternatives: [{
        inputCarrier: int32,
        mode: "mut-ref",
        constructorPath: "acme::Mutable::Value",
      }],
    },
    {
      form: "free-call",
      path: "acme::free",
      receiverMode: "ref",
      argModes: ["mut-ref"],
    },
    {
      form: "trait-call",
      owner: int32,
      traitPath: "acme::Trait",
      traitGenericArguments: [],
      method: "mutate",
      receiverMode: "mut-ref",
    },
    { form: "receiver-method", name: "mutate", mutatesReceiver: true },
    { form: "arg-receiver-method", name: "mutate", argModes: ["mut-ref"] },
  ];
  const readOnlyForms = [
    { form: "call", path: "acme::call", argModes: ["ref"] },
    {
      form: "call-value-slice",
      path: "acme::slice",
      leadingArguments: [{ carrier: int32, mode: "ref" }],
      elementCarrier: int32,
    },
    { form: "receiver-method", name: "read" },
    { form: "method", name: "read" },
    { form: "index" },
    { form: "path", path: "acme::VALUE" },
  ];

  for (const form of mutableForms) {
    assert.equal(rustProviderOperationFormDeclaresWritableInput(form), true, form.form);
  }
  for (const form of readOnlyForms) {
    assert.equal(rustProviderOperationFormDeclaresWritableInput(form), false, form.form);
  }
});

test("provider results preserve exact borrowed-string ownership conversion", () => {
  const borrowedString = {
    kind: "reference",
    referent: string,
    mutable: false,
  };
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "property",
    form: { form: "call", path: "acme::separator" },
    sourceArgumentCarriers: [],
    resultCarrier: string,
    resultConversion: {
      kind: "semantic-conversion",
      id: "owned-string-from-borrowed-str",
    },
    isAsync: false,
    isFallible: false,
  });

  assert.ok(abi);
  assert.deepEqual(abi.result, {
    kind: "sync",
    rawCarrier: borrowedString,
    conversion: {
      kind: "semantic",
      conversion: {
        kind: "semantic-conversion",
        id: "owned-string-from-borrowed-str",
      },
      sourceCarrier: borrowedString,
      targetCarrier: string,
      fallible: false,
    },
    carrier: string,
  });
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
});

test("provider methods finalize receiver, source order, passing modes, conversions, and result", () => {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: {
      form: "receiver-method",
      name: "read",
      argModes: ["value"],
      argConversions: [{ kind: "semantic-conversion", id: "checked-i32-to-usize" }],
    },
    sourceReceiverCarrier: string,
    sourceArgumentCarriers: [int32],
    declaredSourceArgumentCarriers: [int32],
    resultCarrier: bool,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  assert.equal(abi.operationKind, "method");
  assert.deepEqual(abi.target, {
    form: "receiver-method",
    name: "read",
    argModes: ["value"],
    argConversions: [{ kind: "semantic-conversion", id: "checked-i32-to-usize" }],
  });
  assert.deepEqual(abi.sourceReceiver, {
    kind: "receiver",
    carrier: string,
    disposition: "runtime",
  });
  assert.equal(abi.targetReceiver.kind, "input");
  assert.equal(abi.targetReceiver.input.mode, "ref");
  assert.deepEqual(abi.targetArguments[0], {
    source: { kind: "argument", sourceIndex: 0 },
    sourceCarrier: int32,
    conversion: {
      kind: "semantic",
      conversion: { kind: "semantic-conversion", id: "checked-i32-to-usize" },
      sourceCarrier: int32,
      targetCarrier: usize,
      fallible: true,
    },
    mode: "value",
    parameterCarrier: usize,
  });
  assert.deepEqual(abi.result, {
    kind: "sync",
    rawCarrier: bool,
    conversion: {
      kind: "identity",
      sourceCarrier: bool,
      targetCarrier: bool,
      fallible: false,
    },
    carrier: bool,
  });
});

test("provider receivers distinguish runtime values from compile-time owner identities", () => {
  const owner = {
    kind: "target-specific",
    target: "rust",
    name: "named-type",
    value: {
      id: "rust.test.Environment",
      path: "acme::Environment",
      genericArguments: [],
      genericDefaults: [],
      traits: { implementations: [] },
    },
  };
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "indexer",
    form: { form: "call", path: "acme::environment_get", argModes: ["ref"] },
    sourceReceiverCarrier: owner,
    sourceArgumentCarriers: [string],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(abi);
  assert.deepEqual(abi.sourceReceiver, {
    kind: "receiver",
    carrier: owner,
    disposition: "compile-time",
  });
  assert.deepEqual(abi.targetArguments.map((input) => input.source), [
    { kind: "argument", sourceIndex: 0 },
  ]);
  assert.equal(validateRustFinalizedOperationAbi({
    ...abi,
    sourceReceiver: { ...abi.sourceReceiver, disposition: "runtime" },
  }), false);
});

test("compile-time source arguments must be declared explicitly and remain in the source ABI", () => {
  const options = {
    operationKind: "method",
    form: {
      form: "call",
      path: "js_abi::json_stringify_with_indent",
      argModes: ["ref"],
      argOrder: [0],
      trailingArguments: [{ kind: "string", value: "  " }],
    },
    sourceArgumentCarriers: [jsValue, sourceNullish, float64],
    declaredSourceArgumentCarriers: [jsValue],
    resultCarrier: string,
    isAsync: false,
    isFallible: true,
    errorBoundary: "provider-native",
    errorCarrier: providerError,
  };

  assert.equal(finalizeRustProviderOperationAbi(options), undefined);
  const abi = finalizeRustProviderOperationAbi({
    ...options,
    compileTimeSourceArgumentIndexes: [1, 2],
  });
  assert.ok(abi);
  assert.deepEqual(abi.sourceArguments.map(({ sourceIndex, role, disposition }) => ({ sourceIndex, role, disposition })), [
    { sourceIndex: 0, role: "parameter", disposition: "runtime" },
    { sourceIndex: 1, role: "compile-time", disposition: "compile-time" },
    { sourceIndex: 2, role: "compile-time", disposition: "compile-time" },
  ]);
  assert.equal(abi.targetArguments.length, 2);
  assert.deepEqual(abi.targetArguments[1], {
    source: { kind: "constant", value: { kind: "string", value: "  " } },
  });
});

test("variadic string slices are total for empty and nonempty calls and reject other carriers", () => {
  const empty = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call-str-slice", path: "node_path::join" },
    sourceArgumentCarriers: [],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const pair = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call-str-slice", path: "node_path::join" },
    sourceArgumentCarriers: [string, string],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const wrong = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call-str-slice", path: "node_path::join" },
    sourceArgumentCarriers: [int32],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(empty);
  assert.ok(pair);
  assert.equal(empty.targetArguments[0].source.kind, "argument-slice");
  assert.deepEqual(empty.targetArguments[0].source.sourceIndexes, []);
  assert.deepEqual(pair.targetArguments[0].source.sourceIndexes, [0, 1]);
  assert.equal(wrong, undefined);
});

test("receiver string slices preserve the exact receiver and every variadic argument", () => {
  const form = {
    form: "free-call-str-slice",
    path: "js_string::concat",
    receiverMode: "ref",
  };
  const pair = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: string,
    sourceArgumentCarriers: [string, string],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const empty = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: string,
    sourceArgumentCarriers: [],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const wrong = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: string,
    sourceArgumentCarriers: [int32],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });

  assert.equal(pair?.targetArguments[0].source.kind, "receiver");
  assert.equal(pair?.targetArguments[1].source.kind, "argument-slice");
  assert.deepEqual(pair?.targetArguments[1].source.sourceIndexes, [0, 1]);
  assert.deepEqual(empty?.targetArguments[1].source.sourceIndexes, []);
  assert.equal(wrong, undefined);
});

test("variadic value slices convert each source value exactly and always pass one slice", () => {
  const form = {
    form: "call-value-slice",
    path: "node_util::format",
    leadingArguments: [{ carrier: string, mode: "ref" }],
    elementCarrier: jsValue,
  };
  const values = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [string, int32, bool],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const emptyTail = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [string],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const preserved = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [string, string, jsValue],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const unsupported = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [string, unit],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });
  const compileTimeElement = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [string, int32],
    compileTimeSourceArgumentIndexes: [1],
    resultCarrier: string,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(values);
  assert.ok(emptyTail);
  assert.ok(preserved);
  assert.equal(values.targetArguments[0].mode, "ref");
  assert.deepEqual(values.targetArguments[1].source, {
    kind: "argument-slice",
    sourceIndexes: [1, 2],
  });
  assert.deepEqual(
    values.targetArguments[1].elements.map((element) => element.conversion),
    [
      {
        kind: "semantic",
        conversion: { kind: "semantic-conversion", id: "js-value-from-i32" },
        sourceCarrier: int32,
        targetCarrier: jsValue,
        fallible: false,
      },
      {
        kind: "semantic",
        conversion: { kind: "semantic-conversion", id: "js-value-from-bool" },
        sourceCarrier: bool,
        targetCarrier: jsValue,
        fallible: false,
      },
    ],
  );
  assert.deepEqual(emptyTail.targetArguments[1].source, {
    kind: "argument-slice",
    sourceIndexes: [],
  });
  assert.deepEqual(emptyTail.targetArguments[1].elements, []);
  assert.deepEqual(
    preserved.targetArguments[1].elements.map((element) => element.conversion.kind === "semantic"
      ? element.conversion.conversion.id
      : element.conversion.kind),
    ["js-value-from-string", "js-value-clone"],
  );
  assert.equal(unsupported, undefined);
  assert.equal(compileTimeElement, undefined);
});

test("variadic value arrays move each source value into one owned fixed Rust array", () => {
  const form = {
    form: "call-value-array",
    path: "js_abi::array_of",
    leadingArguments: [],
    elementCarrier: int32,
  };
  const pair = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [int32, int32],
    resultCarrier: {
      kind: "target-named",
      id: "rust.js.JsArray",
      genericArguments: [typeArgument(int32)],
    },
    isAsync: false,
    isFallible: false,
  });
  const empty = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [],
    resultCarrier: {
      kind: "target-named",
      id: "rust.js.JsArray",
      genericArguments: [typeArgument(int32)],
    },
    isAsync: false,
    isFallible: false,
  });
  const wrong = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceArgumentCarriers: [string],
    resultCarrier: {
      kind: "target-named",
      id: "rust.js.JsArray",
      genericArguments: [typeArgument(int32)],
    },
    isAsync: false,
    isFallible: false,
  });

  assert.deepEqual(pair?.targetArguments[0], {
    source: { kind: "argument-array", sourceIndexes: [0, 1] },
    elements: pair.targetArguments[0].elements,
    elementCarrier: int32,
    mode: "value",
  });
  assert.deepEqual(empty?.targetArguments[0].source, {
    kind: "argument-array",
    sourceIndexes: [],
  });
  assert.equal(wrong, undefined);
});

test("receiver value arrays move every variadic source value into one fixed Rust array", () => {
  const receiver = {
    kind: "target-named",
    id: "rust.js.JsArray",
    genericArguments: [typeArgument(int32)],
  };
  const form = {
    form: "receiver-value-array",
    name: "push_many",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: int32,
  };
  const pair = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: receiver,
    sourceArgumentCarriers: [int32, int32],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
  });
  const empty = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: receiver,
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
  });
  const wrong = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: receiver,
    sourceArgumentCarriers: [string],
    resultCarrier: int32,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(pair);
  assert.ok(empty);
  assert.equal(pair.targetReceiver.kind, "input");
  assert.equal(pair.targetReceiver.input.mode, "ref");
  assert.deepEqual(pair.targetArguments[0], {
    source: { kind: "argument-array", sourceIndexes: [0, 1] },
    elements: pair.targetArguments[0].elements,
    elementCarrier: int32,
    mode: "value",
  });
  assert.deepEqual(
    pair.targetArguments[0].elements.map((element) => element.source.sourceIndex),
    [0, 1],
  );
  assert.deepEqual(empty.targetArguments[0].source.sourceIndexes, []);
  assert.equal(wrong, undefined);
  assert.equal(validateRustFinalizedOperationAbi(pair), true);
});

test("tagged value arrays select one exact constructor for every variadic source value", () => {
  const array = {
    kind: "target-named",
    id: "rust.js.JsArray",
    genericArguments: [typeArgument(int32)],
  };
  const tagged = {
    kind: "target-named",
    id: "rust.js.JsArrayConcatItem",
    genericArguments: [typeArgument(int32)],
  };
  const form = {
    form: "receiver-tagged-array",
    name: "concat",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: tagged,
    alternatives: [
      { inputCarrier: int32, mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Value" },
      { inputCarrier: array, mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Array" },
    ],
  };
  const selected = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: array,
    sourceArgumentCarriers: [int32, array],
    resultCarrier: array,
    isAsync: false,
    isFallible: false,
  });
  const unsupported = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form,
    sourceReceiverCarrier: array,
    sourceArgumentCarriers: [bool],
    resultCarrier: array,
    isAsync: false,
    isFallible: false,
  });

  assert.deepEqual(
    selected?.targetArguments[0].elements.map((element) => element.constructorPath),
    ["js_abi::JsArrayConcatItem::Value", "js_abi::JsArrayConcatItem::Array"],
  );
  assert.equal(unsupported, undefined);
});

test("async ABI separates invocation, await fallibility, and post-await conversion", () => {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call", path: "acme::read" },
    sourceArgumentCarriers: [],
    resultCarrier: int32,
    resultConversion: { kind: "semantic-conversion", id: "checked-isize-to-i32" },
    isAsync: true,
    isFallible: true,
    errorBoundary: "target-runtime",
  });

  assert.ok(abi);
  assert.deepEqual(abi.effects, {
    evaluation: "observable",
    invocation: "infallible",
    awaiting: "fallible",
    errorBoundary: "target-runtime",
    safety: "safe",
  });
  assert.equal(abi.result.kind, "async");
  assert.deepEqual(abi.result.awaitedRawCarrier, isize);
  assert.deepEqual(abi.result.awaitedCarrier, int32);
  assert.deepEqual(abi.result.futureCarrier, {
    kind: "target-named",
    id: "rust.core.Future",
    genericArguments: [typeArgument(int32)],
  });
  assert.equal(validateRustFinalizedOperationAbi({
    ...abi,
    effects: { ...abi.effects, invocation: "fallible" },
  }), false);
});

test("runtime index setters finalize mutable receiver, index conversion, and value", () => {
  const vec = { kind: "array", element: int32 };
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "index-set",
    form: {
      form: "index",
      indexConversion: { kind: "semantic-conversion", id: "checked-i32-to-usize" },
    },
    sourceReceiverCarrier: vec,
    sourceArgumentCarriers: [int32, int32],
    declaredSourceArgumentCarriers: [int32, int32],
    resultCarrier: unit,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(abi);
  assert.equal(abi.targetReceiver.kind, "input");
  assert.equal(abi.targetReceiver.input.mode, "mut-ref");
  assert.equal(abi.targetArguments.length, 2);
  assert.equal(abi.targetArguments[0].source.sourceIndex, 0);
  assert.equal(abi.targetArguments[0].conversion.kind, "semantic");
  assert.equal(abi.targetArguments[1].source.sourceIndex, 1);
  assert.equal(validateRustFinalizedOperationAbi({
    ...abi,
    sourceArguments: abi.sourceArguments.slice(1),
  }), false);
  assert.equal(validateRustFinalizedOperationAbi({
    ...abi,
    target: { form: "receiver-method", name: "set" },
  }), false);
  assert.equal(validateRustFinalizedOperationAbi({
    ...abi,
    operationKind: "property-set",
  }), false);
});

test("runtime method setters preserve the provider-declared receiver mode", () => {
  const shared = finalizeRustProviderOperationAbi({
    operationKind: "property-set",
    form: { form: "receiver-method", name: "set_value" },
    sourceReceiverCarrier: { kind: "target-named", id: "acme.SharedCell" },
    sourceArgumentCarriers: [int32],
    declaredSourceArgumentCarriers: [int32],
    resultCarrier: unit,
    isAsync: false,
    isFallible: false,
  });
  const exclusive = finalizeRustProviderOperationAbi({
    operationKind: "property-set",
    form: { form: "receiver-method", name: "set_value", mutatesReceiver: true },
    sourceReceiverCarrier: { kind: "target-named", id: "acme.ExclusiveCell" },
    sourceArgumentCarriers: [int32],
    declaredSourceArgumentCarriers: [int32],
    resultCarrier: unit,
    isAsync: false,
    isFallible: false,
  });

  assert.ok(shared);
  assert.equal(shared.targetReceiver.kind, "input");
  assert.equal(shared.targetReceiver.input.mode, "ref");
  assert.ok(exclusive);
  assert.equal(exclusive.targetReceiver.kind, "input");
  assert.equal(exclusive.targetReceiver.input.mode, "mut-ref");
});

test("finalized ABI validation is total and rejects every mutated closed-contract field", () => {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call", path: "acme::run", argModes: ["value"] },
    sourceArgumentCarriers: [int32],
    resultCarrier: bool,
    isAsync: false,
    isFallible: false,
  });
  assert.ok(abi);

  const mutations = [
    null,
    {},
    { ...abi, unexpected: true },
    { ...abi, effects: { ...abi.effects, evaluation: "guess" } },
    { ...abi, effects: { ...abi.effects, invocation: "guess" } },
    { ...abi, effects: { ...abi.effects, awaiting: "guess" } },
    { ...abi, effects: { ...abi.effects, errorBoundary: "guess" } },
    { ...abi, effects: { ...abi.effects, safety: "guess" } },
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], mode: "guess" }] },
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], carrier: null }] },
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], role: "compile-time" }] },
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], disposition: "compile-time" }] },
    { ...abi, target: { ...abi.target, argModes: [] } },
    { ...abi, target: { ...abi.target, argOrder: [0, 0] } },
    { ...abi, targetArguments: [{ ...abi.targetArguments[0], source: { kind: "argument", sourceIndex: 7 } }] },
    {
      ...abi,
      targetGenericArguments: [typeArgument({ kind: "type-parameter", name: "" })],
    },
    { ...abi, result: { ...abi.result, unexpected: true } },
  ];

  for (const malformed of mutations) {
    assert.doesNotThrow(() => validateRustFinalizedOperationAbi(malformed));
    assert.equal(validateRustFinalizedOperationAbi(malformed), false);
  }
  const cyclicCarrier = { kind: "target-specific", target: "rust", name: "cycle" };
  cyclicCarrier.value = cyclicCarrier;
  const cyclic = structuredClone(abi);
  cyclic.sourceArguments[0].carrier = cyclicCarrier;
  assert.doesNotThrow(() => validateRustFinalizedOperationAbi(cyclic));
  assert.equal(validateRustFinalizedOperationAbi(cyclic), false);
});

test("operation finalization rejects unsafe constants and incomplete permutations while preserving raw-pointer identity", () => {
  const base = {
    operationKind: "method",
    sourceArgumentCarriers: [int32, int32],
    resultCarrier: bool,
    isAsync: false,
    isFallible: false,
  };
  assert.equal(finalizeRustProviderOperationAbi({
    ...base,
    form: { form: "call", path: "acme::run", argOrder: [0] },
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    ...base,
    form: { form: "call", path: "acme::run", argOrder: [0, 0] },
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    ...base,
    form: {
      form: "call",
      path: "acme::run",
      trailingArguments: [{ kind: "integer", value: Number.MAX_SAFE_INTEGER + 1 }],
    },
  }), undefined);
  const rawPointer = { kind: "pointer", pointee: int32, mutability: "const" };
  const rawPointerReceiver = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "receiver-method", name: "write", mutatesReceiver: true },
    sourceReceiverCarrier: rawPointer,
    sourceArgumentCarriers: [],
    resultCarrier: unit,
    isAsync: false,
    isFallible: false,
  });
  assert.ok(rawPointerReceiver);
  assert.deepEqual(rawPointerReceiver.targetReceiver.input.parameterCarrier, {
    kind: "reference",
    referent: rawPointer,
    mutable: true,
  });
});

test("operation forms fail closed for missing discriminant data, unknown variants, and sparse arrays", () => {
  const base = {
    operationKind: "method",
    sourceArgumentCarriers: [int32],
    resultCarrier: bool,
    isAsync: false,
    isFallible: false,
  };
  const sparseOne = Array(1);
  const sparseTwo = Array(2);
  sparseTwo[0] = 0;

  const malformedForms = [
    { form: "call", argModes: ["value"] },
    { form: "receiver-method", argModes: ["value"] },
    { form: "unknown", path: "acme::run" },
    { form: "call", path: "acme::run", argModes: sparseOne },
    { form: "call", path: "acme::run", argConversions: sparseOne },
    { form: "call", path: "acme::run", argOrder: sparseOne },
    { form: "call", path: "acme::run", trailingArguments: sparseOne },
    { form: "call", path: "acme::run", chain: sparseOne },
  ];
  for (const form of malformedForms) {
    assert.equal(finalizeRustProviderOperationAbi({ ...base, form }), undefined);
  }
  assert.equal(finalizeRustProviderOperationAbi({
    ...base,
    form: { form: "call", path: "acme::run" },
    sourceArgumentCarriers: sparseOne,
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    ...base,
    form: { form: "call", path: "acme::run" },
    declaredSourceArgumentCarriers: sparseOne,
  }), undefined);
  assert.equal(finalizeRustProviderOperationAbi({
    ...base,
    form: { form: "call", path: "acme::run" },
    sourceArgumentCarriers: [int32, int32],
    compileTimeSourceArgumentIndexes: sparseTwo,
  }), undefined);
});

test("finalized ABI rejects sparse arrays at every nested contract boundary", () => {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call", path: "acme::run", argModes: ["value"] },
    sourceArgumentCarriers: [int32],
    resultCarrier: bool,
    isAsync: false,
    isFallible: false,
  });
  assert.ok(abi);

  const sparse = Array(abi.sourceArguments.length);
  const malformed = [
    { ...abi, sourceArguments: sparse },
    { ...abi, targetArguments: Array(abi.targetArguments.length) },
    { ...abi, targetGenericArguments: Array(1) },
    { ...abi, target: { ...abi.target, argModes: Array(1) } },
  ];
  for (const candidate of malformed) {
    assert.doesNotThrow(() => validateRustFinalizedOperationAbi(candidate));
    assert.equal(validateRustFinalizedOperationAbi(candidate), false);
  }
});

test("target type references honor optional target-specific payloads and reject malformed children", () => {
  const sparseTypes = Array(1);
  const sparseGenericArguments = Array(1);
  const payloadFree = { kind: "target-specific", target: "rust", name: "source-nullish" };
  const slice = { kind: "slice", element: int32 };
  assert.equal(isRustTargetTypeRef(payloadFree), true);
  assert.equal(rustTargetTypeRefEquals(payloadFree, { ...payloadFree }), true);
  assert.equal(isRustTargetTypeRef(slice), true);
  assert.equal(rustTargetTypeRefEquals(slice, { kind: "slice", element: { ...int32 } }), true);
  const malformed = [
    { kind: "target-named", id: "acme.Type", genericArguments: sparseGenericArguments },
    { kind: "tuple", elements: sparseTypes },
    { kind: "function-pointer", args: sparseTypes, result: unit },
    { kind: "target-specific", target: "rust", name: "opaque", value: () => undefined },
    { kind: "target-specific", target: "", name: "opaque" },
    { kind: "target-specific", target: "csharp", name: "opaque" },
    { kind: "target-specific", target: "rust", name: "" },
    { kind: "slice" },
    { kind: "slice", element: int32, mutable: false },
  ];
  for (const candidate of malformed) {
    assert.equal(isRustTargetTypeRef(candidate), false);
    assert.equal(rustTargetTypeRefEquals(candidate, candidate), false);
    assert.equal(rustTargetTypeRefEquals(candidate, unit), false);
    assert.equal(rustTargetTypeRefEquals(unit, candidate), false);
  }
});

test("closed metadata rejects sparse, accessor-backed, and custom-property arrays without invoking accessors", () => {
  const sparse = Array(1);
  const custom = [1];
  custom.extra = true;
  let getterCalls = 0;
  const accessor = [];
  Object.defineProperty(accessor, "0", {
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  accessor.length = 1;

  for (const candidate of [sparse, custom, accessor]) {
    assert.equal(isClosedMetadata(candidate), false);
    assert.throws(() => snapshotClosedMetadata(candidate), /sparse, accessor-backed, or custom-property array/u);
  }
  assert.equal(getterCalls, 0);
});

test("closed metadata preserves exact arbitrary-width Rust const integers", () => {
  const value = { kind: "integer", value: 18446744073709551615n };
  assert.equal(isClosedMetadata(value), true);
  assert.deepEqual(snapshotClosedMetadata(value), value);
  assert.equal(
    closedMetadataKey(value),
    "{4:kind=s:7:integer,5:value=i:18446744073709551615}",
  );
});
