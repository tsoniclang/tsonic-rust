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
  assert.match(api, /pub\(crate\) fn increment/u);
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
  assert.match(output, /pub\(crate\) fn selected/u);
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
  assert.match(output, /page\.state\.with\(\|state\| state\.title\.clone\(\)\)/u);
  assert.doesNotMatch(output, /page\.clone\(\)\.state\.with/u);
  assert.match(output, /let dispatch_receiver = &value;/u);
  assert.match(output, /dispatch_receiver\.dispatch\.read_base_value\(\)/u);
  assert.doesNotMatch(output, /dispatch\.clone\(\)\.read_base_value\(\)/u);
  assert.match(output, /fn read_base_value\(\s*&self/u);
  assert.match(output, /fn write_base_value\(\s*&self/u);
  assert.match(output, /let receiver = &value;/u);
  assert.match(output, /\.dispatch\.write_base_value\(value_\d+\)/u);
  assert.doesNotMatch(output, /dispatch\.clone\(\)\.write_base_value\(/u);
  assert.match(output, /let dispatch_receiver = &project_this;/u);
  assert.match(output, /page\.read_title\(\)/u);
  assert.match(output, /page\.rename\(String::from\("renamed"\)\)/u);
  assert.doesNotMatch(output, /page\.clone\(\)\.(?:read_title|rename)\(/u);
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
