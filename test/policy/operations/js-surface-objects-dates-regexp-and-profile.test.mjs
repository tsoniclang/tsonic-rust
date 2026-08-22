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

test("Date string construction selects the exact string constructor row", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function timing(): boolean {
  const d = new Date("1970-01-02T00:00:00.000Z");
  return d.getTime() === 86400000;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::JsDate::from_string\("1970-01-02T00:00:00.000Z"\)/u);
});

test("Boolean, Unicode string, and mutable UTC Date operations use exact runtime rows", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function exact(value: string, month: int32): boolean {
  const date = new Date(Date.UTC(2020, month));
  date.setUTCFullYear(2024, 1, 29);
  date.setUTCHours(1, 2, 3, 4);
  return value.normalize("NFKC").isWellFormed() &&
    value.toWellFormed().length >= 0 &&
    true.toString() === "true" && true.valueOf() &&
    date.getUTCFullYear() === 2024 && date.getUTCMonth() === 1 &&
    date.getUTCDay() === 4 && date.toUTCString().endsWith("GMT");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_string::normalize_with_form/u);
  assert.match(text, /js_string::is_well_formed/u);
  assert.match(text, /js_abi::boolean_to_string/u);
  assert.match(text, /js_abi::JsDate::utc/u);
  assert.match(text, /set_utc_full_year_month_date/u);
  assert.match(text, /set_utc_hours_minutes_seconds_milliseconds/u);
  assert.match(text, /get_utc_day_number/u);
  assert.match(text, /to_utc_string/u);
});

test("closed object projections lower from exact structural facts", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function project(): boolean {
  const value = { tail: "tail", 10: "ten", 2: "two", "01": "leading" };
  const keys = Object.keys(value);
  const values = Object.values(value);
  const entries = Object.entries(value);
  const reordered = { "01": "leading", tail: "tail", 2: "two", 10: "ten" };
  const reorderedKeys = Object.keys(reordered);
  let backing = "value";
  let reads = 0;
  const accessed = {
    tail: "tail",
    get current(): string { reads += 1; return backing; },
    set current(next: string) { backing = next; },
  };
  const accessorKeys = Object.keys(accessed);
  const accessorValues = Object.values(accessed);
  const accessorEntries = Object.entries(accessed);
  return keys.length === 4 && values.length === 4 && entries.length === 4 &&
    reorderedKeys.length === 4 && accessorKeys.length === 2 &&
    accessorValues.length === 2 && accessorEntries.length === 2 &&
    reads === 2 && Object.hasOwn(value, "tail") && value.hasOwnProperty("01");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::JsArray::from_dense\(vec!\[/u);
  assert.match(text, /object_projection_value/u);
  assert.match(text, /\.with\(\|state\|/u);
  assert.match(text, /\.as_str\(\) == "tail"/u);
  assert.match(text, /record_getter/u);
});

test("open and spread-derived object projections fail closed", () => {
  assertRustTargetRejection({
    surfaces: ["js"],
    files: {
      "index.ts": `
interface Named { name: string }
export function keys(value: Named): string[] {
  return Object.keys(value);
}
`,
    },
  }, [{
    code: "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
    message: "Selected Object.keys call requires one exact generated structural object carrier.",
  }]);

  assertRustTargetRejection({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function keys(): string[] {
  const base = { first: "one" };
  return Object.keys({ ...base, second: "two" });
}
`,
    },
  }, [{
    code: "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
    message: "Closed Object projection fields do not belong to one unambiguous authored object literal.",
  }]);
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
  assert.match(text, /let same_date: js_abi::JsDate = date\.clone\(\);/u);
  assert.match(text, /let same_pattern: js_abi::JsRegExp = pattern\.clone\(\);/u);
  assert.match(text, /same_pattern\.test\("1"\)\?/u);
  assert.match(text, /same_date == date/u);
  assert.match(text, /i32_to_f64\(pattern\.last_index\(\)\) == 1\.0/u);
});

test("js surface contributes the rust-js cargo dependency", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": denseSource } });
  assert.deepEqual(result.diagnostics, []);
  const manifest = artifactText(result, "Cargo.toml");
  assert.match(manifest, /tsonic_rust_js = \{ path = ".*rust-js\/crates\/tsonic_rust_js" \}/u);
});

test("the native source profile rejects sparse-array JS APIs", () => {
  const harness = createRustSession({ files: { "index.ts": sparseSource } });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TS2339: Property 'length' does not exist/u);
  assert.match(diagnostics, /TS2550: Property 'at' does not exist/u);
});

test("the native source profile excludes JS string members", () => {
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

test("dynamic any member access fails closed under the JS surface without selected evidence", () => {
  const options = {
    surfaces: ["js"],
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

test("dynamic new RegExp lowers through selected constructor evidence", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(source: string, text: string): boolean {
  const pattern = new RegExp(source);
  return pattern.test(text);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /js_abi::JsRegExp::from_string\(&source\)\?/u);
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
  assert.match(text, /pub fn sum\(xs: js_abi::JsArray<i32>\) -> Result<i32, rt::TsonicError> \{/u);
  assert.match(text, /for x in xs\.iter_values\(\) \{/u);
  assert.match(text, /total \+ tsonic_rust_runtime::conversions::usize_to_i32\(xs\.len\(\)\)\?/u);
  assert.match(text, /sum\(values\)/u);
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
  assert.match(text, /value_or_zero\(Option::<i32>::None\)/u);
  assert.match(text, /value_or_zero\(Some\(7\)\)/u);
});
