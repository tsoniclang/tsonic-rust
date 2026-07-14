import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustProviderPackage } from "../dist/index.js";
import {
  artifactText,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

const providerValuePackage = createRustProviderPackage({
  id: "acme-environment",
  displayName: "Acme environment",
  version: "1.0.0",
  modules: [{
    moduleSpecifier: "@acme/environment",
    providerModuleId: "acme.environment",
    exports: [{
      id: "@acme/environment::platform",
      name: "platform",
      kind: "value",
      type: { kind: "string" },
    }],
  }],
  operations: [{
    exportId: "@acme/environment::platform",
    operationKind: "property",
    target: { form: "call", path: "acme_environment::platform" },
    resultCarrier: { kind: "target-named", id: "rust.std.String" },
  }],
  crates: [],
});

test("assertion conversions use explicit TSTS evidence and checked runtime helpers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { float64, int32 } from "@tsonic/core/types.js";

export function truncate(value: float64): int32 {
  return value as int32;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn truncate\(value: f64\) -> rt::TsonicResult<i32>/u);
  assert.match(text, /tsonic_rust_runtime::conversions::f64_to_i32\(value\)\?/u);
  assert.doesNotMatch(text, /\sas\si32/u);
  validateGeneratedProject("selected-assertion-conversion", result.artifacts);
});

test("identity assertions erase only with a finalized conversion fact", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function identity(value: int32): int32 {
  return value as int32;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn identity\(value: i32\) -> i32 \{\n    value\n\}/u);
  assert.doesNotMatch(text, / as /u);
});

test("unsupported checked assertions fail closed during source checking", () => {
  const harness = createRustSession({
    files: {
      "index.ts": `
interface Animal { name: string }
interface Dog extends Animal { breed: string }
declare const animal: Animal;
export const dog = animal as Dog;
`,
    },
  });

  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);
  assert.match(diagnostics, /identity or explicit Rust runtime conversion/u);
});

test("named constant tuple indexes consume the TSTS-selected ordinal", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function second(pair: [int32, int32]): int32 {
  const one = 1 as const;
  return pair[one];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /\{ let _ = one; pair\[1\] \}/u);
  validateGeneratedProject("selected-tuple-ordinal", result.artifacts);
});

test("ambiguous tuple indexes do not fall back to source spelling", () => {
  const harness = createRustSession({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pick(pair: [int32, int32], index: 0 | 1): int32 {
  return pair[index];
}
`,
    },
  });

  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);
  assert.match(diagnostics, /Fixed-array element access requires a TSTS-selected in-range fixed ordinal/u);
});

test("for-of lowers only from selected iteration element evidence", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function total(values: readonly int32[]): int32 {
  let result: int32 = 0;
  for (const value of values) {
    result += value;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /for value in values\.iter\(\)\.copied\(\)/u);
  validateGeneratedProject("selected-for-of", result.artifacts);
});

test("optional-chain access fails closed until a Rust Option operation is selected", () => {
  const harness = createRustSession({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function length(value: string | null): number | undefined {
  return value?.length;
}
`,
    },
  });

  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);
  assert.match(diagnostics, /Optional-chain property access has no finalized Rust Option operation/u);
});

test("provider value identifiers fail closed without TSTS-selected value evidence", () => {
  const { result } = compileRust({
    packages: [providerValuePackage],
    files: {
      "index.ts": `
import { platform } from "@acme/environment";

export function currentPlatform(): string {
  return platform;
}
`,
    },
  });

  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [{
    code: "RUST_MISSING_TARGET_FACT",
    message: "Identifier expression has no finalized project-source binding or selected target value operation. Node kind: KindIdentifier.",
  }]);
});

test("a project binding that shadows a provider value remains a proven local", () => {
  const { result } = compileRust({
    packages: [providerValuePackage],
    files: {
      "index.ts": `
import { platform } from "@acme/environment";

export function currentPlatform(platform: string): string {
  return platform;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /pub fn currentPlatform\(platform: String\) -> String \{\n    platform\n\}/u);
});
