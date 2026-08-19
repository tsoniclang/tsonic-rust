import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, assertRustTargetRejection, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("top-level mutable declarations use initialized module cells", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "module_binding_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export let value: int32 = 1;

export function main(): void {
  value += 2;
  if (value !== 3) {
    throw new Error("module binding mismatch");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub static VALUE: rt::ModuleCell<i32>/u);
  assert.match(text, /pub fn module_init/u);
  assert.match(
    text,
    /let (module_value) = 1;[\s\S]*?\.initialize\(\1\)/u,
  );
  assert.match(
    text,
    /let (location(?:_\d+)?) =[\s\S]*?let (current(?:_\d+)?) = \1\.load\(\);[\s\S]*?let (value_2) = 2;[\s\S]*?\1\.store\(\2 \+ \3\)/u,
  );
  assert.doesNotMatch(text, /\.update_with/u);
  validateGeneratedProject("module-binding-proof", result.artifacts, { run: true });
});

test("mixed-kind numeric operators use exact target-owned promotion conversions", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32, float64 } from "@tsonic/core/types.js";

export function mix(a: int32, b: float64): float64 {
  return a + b;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /a as f64 \+ b/u);
});

test("dynamic any member access fails closed without selected evidence", () => {
  const options = {
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

test("dynamic any calls fail closed without selected callable evidence", () => {
  const options = {
    files: {
      "index.ts": `
declare const invoke: any;

export function run(): void {
  invoke();
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_SELECTED_PROJECT_DECLARATION_MISSING",
    message: "Checked project-source call has callee evidence but no exact selected callable declaration evidence.",
  }]);
});

test("for-of over an unproven dynamic carrier fails closed", () => {
  const options = {
    files: {
      "index.ts": `
export function walk(): void {
  const values: any = 1;
  for (const value of values) {
    value;
  }
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_ITERATION_CARRIER_UNSUPPORTED",
    message: "Selected for-of iteration receiver is not a finalized supported Rust iterable carrier.",
  }]);
});

test("source-name guessing is impossible: a project Math class stays project-owned", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
class Math {
  constructor() {}

  static max(a: number, _b: number): number {
    return a;
  }
}

export function fallback(a: number, b: number): number {
  return Math.max(a, b);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /Math::max\(a, b\)/u);
  assert.doesNotMatch(text, /js_abi::math_max/u);
});

test("functions and methods consume exact checker-inferred return carriers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function noAnnotation(a: number) {
  return a;
}

export class Box {
  constructor() {}

  value() {
    return 42;
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn no_annotation\(a: f64\) -> f64/u);
  assert.match(text, /pub fn value\(&self\) -> f64/u);
});

test("throw Error requires the exact selected one-message constructor shape", () => {
  const options = {
    files: {
      "index.ts": `
export function invalid(): void {
  throw new Error();
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_ERROR_MESSAGE_REQUIRED",
    message: "Rust Error construction currently requires one checked string message argument.",
  }]);
});
