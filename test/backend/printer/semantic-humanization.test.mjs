import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("direct-only module callables lower to native functions across exact import forms", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "native_module_functions" },
    },
    files: {
      "api.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const increment = (value: int32): int32 => value + 1;
`,
      "named.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { increment as apply } from "./api.js";

export function named(value: int32): int32 { return apply(value); }
`,
      "namespace.ts": `
import type { int32 } from "@tsonic/core/types.js";
import * as api from "./api.js";

export function namespaced(value: int32): int32 { return api.increment(value); }
`,
      "bridge.ts": `
export { increment as next } from "./api.js";
`,
      "optional.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { next } from "./bridge.js";

export function optional(value: int32): int32 { return next?.(value); }
`,
      "index.ts": `
import { named } from "./named.js";
import { namespaced } from "./namespace.js";
import { optional } from "./optional.js";

export function main(): void {
  if (named(20) !== 21 || namespaced(41) !== 42 || optional(9) !== 10) {
    throw new Error("native module function mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const api = artifactText(result, "src/api.rs");
  assert.match(api, /pub fn increment\(value: i32\) -> i32/u);
  assert.doesNotMatch(api, /ModuleCell|Callable|thread_local!/u);
  assert.match(artifactText(result, "src/named.rs"), /crate::api::increment\(value\)/u);
  assert.match(artifactText(result, "src/namespace.rs"), /crate::api::increment\(value\)/u);
  assert.match(artifactText(result, "src/optional.rs"), /crate::api::increment\(value\)/u);
  validateGeneratedProject("native-module-functions", result.artifacts, { run: true });
});

test("first-class callable observation retains identity-bearing module storage", () => {
  const { result } = compileRust({
    files: {
      "api.ts": `
import type { int32 } from "@tsonic/core/types.js";
export const increment = (value: int32): int32 => value + 1;
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { increment as apply } from "./api.js";
export const retained = apply;
export function run(value: int32): int32 { return apply(value); }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const api = artifactText(result, "src/api.rs");
  assert.match(api, /pub type IncrementCallable = rt::Callable/u);
  assert.match(api, /ModuleCell<IncrementCallable>/u);
  assert.doesNotMatch(api, /type_complexity/u);
  assert.match(api, /pub static INCREMENT/u);
  assert.match(api, /pub fn increment/u);
  assert.doesNotMatch(api, /#\[doc\(hidden\)\]\npub(?:\(crate\))? fn increment/u);
  const index = artifactText(result, "src/index.rs");
  assert.match(index, /crate::api::INCREMENT\.with\(\|module_binding\| module_binding\.load\(\)\)/u);
  assert.match(index, /crate::api::increment\(value\)/u);
});

test("callback, return, and collection observations retain callable-value storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const selected = (value: int32): int32 => value + 1;
export function invoke(callback: (value: int32) => int32): int32 { return callback(1); }
export function obtain(): (value: int32) => int32 { return selected; }
export const callbackResult = invoke(selected);
export const retained = [selected];
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub type SelectedCallable = rt::Callable/u);
  assert.match(output, /ModuleCell<SelectedCallable>/u);
  assert.doesNotMatch(output, /type_complexity/u);
  assert.match(output, /pub static SELECTED/u);
  assert.match(output, /pub fn selected/u);
  assert.doesNotMatch(output, /#\[doc\(hidden\)\]\npub(?:\(crate\))? fn selected/u);
  assert.match(output, /invoke\(SELECTED\.with\(\|module_binding\| module_binding\.load\(\)\)\)/u);
  validateGeneratedProject("observed-module-callable", result.artifacts);
});

test("runtime module cycles do not acquire function hoisting implicitly", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "arrow_cycle" },
    },
    files: {
      "a.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromB } from "./b.js";
export const fromA = (value: int32): int32 => value <= 0 ? 1 : fromB(value - 1) + 1;
`,
      "b.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { fromA } from "./a.js";
export const fromB = (value: int32): int32 => value <= 0 ? 1 : fromA(value - 1) + 1;
`,
      "index.ts": `
import { fromA } from "./a.js";
export function main(): void { void fromA(3); }
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code === "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE"),
    true,
  );
});

test("top-level execution before a callable declaration retains temporal storage", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function invoke(): int32 { return later(); }
export const observed: int32 = invoke();
export const later = (): int32 => 1;
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub static LATER: rt::ModuleCell/u);
  assert.doesNotMatch(output, /pub fn later/u);
});

test("native function names remain collision-free without changing existing function names", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function fooBar(value: int32): int32 { return value + 1; }
export const foo_bar = (value: int32): int32 => value + 2;
export function run(): int32 { return fooBar(1) + foo_bar(1); }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn foo_bar\(value: i32\) -> i32/u);
  assert.match(output, /pub fn foo_bar_2\(value: i32\) -> i32/u);
  assert.match(output, /foo_bar\(1\) \+ foo_bar_2\(1\)/u);
});

test("native module functions preserve generic, default, rest, recursive, and function-expression ABIs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "native_function_abis" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const identity = <T>(value: T): T => value;
export const add = (value: int32, amount: int32 = 1): int32 => value + amount;
export const total = (...values: int32[]): int32 => {
  let result: int32 = 0;
  for (const value of values) result += value;
  return result;
};
export const depth = (value: int32): int32 => value <= 0 ? 0 : depth(value - 1) + 1;
export const doubled = function(value: int32): int32 { return value * 2; };

export function main(): void {
  if (identity<int32>(7) !== 7 || add(2) !== 3 || total(1, 2, 3) !== 6 ||
      depth(4) !== 4 || doubled(3) !== 6) {
    throw new Error("native function ABI mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn identity<T>/u);
  assert.match(output, /pub fn add\(value: i32, amount: Option<i32>\)/u);
  assert.match(output, /pub fn total\(values: Vec<i32>\)/u);
  assert.match(output, /pub fn depth\(value: i32\)/u);
  assert.match(output, /pub fn doubled\(value: i32\)/u);
  assert.match(output, /amount\.unwrap_or\(1\)/u);
  assert.doesNotMatch(output, /unnecessary_lazy_evaluations/u);
  assert.doesNotMatch(output, /let_and_return/u);
  assert.doesNotMatch(output, /ModuleCell|Callable|thread_local!/u);
  validateGeneratedProject("native-function-abis", result.artifacts, { run: true });
});

test("project methods preserve generic declarations and exact call type arguments", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "generic_project_methods" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class Identity {
  identity<T>(value: T): T { return value; }
}

export function main(): void {
  const identity = new Identity();
  if (identity.identity<string>("value") !== "value" ||
      identity.identity<int32>(7) !== 7) {
    throw new Error("generic project method mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn identity<T>\(&self, value: T\) -> T/u);
  assert.match(output, /identity\.identity::<String>\(String::from\("value"\)\)/u);
  assert.match(output, /identity\.identity::<i32>\(7\)/u);
  const run = validateGeneratedProject("generic-project-methods", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("non-consuming project access borrows direct and polymorphic receivers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Page {
  title: string;
  count: int32 = 0;
  constructor(title: string) { this.title = title; }
  readTitle(): string { return this.title; }
  rename(title: string): void { this.title = title; }
  get label(): string { return this.title; }
  set label(value: string) { this.title = value; }
}

export class Base {
  value: string;
  constructor(value: string) { this.value = value; }
  read(): string { return this.value; }
}

export class Derived extends Base {}

export function readTitle(page: Page): string { return page.title; }
export function readPolymorphic(value: Base): string { return value.value; }
export function writePolymorphic(value: Base): void { value.value = "updated"; }
export function callMethods(page: Page): string {
  const original = page.readTitle();
  page.rename("renamed");
  page.count += 1;
  page.label = "final";
  return original + page.label;
}
export function callPolymorphic(value: Base): string { return value.read(); }
export function consume(page: Page): string { return page.title; }
export function passByValue(page: Page): string { return consume(page); }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /let dispatch_receiver(?:_\d+)? = &page;/u);
  assert.match(output, /dispatch_receiver(?:_\d+)?\.dispatch\.read_page_title\(\)/u);
  assert.doesNotMatch(output, /page\.state/u);
  assert.match(output, /let dispatch_receiver = &value;/u);
  assert.match(output, /dispatch_receiver\.dispatch\.read_base_value\(\)/u);
  assert.doesNotMatch(output, /dispatch\.clone\(\)\.read_base_value\(\)/u);
  assert.match(output, /fn read_base_value\(\s*&self/u);
  assert.match(output, /fn write_base_value\(\s*&self/u);
  assert.match(output, /let receiver = &value;/u);
  assert.match(output, /\.dispatch\.write_base_value\(value_\d+\)/u);
  assert.doesNotMatch(output, /dispatch\.clone\(\)\.write_base_value\(/u);
  assert.match(output, /let dispatch_receiver = &project_this;/u);
  assert.match(output, /\.dispatch\s*\.clone\(\)\s*\.dispatch_page_read_title\(\)/u);
  assert.match(output, /\.dispatch\s*\.clone\(\)\s*\.dispatch_page_rename\(String::from\("renamed"\)\)/u);
  assert.doesNotMatch(output, /page\.(?:read_title|rename)\(/u);
  assert.match(output, /let receiver = &page;/u);
  assert.match(output, /let accessor_receiver = &page;/u);
  assert.match(output, /dispatch_receiver(?:_\d+)? = value;/u);
  assert.doesNotMatch(output, /dispatch_receiver(?:_\d+)? = value\.clone\(\);/u);
  assert.match(output, /consume\(page\)/u);
  assert.doesNotMatch(output, /consume\(page\.clone\(\)\)/u);
  validateGeneratedProject("non-consuming-project-access", result.artifacts);
});

test("native module functions participate in exact fallibility closure", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const risky = (flag: boolean): int32 => {
  if (flag) throw new Error("boom");
  return 7;
};

export function forwards(): int32 { return risky(false); }
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn risky\(flag: bool\) -> Result<i32, rt::TsonicError>/u);
  assert.match(output, /pub fn forwards\(\) -> Result<i32, rt::TsonicError>/u);
  assert.match(output, /risky\(false\)/u);
  assert.doesNotMatch(output, /ModuleCell|Callable|thread_local!/u);
});

test("sealed lifetime, append, and counted-loop plans remove only proven Rust costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "sealed_human_performance" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function inspect(value: string): number { return value.length; }

function returnAfterRead(value: string): string {
  void inspect(value);
  return value;
}

function returnThroughAssertion(value: string): string {
  void inspect(value);
  return (value as string);
}

function returnAcrossFinally(value: string): string {
  try {
    return value;
  } finally {
    void value.length;
  }
}

function returnAcrossCatch(value: string): string {
  try {
    return value;
  } catch {
    return value;
  }
}

function returnAcrossArrayIteration(values: string[]): string[] {
  for (const value of values) {
    if (value.length > 0) return values;
  }
  return values;
}

function returnAcrossSwitch(value: string, fallback: string): string {
  switch (value) {
    case "x": return value;
    default: return fallback;
  }
}

function appendPart(part: string): string {
  let output = "";
  output += "/";
  output += "'";
  output += "🙂";
  output += " " + part;
  return output;
}

function failPart(): string {
  throw new Error("append failure");
}

function appendFailure(): string {
  let output = "base";
  try {
    output += "prefix" + failPart();
  } catch {}
  return output;
}

function combine(values: string[]): string {
  let output = "";
  for (let index = 0; index < values.length; index++) {
    output += values[index]!;
  }
  return output;
}

function mapOrdinalTotal(values: Map<string, string>): number {
  let total = 0;
  for (let index = 0; index < values.size; index++) {
    total += index;
  }
  return total;
}

function scalarBoundTotal(limit: int32): number {
  let total = 0;
  for (let index = 0; index < limit; index++) {
    total += index;
    void inspect("x");
  }
  return total;
}

function mutatingArrayBound(values: string[]): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    total += index;
    if (index === 0) values.push("added");
  }
  return total;
}

function aliasedArrayBound(values: string[]): number {
  const alias = values;
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    total += index;
    if (index === 0) alias.push("added");
  }
  return total;
}

let externallyAliasedValues: string[] = [];

function growExternallyAliasedValues(): void {
  externallyAliasedValues.push("added");
}

function externallyMutatedArrayBound(values: string[]): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    total += index;
    if (index === 0) growExternallyAliasedValues();
  }
  return total;
}

function selfAppend(value: string): string {
  value += value;
  return value;
}

function unstableBound(limit: number): number {
  let total = 0;
  for (let index = 0; index < limit; index++) {
    total += index;
    limit -= 1;
  }
  return total;
}

export function main(): void {
  const first = returnAfterRead("value");
  const asserted = returnThroughAssertion("asserted");
  const second = returnAcrossFinally("retained");
  const caught = returnAcrossCatch("caught");
  const iterated = returnAcrossArrayIteration(["iterated"]);
  const switched = returnAcrossSwitch("x", "fallback");
  const appended = appendPart("a");
  const failedAppend = appendFailure();
  const combined = combine(["a", "b"]);
  const values = new Map<string, string>();
  values.set("a", "1");
  values.set("b", "2");
  const mapTotal = mapOrdinalTotal(values);
  externallyAliasedValues = ["a"];
  if (first !== "value" || asserted !== "asserted" ||
      second !== "retained" || caught !== "caught" ||
      iterated[0] !== "iterated" || switched !== "x" ||
      appended !== "/'🙂 a" || failedAppend !== "base" || combined !== "ab" ||
      mapTotal !== 1 || scalarBoundTotal(3) !== 3 ||
      mutatingArrayBound(["a"]) !== 1 || aliasedArrayBound(["a"]) !== 1 ||
      externallyMutatedArrayBound(externallyAliasedValues) !== 1 ||
      selfAppend("x") !== "xx" || unstableBound(4) !== 1) {
    throw new Error("sealed Rust humanization mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  const returnAfterStart = output.indexOf("fn return_after_read(");
  const assertionStart = output.indexOf("fn return_through_assertion(");
  const finallyStart = output.indexOf("fn return_across_finally(");
  const catchStart = output.indexOf("fn return_across_catch(");
  const iterationReturnStart = output.indexOf("fn return_across_array_iteration(");
  const switchReturnStart = output.indexOf("fn return_across_switch(");
  const appendStart = output.indexOf("fn append_part(");
  const appendFailureStart = output.indexOf("fn append_failure(");
  const combineStart = output.indexOf("fn combine(");
  const mapStart = output.indexOf("fn map_ordinal_total(");
  const scalarStart = output.indexOf("fn scalar_bound_total(");
  const mutatingStart = output.indexOf("fn mutating_array_bound(");
  const aliasedStart = output.indexOf("fn aliased_array_bound(");
  const externallyMutatedStart = output.indexOf("fn externally_mutated_array_bound(");
  const selfAppendStart = output.indexOf("fn self_append(");
  const unstableStart = output.indexOf("fn unstable_bound(");
  assert.ok(returnAfterStart >= 0 && assertionStart > returnAfterStart &&
    finallyStart > assertionStart &&
    catchStart > finallyStart && iterationReturnStart > catchStart &&
    switchReturnStart > iterationReturnStart && appendStart > switchReturnStart &&
    appendFailureStart > appendStart);
  assert.ok(combineStart > appendFailureStart && mapStart > combineStart);
  assert.ok(scalarStart > mapStart && mutatingStart > scalarStart &&
    aliasedStart > mutatingStart &&
    externallyMutatedStart > aliasedStart && selfAppendStart > externallyMutatedStart &&
    unstableStart > selfAppendStart);
  const returnAfterOutput = output.slice(returnAfterStart, assertionStart);
  const assertionOutput = output.slice(assertionStart, finallyStart);
  const finallyOutput = output.slice(finallyStart, catchStart);
  const catchOutput = output.slice(catchStart, iterationReturnStart);
  const iterationReturnOutput = output.slice(iterationReturnStart, switchReturnStart);
  const switchReturnOutput = output.slice(switchReturnStart, appendStart);
  const appendOutput = output.slice(appendStart, appendFailureStart);
  const appendFailureOutput = output.slice(appendFailureStart, combineStart);
  const combineOutput = output.slice(combineStart, mapStart);
  const mapOutput = output.slice(mapStart, scalarStart);
  const scalarOutput = output.slice(scalarStart, mutatingStart);
  const mutatingOutput = output.slice(mutatingStart, aliasedStart);
  const aliasedOutput = output.slice(aliasedStart, externallyMutatedStart);
  const externallyMutatedOutput = output.slice(externallyMutatedStart, selfAppendStart);
  const selfAppendOutput = output.slice(selfAppendStart, unstableStart);
  assert.match(returnAfterOutput, /inspect\(value\.clone\(\)\)/u);
  assert.equal(returnAfterOutput.match(/value\.clone\(\)/gu)?.length, 1);
  assert.match(assertionOutput, /inspect\(value\.clone\(\)\)/u);
  assert.equal(assertionOutput.match(/value\.clone\(\)/gu)?.length, 1);
  assert.match(finallyOutput, /value\.clone\(\)/u);
  assert.match(catchOutput, /value\.clone\(\)/u);
  assert.match(iterationReturnOutput, /values\.clone\(\)/u);
  assert.match(switchReturnOutput, /value\.clone\(\)/u);
  assert.match(output, /output\.push\('\/'\);/u);
  assert.match(output, /output\.push\('\\''\);/u);
  assert.match(output, /output\.push\('🙂'\);/u);
  assert.match(output, /output\.push\(' '\);/u);
  assert.match(output, /output\.push_str\(&/u);
  assert.doesNotMatch(output, /push_str\(&String::from/u);
  assert.doesNotMatch(appendOutput, /push_str\(&[^;]*\.clone\(\)/u);
  assert.doesNotMatch(appendOutput, /output\.push_str\(&format!/u);
  assert.match(appendFailureOutput, /output\.push_str\(&format!/u);
  assert.doesNotMatch(appendFailureOutput, /output\.push_str\("prefix"\)/u);
  assert.match(selfAppendOutput, /format!\("\{\}\{\}"/u);
  assert.doesNotMatch(appendOutput, /output\.clone\(\)\s*\}/u);
  assert.doesNotMatch(combineOutput, /Ok\(output\.clone\(\)\)/u);
  assert.doesNotMatch(selfAppendOutput, /value\.clone\(\)\s*\}/u);
  assert.match(
    combineOutput,
    /for index_range(?:_\d+)? in 0\.\.[^{]+\{\s*let index = index_range(?:_\d+)? as f64;/u,
  );
  assert.match(
    mapOutput,
    /for index_range(?:_\d+)? in 0\.\.[^{]+\{\s*let index = index_range(?:_\d+)? as f64;/u,
  );
  assert.match(
    scalarOutput,
    /for index_range(?:_\d+)? in 0\.\.[^{]+\{\s*let index = index_range(?:_\d+)? as f64;/u,
  );
  assert.doesNotMatch(combineOutput, /let mut index: f64 = 0\.0;\s*while index </u);
  assert.match(mutatingOutput, /let mut index: f64 = 0\.0;[\s\S]*?while index </u);
  assert.match(aliasedOutput, /let mut index: f64 = 0\.0;[\s\S]*?while index </u);
  assert.match(externallyMutatedOutput, /let mut index: f64 = 0\.0;[\s\S]*?while index </u);
  assert.match(output, /fn unstable_bound[\s\S]*?let mut index: f64 = 0\.0;[\s\S]*?while index < limit/u);
  assert.doesNotMatch(output, /Ok::<_, rt::TsonicError>\(output\)/u);
  validateGeneratedProject("sealed-human-performance", result.artifacts, { run: true });
});
