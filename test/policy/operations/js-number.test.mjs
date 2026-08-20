import assert from "node:assert/strict";
import { test } from "node:test";

import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import {
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../dist/policy/types/target-types.js";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const float64 = rustSourcePrimitiveTargetType("float64");
const int32 = rustSourcePrimitiveTargetType("int32");

test("Number rows select only exact source and carrier contracts", () => {
  assert.equal(selectJsSurfaceOperation({
    ownerName: "NumberConstructor",
    memberName: "parseInt",
    operationKind: "call",
    argumentCarriers: [rustStringTargetType(), int32],
  })?.fact.operationId, "tsonic.rust.js.NumberConstructor.parseInt.call.int32-radix");

  assert.equal(selectJsSurfaceOperation({
    ownerName: "Number",
    memberName: "toFixed",
    operationKind: "call",
    receiverCarrier: float64,
    argumentCarriers: [int32],
  })?.fact.operationId, "tsonic.rust.js.Number.toFixed.call.int32-digits");

  assert.equal(selectJsSurfaceOperation({
    ownerName: "Number",
    memberName: "toString",
    operationKind: "call",
    receiverCarrier: float64,
    argumentCarriers: [int32],
  }), undefined);
});

test("generated Rust proves exact Number parsing formatting and constants", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "js_number" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

export function main(): void {
  const value: number = 12.345;
  const integer: int32 = 255;
  check(Number.parseInt("ff", 16) === 255);
  check(Number.parseFloat("  -1.5e+2tail") === -150);
  check(parseInt("10", 2) === 2 && parseFloat("1.25tail") === 1.25);
  check(isFinite(value) && isNaN(Number.NaN));
  check(value.toFixed(2) === "12.35");
  check(value.toExponential(2) === "1.23e+1");
  check(value.toPrecision(2) === "12");
  check(value.toString() === "12.345");
  check(integer.toString(16) === "ff");
  check(integer.valueOf() === 255);
  check(Number.MAX_VALUE > Number.MAX_SAFE_INTEGER);
  check(Number.MIN_VALUE > 0 && Number.MIN_VALUE < Number.EPSILON);
  check(Number.isNaN(Number.NaN));
  check(Number.NEGATIVE_INFINITY < 0 && Number.POSITIVE_INFINITY > 0);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /js_abi::number_parse_int_radix\("ff", 16\.0\)/u);
  assert.match(source, /js_abi::number_to_fixed_digits\(value, 2\.0\)\?/u);
  assert.match(source, /js_abi::number_to_string_radix\(integer, 16\.0\)\?/u);
  assert.match(source, /js_abi::NUMBER_MAX_VALUE/u);
  assert.equal(validateGeneratedProject("js-number", result.artifacts, { run: true }).status, 0);
});
