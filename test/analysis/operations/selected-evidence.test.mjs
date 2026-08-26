import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectRustOptionalChain } from "../../../dist/policy/operations/optional-chains.js";
import {
  rustOptionTargetType,
  rustStringTargetType,
} from "../../../dist/target-model/types/index.js";

const providerValuePackage = createRustProviderPackage({
  id: "acme-environment",
  displayName: "Acme environment",
  version: "1.0.0",
  compilationSnapshotId: "acme-environment@1.0.0",
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
    resultCarrier: rustStringTargetType(),
  }],
  crates: [],
});

const unsupportedProviderValuePackage = createRustProviderPackage({
  id: "acme-unsupported-environment",
  displayName: "Acme unsupported environment",
  version: "1.0.0",
  compilationSnapshotId: "acme-unsupported-environment@1.0.0",
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
  assert.match(text, /pub fn truncate\(value: f64\) -> Result<i32, rt::TsonicError>/u);
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

test("assertion results finalize before their containing call selects argument carriers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function accept(value: int32): int32 {
  return value;
}

export function use(): int32 {
  return accept(250 as int32);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.equal(text.match(/f64_to_i32/gu)?.length, 1);
  validateGeneratedProject("selected-assertion-call-argument", result.artifacts);
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
    message: "Dynamic fixed-array element access requires an exact int32 or native-uint index carrier; literal unions and other source carriers are not reconstructed from their spelling.",
  }]);
});

test("flow-narrowed indexes consume the exact selected argument type", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function parseIndex(text: string): int32 | undefined {
  if (text.length === 0) return undefined;
  return 0;
}

export function read(values: readonly int32[], text: string): int32 {
  const index = parseIndex(text);
  if (index !== undefined) {
    return values[index];
  }
  return 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/index.rs"),
    /i32_to_f64\(\s*match index\.as_ref\(\) \{[\s\S]*Some\(flow_value\) => \*flow_value/u,
  );
  validateGeneratedProject("selected-flow-narrowed-index", result.artifacts);
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
  assert.match(artifactText(result, "src/index.rs"), /for value in rt::iter_copied\(&values\)/u);
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
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /value\s*\.as_ref\(\)\s*\.map\(\s*\|optional_receiver/u);
  assert.doesNotMatch(source, /value\s*\.clone\(\)/u);
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
    /let dispatch_receiver(?:_\d+)? = &match value\.as_ref\(\) \{[\s\S]*Some\(flow_value(?:_\d+)?\) => flow_value(?:_\d+)?\.clone\(\),[\s\S]*None => unreachable!\("checked flow selected a missing optional value"\),[\s\S]*\};[\s\S]*dispatch_receiver(?:_\d+)?\.dispatch\.read_counter_value\(\)/su,
  );
  assert.equal(
    source.match(/match value\.as_ref\(\)/gsu)?.length,
    2,
  );
  assert.doesNotMatch(source, /value\.clone\(\)\.as_ref\(\)/u);
  validateGeneratedProject("selected-narrowed-project-property", result.artifacts);
});

test("project instanceof and assertions use closed generated downcast routes", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "selected_project_downcast" },
    },
    files: {
      "model.ts": `
export class JsonValue { constructor() {} }

export class JsonTagged extends JsonValue { constructor() { super(); } }

export class JsonString extends JsonTagged {
  value: string;
  constructor(value: string) { super(); this.value = value; }
}

export class JsonArray extends JsonValue {}

export class JsonObject extends JsonValue {
  value: JsonValue | undefined;
  constructor(value: JsonValue | undefined) { super(); this.value = value; }
  getValue(): JsonValue | undefined { return this.value; }
}
`,
      "identity.ts": `
import { JsonString, JsonValue } from "./model.js";

export function isString(value: JsonValue): boolean {
  return value instanceof JsonString;
}
`,
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";
import { JsonArray, JsonObject, JsonString as SelectedString, JsonTagged, JsonValue } from "./model.js";

function read(value: JsonValue): string {
  if (value instanceof SelectedString) return value.value;
  if (value instanceof JsonArray) return "array";
  return "other";
}

function asserted(value: JsonValue): string {
  return (value as SelectedString).value;
}

function readTagged(value: JsonTagged): string {
  return value instanceof SelectedString ? value.value : "other";
}

function present(value: SelectedString | undefined): boolean {
  return value instanceof SelectedString;
}

function isValue(value: SelectedString): boolean {
  return value instanceof JsonValue;
}

function readNested(value: JsonValue): string {
  if (value instanceof JsonObject) {
    const selected = value.getValue();
    if (selected instanceof SelectedString) return selected.value;
  }
  return "other";
}

let evaluations: int32 = 0;

function selected(value: JsonValue): JsonValue {
  evaluations += 1;
  return value;
}

export function main(): void {
  const text: JsonValue = new SelectedString("selected");
  const array: JsonValue = new JsonArray();
  check(read(text) === "selected");
  check(read(array) === "array");
  check(asserted(text) === "selected");
  check(readTagged(new SelectedString("tagged")) === "tagged");
  check(present(text as SelectedString));
  check(!present(undefined));
  check(isValue(text as SelectedString));
  check(readNested(new JsonObject(text)) === "selected");
  check(selected(text) instanceof SelectedString);
  check(evaluations === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const model = artifactText(result, "src/model.rs");
  const identity = artifactText(result, "src/identity.rs");
  const index = artifactText(result, "src/index.rs");
  assert.match(model, /fn downcast_json_value_to_json_string\(\s*self: std::rc::Rc<Self>,?\s*\)/u);
  assert.match(identity, /downcast_json_value_to_json_string\(\)\s*\.is_some\(\)/u);
  assert.match(index, /downcast_json_value_to_json_string\(\)\s*\.is_some\(\)/u);
  assert.match(index, /downcast_json_value_to_json_string\(\)\s*\.unwrap\(\)/u);
  assert.doesNotMatch(`${model}\n${identity}\n${index}`, /into_any|std::any::Any|TypeId/u);
  const run = validateGeneratedProject("selected-project-downcast", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("narrowed project values remain reusable across repeated selected reads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "repeated_project_downcast" },
    },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class Value {}

class TextValue extends Value {
  text: string;
  constructor(text: string) { super(); this.text = text; }
}

function readTwice(value: Value): string {
  if (value instanceof TextValue) {
    return value.text + value.text;
  }
  return "";
}

export function main(): void {
  check(readTwice(new TextValue("a")) === "aa");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let downcast_value = &value;/u);
  assert.equal(validateGeneratedProject("repeated-project-downcast", result.artifacts, { run: true }).status, 0);
});

test("exact null values remain closed inside project polymorphic state", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "project_null_state" },
    },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class Value {}

class NullValue extends Value {
  value: null;

  constructor() {
    super();
    this.value = null;
  }
}

function isNull(value: Value): boolean {
  return value instanceof NullValue && value.value === null;
}

function isExactlyUndefined(value: string | undefined): boolean {
  return value === undefined && value !== null;
}

function isExactlyNull(value: string | null): boolean {
  return value === null && value !== undefined;
}

function isAlwaysPresent(value: string): boolean {
  return value !== undefined;
}

export function main(): void {
  check(isNull(new NullValue()));
  check(isExactlyUndefined(undefined));
  check(isExactlyNull(null));
  check(isAlwaysPresent("present"));
  check(\`value=\${null}\` === "value=null");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /value: rt::Null/u);
  assert.match(source, /rt::Null/u);
  assert.equal(validateGeneratedProject("project-null-state", result.artifacts, { run: true }).status, 0);
});

test("recursive project calls consume their finalized selected signature", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "project_recursion" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function sumTo(value: int32): int32 {
  if (value <= 0) return 0;
  return value + sumTo(value - 1);
}

const sumToArrow = (value: int32): int32 => {
  if (value <= 0) return 0;
  return value + sumToArrow(value - 1);
};

function localSumTo(value: int32): int32 {
  const visit = (current: int32): int32 =>
    current <= 0 ? 0 : current + visit(current - 1);
  return visit(value);
}

export function main(): void {
  check(sumTo(4) === 10);
  check(sumToArrow(4) === 10);
  check(localSumTo(4) === 10);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /sum_to\(value - 1\)/u);
  assert.match(source, /fn sum_to_arrow\(value: i32\) -> i32/u);
  assert.match(source, /sum_to_arrow\(value - 1\)/u);
  assert.doesNotMatch(source, /SUM_TO_ARROW|ModuleCell<.*sum_to_arrow/u);
  assert.equal(validateGeneratedProject("project-recursion", result.artifacts, { run: true }).status, 0);
});

test("generic project downcasts fail closed without a closed target carrier", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class Value {}
class Box<T> extends Value { value!: T; }

export function isBox(value: Value): boolean {
  return value instanceof Box;
}
`,
    },
  });

  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [{
    code: "RUST_PROJECT_TYPE_TEST_EVIDENCE_MISSING",
    message: "Checked instanceof requires exact project source, concrete class declaration, and closed target carrier evidence.",
  }]);
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
    /pub fn current_platform\(\) -> String \{\n    acme_environment::platform\(\)\n\}/u,
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
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn current_platform\(platform: String\) -> String \{\n    platform\n\}/u);
  assert.doesNotMatch(source, /platform\.clone\(\)/u);
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
