import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  assertRustTargetRejection,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "../../helpers/rust-session.mjs";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import {
  rustJsArrayTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUndefinedTargetType,
  rustVecTargetType,
} from "../../../dist/target-model/types/index.js";
import { rustInt32ToFloat64ValueConversion } from "../../../dist/target-model/conversions/model.js";

const denseSource = `
import type { int32 } from "@tsonic/core/types.js";

export function sum(): int32 {
  const xs: int32[] = [1, 2, 3];
  let total: int32 = 0;
  for (const value of xs) {
    total += value;
  }
  return total + xs.length;
}
`;

const sparseSource = `
export function tail_is_hole(): boolean {
  const values = [1, , 3];
  values.length = 5;
  values[3] = 4;
  return values.at(-1) === undefined;
}
`;

test("string padding selects one exact overload row from finalized carriers", () => {
  const stringCarrier = rustStringTargetType();
  const float64Carrier = rustSourcePrimitiveTargetType("float64");
  const int32Carrier = rustSourcePrimitiveTargetType("int32");

  const floatDefault = selectJsSurfaceOperation({
    ownerName: "String",
    memberName: "padStart",
    operationKind: "call",
    receiverCarrier: stringCarrier,
    argumentCarriers: [float64Carrier],
  });
  assert.equal(floatDefault?.fact.operationId, "tsonic.rust.js.String.padStart.call.float64-default");
  assert.deepEqual(floatDefault?.fact.target, {
    form: "free-call",
    path: "js_string::pad_start",
    receiverMode: "ref",
    argModes: ["value"],
  });

  const intFill = selectJsSurfaceOperation({
    ownerName: "String",
    memberName: "padEnd",
    operationKind: "call",
    receiverCarrier: stringCarrier,
    argumentCarriers: [int32Carrier, stringCarrier],
  });
  assert.equal(intFill?.fact.operationId, "tsonic.rust.js.String.padEnd.call.int32-fill");
  assert.deepEqual(intFill?.fact.target, {
    form: "free-call",
    path: "js_string::pad_end_with",
    receiverMode: "ref",
    argModes: ["value", "ref"],
    argConversions: [rustInt32ToFloat64ValueConversion, undefined],
  });

  assert.equal(selectJsSurfaceOperation({
    ownerName: "String",
    memberName: "padStart",
    operationKind: "call",
    receiverCarrier: stringCarrier,
    argumentCarriers: [stringCarrier],
  }), undefined);
  assert.equal(selectJsSurfaceOperation({
    ownerName: "String",
    memberName: "padStart",
    operationKind: "call",
    receiverCarrier: stringCarrier,
    argumentCarriers: [float64Carrier, float64Carrier],
  }), undefined);
});

test("array index rows distinguish checked source and runtime result carriers", () => {
  const elementCarrier = rustSourcePrimitiveTargetType("int32");
  const selected = selectJsSurfaceOperation({
    ownerName: "ReadonlyArray",
    memberName: "index",
    operationKind: "indexer",
    receiverCarrier: rustJsArrayTargetType(elementCarrier),
    argumentCarriers: [elementCarrier],
  });

  assert.equal(selected?.fact.kind, "provider-operation");
  assert.deepEqual(selected?.fact.sourceResultCarrier, elementCarrier);
  assert.deepEqual(selected?.fact.sourceAbsenceCarrier, rustUndefinedTargetType());
  assert.deepEqual(selected?.fact.resultCarrier, {
    kind: "target-named",
    id: "rust.std.Option",
    genericArguments: [{ kind: "type", type: elementCarrier }],
  });
});

test("unavailable argument carriers defer only when one operation row remains", () => {
  const unresolvedMatchScore = (_expected, actual) => actual === undefined ? 100 : undefined;
  const json = selectJsSurfaceOperation({
    ownerName: "JSON",
    memberName: "parse",
    operationKind: "call",
    argumentCarriers: [undefined],
    argumentMatchScore: unresolvedMatchScore,
  });
  assert.equal(json?.fact.operationId, "tsonic.rust.js.JSON.parse.call");

  assert.equal(selectJsSurfaceOperation({
    ownerName: "String",
    memberName: "padStart",
    operationKind: "call",
    receiverCarrier: rustStringTargetType(),
    argumentCarriers: [undefined],
    argumentMatchScore: unresolvedMatchScore,
  }), undefined);
});

test("console rows select one generic closed value-slice ABI", () => {
  const selection = selectJsSurfaceOperation({
    ownerName: "Console",
    memberName: "log",
    operationKind: "call",
    argumentCarriers: [
      rustStringTargetType(),
      rustSourcePrimitiveTargetType("int32"),
      rustSourcePrimitiveTargetType("bool"),
    ],
  });

  assert.equal(selection?.fact.kind, "provider-operation");
  assert.deepEqual(selection?.fact.target, {
    form: "call-value-slice",
    path: "js_abi::console_log",
    leadingArguments: [],
    elementCarrier: { kind: "target-named", id: "rust.js.JsValue" },
  });
  assert.equal(selection?.fact.parameterCarriers, undefined);
  assert.deepEqual(selection?.fact.resultCarrier, { kind: "tuple", elements: [] });
});

test("Object.is lowers closed source values through exact JsValue conversions", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function same(): boolean {
  return Object.is(Number.NaN, Number.NaN) &&
    !Object.is(0, -0) &&
    Object.is("same", "same");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::object_is\(\[[\s\S]*?JsValue::from\(js_abi::NUMBER_NAN\),[\s\S]*?JsValue::from\(js_abi::NUMBER_NAN\),[\s\S]*?\]\)/u);
  assert.match(text, /!js_abi::object_is\(\[[\s\S]*?JsValue::from\(0\.0\),[\s\S]*?JsValue::from\(-0\.0\),?[\s\S]*?\]\)/u);
  assert.match(text, /js_abi::object_is\(\[[\s\S]*?js_value_from_string\("same"\),[\s\S]*?js_value_from_string\("same"\),[\s\S]*?\]\)/u);
});

test("console calls lower closed primitive and object values", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function write(label: string, count: int32, ok: boolean): void {
  console.log(label, count, ok);
  console.info();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::console_log\(&\[\n        js_abi::js_value_from_string\(&label\),\n        js_abi::JsValue::from\(count\),\n        js_abi::JsValue::from\(ok\),\n    \]\);/u);
  assert.match(text, /js_abi::console_info\(&\[\]\);/u);

  const object = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": "export function write(): void { console.log({ ok: true }); }\n",
    },
  });
  assert.deepEqual(object.result.diagnostics, []);
  const objectText = artifactText(object.result, "src/index.rs");
  assert.match(objectText, /js_abi::console_log\(&\[\{[\s\S]*?js_value_from_optional_pairs\(vec!\[[\s\S]*?Some\(\([\s\S]*?"ok",[\s\S]*?JsValue::from\([\s\S]*?state\.ok[\s\S]*?\)\),[\s\S]*?\]\)[\s\S]*?\}\]\);/u);
});

test("string padding emits fallible runtime calls for explicit and default fillers", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function pad(): string {
  return "7".padStart(3, "0") + "x".padEnd(2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn pad\(\) -> Result<String, rt::TsonicError>/u);
  assert.match(text, /js_string::pad_start_with\("7", 3\.0, "0"\)\?/u);
  assert.match(text, /js_string::pad_end\("x", 2\.0\)\?/u);
});

test("JS arrays lower to one identity-preserving carrier with fact-backed iteration", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": denseSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let xs: js_abi::JsArray<i32> = js_abi::JsArray::from_dense\(vec!\[1, 2, 3\]\);/u);
  assert.match(text, /for value in xs\.iter_values\(\) \{/u);
  assert.match(text, /total \+ rt::conversions::usize_to_i32\(xs\.len\(\)\)\?/u);
});

test("variadic and mutating array calls lower through exact identity-backed runtime rows", () => {
  const int32Carrier = rustSourcePrimitiveTargetType("int32");
  const receiverCarrier = rustJsArrayTargetType(int32Carrier);
  const push = selectJsSurfaceOperation({
    ownerName: "Array",
    memberName: "push",
    operationKind: "call",
    receiverCarrier,
    argumentCarriers: [int32Carrier, int32Carrier],
  });
  assert.deepEqual(push?.fact.target, {
    form: "receiver-value-array",
    name: "push_many",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: int32Carrier,
  });

  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function edit(values: int32[]): int32 {
  const length = values.push(2, 3);
  values.unshift(0, 1);
  const removed = values.splice(1, 2, 7, 8);
  values.fill(4);
  values.fill(5, 1);
  values.fill(9, 1, 2);
  values.copyWithin(0, 2);
  values.reverse();
  values.sort();
  return length + (values.pop() ?? 0) + (values.shift() ?? 0) + removed.length + values.lastIndexOf(9, -1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /values\.push_many\(\[2, 3\]\)/u);
  assert.match(text, /values\.unshift_many_discard\(\[0, 1\]\)/u);
  assert.match(text, /values\.splice_many\(1\.0, 2\.0, \[7, 8\]\)/u);
  assert.match(text, /values\.fill_all\(4\)/u);
  assert.match(text, /values\.fill_from\(5, 1\.0\)/u);
  assert.match(text, /values\.fill_to\(9, 1\.0, 2\.0\)/u);
  assert.match(text, /values\.copy_within_from\(0\.0, 2\.0\)/u);
  assert.match(text, /values\.reverse\(\)/u);
  assert.match(text, /values\.sort_by_js_string\(\)/u);
  assert.match(text, /values\.last_index_of\(&9, -1\.0\)/u);
});

test("Array static operations lower through exact selected generic and unknown carriers", () => {
  const int32Carrier = rustSourcePrimitiveTargetType("int32");
  const of = selectJsSurfaceOperation({
    ownerName: "ArrayConstructor",
    memberName: "of",
    operationKind: "call",
    argumentCarriers: [int32Carrier, int32Carrier],
    selectedMethodTypeArgumentCarriers: [int32Carrier],
  });
  assert.deepEqual(of?.fact.target, {
    form: "call-value-array",
    path: "js_abi::array_of",
    leadingArguments: [],
    elementCarrier: int32Carrier,
  });
  assert.deepEqual(of?.resultCarrier, rustJsArrayTargetType(int32Carrier));

  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function values(): string {
  const input = JSON.parse("[1]");
  const made = Array.of<int32>(1, 2, 3);
  const text = Array.from("a😀");
  return made.join("-") + text.join("") + (Array.isArray(input) ? "Y" : "N");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(
    text,
    /let made: js_abi::JsArray<i32> = js_abi::array_of\(\[1, 2, 3\]\);/u,
  );
  assert.match(text, /js_abi::array_from_string\("a😀"\)/u);
  assert.match(text, /js_abi::array_is_array_value\(&input\)/u);
});

test("Array.from consumes exact native vectors and selected mapping callbacks", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function copy(values: Map<string, string>): string {
  const copied = Array.from(values.values());
  const mapped = Array.from(values.values(), (value) => value.toUpperCase());
  return copied.join(",") + ":" + mapped.join(",");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::array_from_vec\(&values\.values\(\)\)/u);
  assert.match(text, /js_abi::array_from_vec_map/u);
});

test("Array concat tags exact scalar and array arguments while preserving the receiver lane", () => {
  const int32Carrier = rustSourcePrimitiveTargetType("int32");
  const arrayCarrier = rustJsArrayTargetType(int32Carrier);
  const selected = selectJsSurfaceOperation({
    ownerName: "Array",
    memberName: "concat",
    operationKind: "call",
    receiverCarrier: arrayCarrier,
    argumentCarriers: [int32Carrier, arrayCarrier],
  });
  assert.deepEqual(selected?.fact.target, {
    form: "receiver-tagged-array",
    name: "concat",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: {
      kind: "target-named",
      id: "rust.js.JsArrayConcatItem",
      genericArguments: [{ kind: "type", type: int32Carrier }],
    },
    alternatives: [
      { inputCarrier: int32Carrier, mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Value" },
      { inputCarrier: arrayCarrier, mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Array" },
    ],
  });

  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function values(): string {
  const left: int32[] = [1, 2, 3];
  const right: int32[] = [5];
  return left.concat(4, right).join(",");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /left[\s\S]*\.concat\(\[[\s\S]*JsArrayConcatItem::Value\([\s\S]*f64_to_i32\(4\.0\)\?[\s\S]*JsArrayConcatItem::Array\(right\)[\s\S]*\]\)/u);
});

test("sparse arrays lower to JsArray with holes, length writes, and at()", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": sparseSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let values: js_abi::JsArray<f64> = js_abi::JsArray::from_sparse\(3, vec!\[\(0, 1\.0\), \(2, 3\.0\)\]\);/u);
  assert.match(text, /values\.set_len\(rt::conversions::i32_to_usize\(5\)\?\);/u);
  assert.match(text, /values\.set_number\(3\.0, 4\.0\);/u);
  assert.match(text, /values\.at\(-1\.0\)\.is_none\(\)/u);
  assert.match(text, /use tsonic_rust_js::abi as js_abi;/u);
});

test("source primitive aliases do not contaminate unrelated inferred JS number carriers", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function update(): void {
  const dense: int32[] = [1, 2, 3];
  const sparse = [1, , 3];
  sparse[3] = 4;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let dense: js_abi::JsArray<i32> = js_abi::JsArray::from_dense\(vec!\[1, 2, 3\]\);/u);
  assert.match(text, /let sparse: js_abi::JsArray<f64> = js_abi::JsArray::from_sparse/u);
  assert.match(text, /sparse\.set_number\(3\.0, 4\.0\);/u);
});

test("string members lower to the runtime string module by declaration identity", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(name: string): boolean {
  const upper: string = name.toUpperCase();
  return upper.startsWith("A") && upper.includes("B") && name.length > 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn probe\(name: &str\) -> Result<bool, rt::TsonicError> \{/u);
  assert.match(text, /js_string::to_upper_case\(name\)/u);
  assert.match(text, /js_string::starts_with_from_start\(&upper, "A"\)/u);
  assert.match(text, /js_string::includes_from_start\(&upper, "B"\)/u);
  assert.match(text, /rt::conversions::usize_to_i32\(\s*js_string::js_len\(name\),?\s*\)\? > 0/su);
});

test("string index signatures and zero-argument Date construction use exact JS rows", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function probe(text: string, index: int32): boolean {
  const now = new Date();
  return text[0] === "a" && text[index] === "b" && now.getTime() <= Date.now();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_string::char_at\(&text, 0\.0\)\?/u);
  assert.match(
    text,
    /js_string::char_at\(\s*&text,\s*rt::conversions::i32_to_f64\(index\),?\s*\)\?/u,
  );
  assert.match(text, /js_abi::JsDate::new\(\)/u);
});

test("string slicing, code points, repeat, and JS array copies use exact rows", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function probe(text: string, values: readonly int32[]): boolean {
  const copied = values.slice(1, 3);
  const point = text.codePointAt(0) ?? 0;
  return text.slice(1, -1) === "bc" &&
    text.repeat(2) === "abcdabcd" &&
    copied.join("-") === "2-3" &&
    point === 97;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn probe\(text: &str, values: js_abi::JsArray<i32>\) -> Result<bool, rt::TsonicError>/u);
  assert.match(text, /values\.slice_to\(1\.0, 3\.0\)/u);
  assert.match(text, /copied\.join\("-"\)/u);
  assert.match(text, /js_string::slice_to\(text, 1\.0, -1\.0\)\?/u);
  assert.match(text, /js_string::repeat\(text, 2\.0\)\?/u);
  assert.match(
    text,
    /let point: f64 = rt::option_coalesce\(\n {8}js_string::code_point_at\(text, 0\.0\),\n {8}core::convert::identity,\n {8}\|\| 0\.0,\n {4}\);/u,
  );
});

test("complete closed string rows consume selected overloads and preserve exact ABI shapes", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function probe(text: string, index: int32): string {
  const pieces = text.split(",", 2);
  const code = text.charCodeAt(index);
  const found = text.lastIndexOf("a", index);
  const section = text.substring(1, 3) + text.substr(-2, 1);
  const replaced = text.replace("a", "[$&]").replaceAll("b", "B");
  const joined = text.concat("-", section);
  if (pieces.length === 2 && code >= 0 && found >= -1) {
    return joined + replaced + String.fromCharCode(65, 66) +
      String.fromCodePoint(0x1f600) + text.trimLeft().trimRight().valueOf();
  }
  return "";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_string::split\(text, ",", 2\.0\)\?/u);
  assert.match(text, /js_string::char_code_at\(text, rt::conversions::i32_to_f64\(index\)\)/u);
  assert.match(text, /js_string::last_index_of\([\s\S]*text,[\s\S]*"a",[\s\S]*i32_to_f64\(index\),[\s\S]*\)/u);
  assert.match(text, /js_string::substring\(text, 1\.0, 3\.0\)\?/u);
  assert.match(text, /js_string::substr\(\s*text,\s*-2\.0,\s*1\.0,?\s*\)\?/u);
  assert.match(text, /js_string::replace\(text, "a", "\[\$&\]"\)/u);
  assert.match(text, /js_string::replace_all\(&js_string::replace\(text, "a", "\[\$&\]"\), "b", "B"\)\?/u);
  assert.match(text, /js_string::concat\(text, &\["-", section\.as_str\(\)\]\)/u);
  assert.match(text, /js_string::from_char_code\(&\[65\.0, 66\.0\]\)\?/u);
  assert.match(text, /js_string::from_code_point\(&\[128512\.0\]\)\?/u);
  assert.match(text, /js_string::trim_start\(text\)/u);
  assert.match(text, /js_string::identity/u);
});

test("array copy and stringification rows reject unproven generic element traits", () => {
  const receiver = rustVecTargetType({ kind: "type-parameter", name: "T" });
  assert.equal(selectJsSurfaceOperation({
    ownerName: "Array",
    memberName: "slice",
    operationKind: "call",
    receiverCarrier: receiver,
    argumentCarriers: [],
  }), undefined);
  assert.equal(selectJsSurfaceOperation({
    ownerName: "Array",
    memberName: "join",
    operationKind: "call",
    receiverCarrier: rustVecTargetType({ kind: "source-primitive", name: "float64" }),
    argumentCarriers: [],
  }), undefined);
  assert.equal(selectJsSurfaceOperation({
    ownerName: "Array",
    memberName: "join",
    operationKind: "call",
    receiverCarrier: receiver,
    argumentCarriers: [],
  }), undefined);
});

test("Number predicates consume exact numeric carriers and reject non-numbers", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function probe(value: number, integer: int32): boolean {
  return Number.isFinite(value) && Number.isInteger(value) &&
    Number.isSafeInteger(value) && !Number.isNaN(value) &&
    Number.isFinite(integer);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::number_is_finite\(value\)/u);
  assert.match(text, /js_abi::number_is_integer\(value\)/u);
  assert.match(text, /js_abi::number_is_safe_integer\(value\)/u);
  assert.match(text, /js_abi::number_is_nan\(value\)/u);
  assert.match(text, /js_abi::number_is_finite\(rt::conversions::i32_to_f64\(integer\)\)/u);

  assertRustTargetRejection({
    surfaces: ["js"],
    files: {
      "index.ts": "export function probe(value: string): boolean { return Number.isFinite(value); }\n",
    },
  }, [{
    code: "RUST_SELECTED_OPERATION_UNSUPPORTED",
    message: "The selected JavaScript call 'NumberConstructor.isFinite' has no closed Rust operation row for the selected receiver and argument carriers.",
  }]);
});

test("Map and Set lower to runtime carriers with SameValueZero semantics", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function collections(): boolean {
  const m = new Map<int32, string>();
  m.set(1, "one");
  const s = new Set<int32>();
  s.add(4);
  return m.has(1) && m.get(2) === undefined && s.has(4) && m.size === 1 && !s.has(5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let m: js_abi::JsMap<i32, String> = js_abi::JsMap::new\(\);/u);
  assert.match(text, /m\.set_discard\(1, String::from\("one"\)\);/u);
  assert.match(text, /m\.has\(&1\)/u);
  assert.match(text, /m\.get\(&2\)\.is_none\(\)/u);
  assert.match(text, /s\.add_discard\(4\);/u);
  assert.match(text, /rt::conversions::usize_to_i32\(m\.len\(\)\)\? == 1/u);
});

test("Date lowers to the UTC runtime carrier", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function timing(): boolean {
  const d = new Date(1000);
  return d.getTime() === 1000;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::JsDate::from_millis\(1000\.0\)/u);
  assert.match(text, /d\.get_time\(\) == 1000\.0/u);
});
