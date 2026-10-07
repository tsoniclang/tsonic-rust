import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  rustJsValueTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustTsValueTargetType,
} from "../../../dist/target-model/types/index.js";
import {
  rustValueConversionContract,
} from "../../../dist/target-model/conversions/contracts.js";
import {
  selectRustSourceValueConversion,
} from "../../../dist/policy/conversions/selection.js";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { validateValueConversion } from "../../../dist/providers/packages/validation/carriers.js";

test("native broad values select one closed passive carrier contract", () => {
  const source = rustStringTargetType();
  const target = rustTsValueTargetType();
  const conversion = selectRustSourceValueConversion(source, target);

  assert.deepEqual(conversion, {
    kind: "ts-value-from-closed-carrier",
    source,
  });
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "projection",
    lowering: "call",
    path: "rt::TsValue::from",
    sourceMode: "value",
    source,
    target,
    fallible: false,
  });
  assert.deepEqual(selectRustSourceValueConversion(target, target), {
    kind: "semantic-conversion",
    id: "ts-value-clone",
  });
});

test("passive broad values reject carriers whose lifetime cannot be closed", () => {
  assert.equal(
    selectRustSourceValueConversion(
      {
        kind: "reference",
        referent: rustStringTargetType(),
        mutable: false,
      },
      rustTsValueTargetType(),
    ),
    undefined,
  );
  assert.equal(
    selectRustSourceValueConversion(
      { kind: "type-parameter", identity: "T", name: "T" },
      rustTsValueTargetType(),
    ),
    undefined,
  );
});

test("native and JS optional admission retain exact payload and destination evidence", () => {
  const element = rustStringTargetType();
  const source = rustOptionTargetType(element);
  const fail = message => { throw new Error(message); };
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const conversion = selectRustSourceValueConversion(source, target);
    assert.equal(conversion.kind, "closed-value-from-option");
    const contract = rustValueConversionContract(conversion);
    assert.deepEqual(contract.source, source);
    assert.deepEqual(contract.target, target);
    assert.deepEqual(contract.elementConversion.source, element);
    assert.equal(contract.sourceMode, "value");
    assert.doesNotThrow(() => validateValueConversion(conversion, {}, "optional", source, target, fail));
    for (const changed of [
      { ...conversion, kind: "js-value-from-option" },
      { ...conversion, source: element },
      { ...conversion, element: rustSourcePrimitiveTargetType("uint64") },
      { ...conversion, elementConversion: { kind: "semantic-conversion", id: "js-value-from-u64" } },
      { ...conversion, elementConversion: { kind: "ts-value-from-closed-carrier", source: {
        kind: "reference", referent: element, mutable: false,
      } } },
    ]) {
      assert.equal(rustValueConversionContract(changed), undefined);
      assert.throws(() => validateValueConversion(changed, {}, "optional", source, target, fail));
    }
  }
});

test("the JS broad-value carrier remains independent of the native carrier", () => {
  const conversion = selectRustSourceValueConversion(
    rustStringTargetType(),
    rustJsValueTargetType(),
  );
  assert.deepEqual(conversion, {
    kind: "semantic-conversion",
    id: "js-value-from-string",
  });
  assert.equal(rustValueConversionContract(conversion)?.target.kind, "target-named");
  assert.equal(rustValueConversionContract(conversion)?.target.id, "rust.js.JsValue");
});

test("native any and unknown retain closed values without activating rust-js", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "native_broad_values" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Box {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }
}

function retainUnknown(value: unknown): unknown {
  return value;
}

function retainAny(value: any): any {
  return value;
}

function consumeUnknown(_value: unknown): void {}
function consumeAny(_value: any): void {}

export function main(): void {
  const box = new Box(7 as int32);
  const retained = retainUnknown(box);
  consumeUnknown(retained);
  consumeAny(retained);
  consumeUnknown([1 as int32, 2 as int32]);
  consumeAny(retainAny("ready"));
  check(box.value === 7);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::TsValue/u);
  assert.match(source, /TsValue::from_closed/u);
  assert.match(source, /retained\.clone\(\)/u);
  assert.match(source, /TsValue::from_shared_identity/u);
  assert.doesNotMatch(source, /js_abi::JsValue|tsonic_rust_js/u);
  assert.equal(
    validateGeneratedProject("native-broad-values", result.artifacts, { run: true }).status,
    0,
  );
});

test("JS-surface any and unknown continue to use exact JsValue semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    surfaces: ["js"],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "js_broad_values" },
    },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

function retainUnknown(value: unknown): unknown {
  return value;
}

function retainAny(value: any): any {
  return value;
}

export function main(): void {
  const parsed = retainUnknown(JSON.parse("{\\"ready\\":true}"));
  const retained = retainAny(parsed);
  check(Number.isNaN(Number.NaN));
  check(JSON.stringify(retained) === "{\\"ready\\":true}");
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /js_abi::JsValue/u);
  assert.doesNotMatch(source, /rt::TsValue/u);
  assert.equal(
    validateGeneratedProject("js-broad-values", result.artifacts, { run: true }).status,
    0,
  );
});

test("native empty values retain exact identity transport without activating Rust-JS", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "passive_empty_values" } },
    files: { "index.ts": `
function retain(value: unknown): unknown { return value; }
function consume(_value: unknown): void {}
export function main(): void {
  const token = {};
  consume(retain(token));
  consume(retain({}));
}
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /js_abi|tsonic_rust_js/u);
  assert.match(source, /TsValue::from\(/u);
  assert.equal(validateGeneratedProject("passive-empty-values", result.artifacts, { run: true }).status, 0);
});

test("boxing an empty identity does not replace its declared storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "boxed_empty_identity" } },
    files: { "index.ts": `
function retain(value: unknown): unknown { return value; }
export function main(): void {
  const token = {};
  const alias = token;
  const boxed = retain(token);
  Object.freeze(token);
  if (!Object.isFrozen(alias) || token !== alias || boxed !== retain(alias) || boxed === retain({})) {
    throw new Error("empty identity was replaced");
  }
  if (JSON.stringify(boxed) !== "{}") {
    throw new Error("empty value projection differs");
  }
}
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(validateGeneratedProject("boxed-empty-identity", result.artifacts, { run: true }).status, 0);
});
