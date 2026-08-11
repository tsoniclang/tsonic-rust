import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  assertRustTargetRejection,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";
import { selectJsSurfaceOperation } from "../dist/source/rust-target-semantics/js-surface-operations.js";
import {
  rustJsArrayTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustVecTargetType,
} from "../dist/source/rust-target-types.js";
import { rustInt32ToFloat64ValueConversion } from "../dist/source/rust-facts/value-conversions.js";

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

test("unavailable argument carriers defer only when one operation row remains", () => {
  const unresolvedCompatibility = (_expected, actual) => actual === undefined ? 100 : undefined;
  const json = selectJsSurfaceOperation({
    ownerName: "JSON",
    memberName: "stringify",
    operationKind: "call",
    argumentCarriers: [undefined],
    argumentCompatibility: unresolvedCompatibility,
  });
  assert.equal(json?.fact.operationId, "tsonic.rust.js.JSON.stringify.call");

  assert.equal(selectJsSurfaceOperation({
    ownerName: "String",
    memberName: "padStart",
    operationKind: "call",
    receiverCarrier: rustStringTargetType(),
    argumentCarriers: [undefined],
    argumentCompatibility: unresolvedCompatibility,
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
  assert.match(text, /!js_abi::object_is\(\[[\s\S]*?JsValue::from\(0\.0\),[\s\S]*?JsValue::from\(-0\.0\),[\s\S]*?\]\)/u);
  assert.match(text, /js_abi::object_is\(\[[\s\S]*?js_value_from_string\("same"\),[\s\S]*?js_value_from_string\("same"\),[\s\S]*?\]\)/u);
});

test("console calls lower closed primitive values and reject unsupported object carriers", () => {
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
  assert.match(text, /js_abi::console_log\(&\[\n        tsonic_rust_js::abi::js_value_from_string\(&label\),\n        tsonic_rust_js::abi::JsValue::from\(count\),\n        tsonic_rust_js::abi::JsValue::from\(ok\),\n    \]\);/u);
  assert.match(text, /js_abi::console_info\(&\[\]\);/u);

  assertRustTargetRejection({
    surfaces: ["js"],
    files: {
      "index.ts": "export function write(): void { console.log({ ok: true }); }\n",
    },
  }, [{
    code: "RUST_SELECTED_PARAMETER_CARRIER_MISSING",
    message: "Selected call 'log' has no closed Rust carrier for every target parameter.",
  }]);
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
  assert.match(text, /pub fn pad\(\) -> rt::TsonicResult<String>/u);
  assert.match(text, /js_string::pad_start_with\("7", 3\.0, "0"\)\?/u);
  assert.match(text, /js_string::pad_end\("x", 2\.0\)\?/u);
});

test("JS arrays lower to one identity-preserving carrier with fact-backed iteration", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": denseSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let xs: js_abi::JsArray<i32> = js_abi::JsArray::from_dense\(vec!\[1, 2, 3\]\);/u);
  assert.match(text, /for value in xs\.iter_values\(\) \{/u);
  assert.match(text, /total \+ tsonic_rust_runtime::conversions::usize_to_i32\(xs\.len\(\)\)\?/u);
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
  assert.match(text, /values\.push_many\([\s\S]*f64_to_i32\(2\.0\)\?[\s\S]*f64_to_i32\(3\.0\)\?[\s\S]*\)/u);
  assert.match(text, /values\.unshift_many\([\s\S]*f64_to_i32\(0\.0\)\?[\s\S]*f64_to_i32\(1\.0\)\?[\s\S]*\)/u);
  assert.match(text, /values\.splice_many\([\s\S]*1\.0,[\s\S]*2\.0,[\s\S]*f64_to_i32\(7\.0\)\?[\s\S]*f64_to_i32\(8\.0\)\?[\s\S]*\)/u);
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
    /js_abi::array_of\(\[[\s\S]*f64_to_i32\(1\.0\)\?[\s\S]*f64_to_i32\(2\.0\)\?[\s\S]*f64_to_i32\(3\.0\)\?[\s\S]*\]\)/u,
  );
  assert.match(text, /js_abi::array_from_string\("a😀"\)/u);
  assert.match(text, /js_abi::array_is_array_value\(&input\)/u);
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
      typeArguments: [int32Carrier],
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
  assert.match(text, /left[\s\S]*\.concat\(\[[\s\S]*JsArrayConcatItem::Value\([\s\S]*f64_to_i32\(4\.0\)\?[\s\S]*JsArrayConcatItem::Array\(right\.clone\(\)\)[\s\S]*\]\)/u);
});

test("sparse arrays lower to JsArray with holes, length writes, and at()", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": sparseSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let values = js_abi::JsArray::from_sparse\(3, vec!\[\(0, 1\.0\), \(2, 3\.0\)\]\);/u);
  assert.match(text, /values\.set_len\(tsonic_rust_runtime::conversions::i32_to_usize\(5\)\?\);/u);
  assert.match(text, /values\.set\(tsonic_rust_runtime::conversions::i32_to_usize\(3\)\?, 4\.0\);/u);
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
  assert.match(text, /let sparse = js_abi::JsArray::from_sparse/u);
  assert.match(text, /sparse\.set\(tsonic_rust_runtime::conversions::i32_to_usize\(3\)\?, 4\.0\);/u);
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
  assert.match(text, /pub fn probe\(name: &str\) -> rt::TsonicResult<bool> \{/u);
  assert.match(text, /js_string::to_upper_case\(name\)/u);
  assert.match(text, /js_string::starts_with_from_start\(&upper, "A"\)/u);
  assert.match(text, /js_string::includes_from_start\(&upper, "B"\)/u);
  assert.match(text, /tsonic_rust_runtime::conversions::usize_to_i32\(\s*js_string::js_len\(name\),?\s*\)\? > 0/su);
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
  assert.match(text, /pub fn probe\(text: &str, values: js_abi::JsArray<i32>\) -> rt::TsonicResult<bool>/u);
  assert.match(text, /values\.slice_to\(1\.0, 3\.0\)/u);
  assert.match(text, /copied\.join\("-"\)/u);
  assert.match(text, /js_string::slice_to\(text, 1\.0, -1\.0\)\?/u);
  assert.match(text, /js_string::repeat\(text, 2\.0\)\?/u);
  assert.match(text, /js_string::code_point_at\(text, 0\.0\)\.unwrap_or\(0\.0\)/u);
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
  assert.match(text, /js_string::char_code_at\(text, tsonic_rust_runtime::conversions::i32_to_f64\(index\)\)/u);
  assert.match(text, /js_string::last_index_of\([\s\S]*text,[\s\S]*"a",[\s\S]*i32_to_f64\(index\),[\s\S]*\)/u);
  assert.match(text, /js_string::substring\(text, 1\.0, 3\.0\)\?/u);
  assert.match(text, /js_string::substr\(text, -2\.0, 1\.0\)\?/u);
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
  assert.match(text, /js_abi::number_is_finite\(tsonic_rust_runtime::conversions::i32_to_f64\(integer\)\)/u);

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
  assert.match(text, /let m = js_abi::JsMap::new\(\);/u);
  assert.match(text, /m\.set\(1, String::from\("one"\)\);/u);
  assert.match(text, /m\.has\(&1\)/u);
  assert.match(text, /m\.get\(&2\)\.is_none\(\)/u);
  assert.match(text, /s\.add\(4\);/u);
  assert.match(text, /tsonic_rust_runtime::conversions::usize_to_i32\(m\.len\(\)\)\? == 1/u);
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

test("mutable JS object assignments preserve reference identity", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function aliases(): boolean {
  const date = new Date(0);
  const sameDate = date;
  const pattern = /\\d+/g;
  const samePattern = pattern;
  samePattern.test("1");
  return sameDate === date && pattern.lastIndex === 1;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let sameDate = date\.clone\(\);/u);
  assert.match(text, /let samePattern = pattern\.clone\(\);/u);
  assert.match(text, /samePattern\.test\("1"\)\?/u);
  assert.match(text, /sameDate == date/u);
  assert.match(text, /i32_to_f64\(pattern\.last_index\(\)\) == 1\.0/u);
});

test("js surface contributes the rust-js cargo dependency", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": denseSource } });
  assert.deepEqual(result.diagnostics, []);
  const manifest = artifactText(result, "Cargo.toml");
  assert.match(manifest, /tsonic_rust_js = \{ path = ".*rust-js\/crates\/tsonic_rust_js" \}/u);
});

test("strict-native without js surface rejects sparse-array JS APIs during source checking", () => {
  const harness = createRustSession({ files: { "index.ts": sparseSource } });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TS2339: Property 'length' does not exist/u);
  assert.match(diagnostics, /TS2550: Property 'at' does not exist/u);
});

test("strict-native without js surface excludes JS string members from the source contract", () => {
  const harness = createRustSession({
    files: {
      "index.ts": `
export function probe(name: string): boolean {
  return name.includes("a");
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TS2550: Property 'includes' does not exist/u);
});

test("compat mode enables JS carrier lanes without explicit surface selection", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { typescriptCompatibility: "compat" } },
    files: { "index.ts": sparseSource },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /js_abi::JsArray::from_sparse\(3,/u);
  assert.match(artifactText(result, "Cargo.toml"), /tsonic_rust_js/u);
});

test("dynamic any member access fails closed even in compat mode", () => {
  const options = {
    target: { id: "rust", options: { typescriptCompatibility: "compat" } },
    files: {
      "index.ts": `
declare const value: any;

export function read(): string {
  return value.name;
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_SELECTED_EVIDENCE_MISSING",
    message: "Checked property access has no selected provider, source-profile, or project-source declaration evidence.",
  }]);
});

test("constant new RegExp lowers through the oracle-proven engine", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(text: string): boolean {
  const pattern = new RegExp("\\\\d+");
  return pattern.test(text);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /js_abi::JsRegExp::new\("\\\\d\+", ""\)\?/u);
});

test("readonly arrays retain shared JS identity while exposing only read operations", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function sum(xs: readonly int32[]): int32 {
  let total: int32 = 0;
  for (const x of xs) {
    total += x;
  }
  return total + xs.length;
}

export function caller(): int32 {
  const values: int32[] = [1, 2, 3];
  return sum(values);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn sum\(xs: js_abi::JsArray<i32>\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /for x in xs\.iter_values\(\) \{/u);
  assert.match(text, /total \+ tsonic_rust_runtime::conversions::usize_to_i32\(xs\.len\(\)\)\?/u);
  assert.match(text, /sum\(values\.clone\(\)\)/u);
});

test("undefined unions take the Option lane only under the js surface", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function value_or_zero(value: int32 | undefined): int32 {
  return value ?? 0;
}

export function caller(): int32 {
  return value_or_zero(undefined) + value_or_zero(7);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn value_or_zero\(value: Option<i32>\) -> i32/u);
  assert.match(text, /value_or_zero\(None\)/u);
  assert.match(text, /value_or_zero\(Some\(7\)\)/u);
});
