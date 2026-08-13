import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustProviderPackage } from "../dist/index.js";
import {
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";
import { selectRustOptionalChain } from "../dist/source/rust-target-semantics/optional-chains.js";
import {
  rustOptionTargetType,
  rustStringTargetType,
} from "../dist/source/rust-target-types.js";

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

const unsupportedProviderValuePackage = createRustProviderPackage({
  id: "acme-unsupported-environment",
  displayName: "Acme unsupported environment",
  version: "1.0.0",
  modules: [{
    moduleSpecifier: "@acme/unsupported-environment",
    providerModuleId: "acme.unsupported-environment",
    exports: [{
      id: "@acme/unsupported-environment::platform",
      name: "platform",
      kind: "value",
      type: { kind: "string" },
    }],
  }],
  operations: [],
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
  assert.match(text, /\n    tsonic_rust_runtime::conversions::f64_to_i32\(value\)\n/u);
  assert.doesNotMatch(text, /Ok\([^\n]*\?\)/u);
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

test("unsupported checked assertions fail closed at Rust target analysis", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
interface Animal { name: string }
interface Dog extends Animal { breed: string }
declare const animal: Animal;
export const dog = animal as Dog;
`,
    },
  });

  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [{
    code: "RUST_ASSERTION_UNSUPPORTED",
    message: "Checked source assertion does not map to an identity or explicit Rust runtime conversion.",
  }]);
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
  assert.match(artifactText(result, "src/index.rs"), /\{\n        let _ = one;\n        pair\[1\]\n    \}/u);
  validateGeneratedProject("selected-tuple-ordinal", result.artifacts);
});

test("ambiguous tuple indexes do not fall back to source spelling", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function pick(pair: [int32, int32], flag: boolean): int32 {
  const index: 0 | 1 = flag ? 0 : 1;
  return pair[index];
}
`,
    },
  });

  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [{
    code: "RUST_FIXED_ARRAY_DYNAMIC_INDEX_CARRIER_UNSUPPORTED",
    message: "Dynamic fixed-array element access requires an exact int32 index carrier; literal unions and other source carriers are not reconstructed from their spelling.",
  }]);
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
  assert.match(artifactText(result, "src/index.rs"), /for value in rt::iter_copied\(values\)/u);
  validateGeneratedProject("selected-for-of", result.artifacts);
});

test("optional-chain access consumes exact selected receiver evidence", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function length(value: string | null): int32 | undefined {
  return value?.length;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /value\s*\.as_ref\(\)\s*\.map\(\s*\|__tsonic_optional_receiver/u,
  );
  validateGeneratedProject("selected-optional-property", result.artifacts);
});

test("project property access consumes the checker-selected narrowed receiver", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32 = 1;
}

export function read(value: Counter | undefined): int32 {
  if (value === undefined) return 0;
  return value.value + value.value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(
    source,
    /value\s*\.as_ref\(\)\s*\.unwrap\(\)\s*\.clone\(\)\s*\.__tsonic_state/su,
  );
  assert.equal(
    source.match(/value\s*\.as_ref\(\)\s*\.unwrap\(\)\s*\.clone\(\)/gsu)?.length,
    2,
  );
  validateGeneratedProject("selected-narrowed-project-property", result.artifacts);
});

test("optional-chain selection fails closed without every exact carrier", () => {
  const expression = {};
  const guard = {};
  const stringCarrier = rustStringTargetType();
  const optionStringCarrier = rustOptionTargetType(stringCarrier);

  assert.deepEqual(selectRustOptionalChain({
    expression,
    guard,
    operationKind: "property",
    sourceGuardCarrier: optionStringCarrier,
    selectedGuardCarrier: undefined,
    innerResultCarrier: stringCarrier,
  }), {
    kind: "rejected",
    message: "Optional chaining requires exact source, selected-receiver, and inner-result carriers.",
  });

  assert.deepEqual(selectRustOptionalChain({
    expression,
    guard,
    operationKind: "property",
    sourceGuardCarrier: optionStringCarrier,
    selectedGuardCarrier: { kind: "source-primitive", name: "int32" },
    innerResultCarrier: stringCarrier,
  }), {
    kind: "rejected",
    message: "Optional-chain guard must be exactly Option of the TSTS-selected non-null receiver carrier.",
  });
});

test("provider value identifiers lower only from exact provider declaration evidence", () => {
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

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /pub fn currentPlatform\(\) -> String \{\n    acme_environment::platform\(\)\n\}/u,
  );
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

test("a selected provider value without a target relation fails closed", () => {
  const { result } = compileRust({
    packages: [unsupportedProviderValuePackage],
    files: {
      "index.ts": `
import { platform } from "@acme/unsupported-environment";

export function currentPlatform(): string {
  return platform;
}
`,
    },
  });

  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [{
    code: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
    message: "No Rust operation row matches selected provider declaration 'tsonic.rust.provider-package.acme-unsupported-environment.binding::acme.unsupported-environment::@acme/unsupported-environment::platform' as property.",
  }]);
});
