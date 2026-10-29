import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import {
  rustCallableTargetType, rustEmptyObjectTargetType, rustJsArrayTargetType,
  rustJsValueTargetType, rustSourcePrimitiveTargetType, rustTsValueTargetType,
} from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const number = rustSourcePrimitiveTargetType("float64");
const carriers = [
  ["empty object", rustEmptyObjectTargetType()],
  ["broad JS object", rustJsValueTargetType()],
  ["broad native object", rustTsValueTargetType()],
  ["array", rustJsArrayTargetType(number)],
  ["callback", rustCallableTargetType([number], number)],
  ["generic", { kind: "type-parameter", identity: "fixture.T", name: "T" }],
];

for (const [name, carrier] of carriers) {
  test(`selected freeze preserves the exact ${name} carrier without origin or clone evidence`, () => {
    const selected = selectJsSurfaceOperation({
      ownerName: "ObjectConstructor", memberName: "freeze", operationKind: "call",
      argumentCarriers: [carrier],
      carrierSupportsProjectIdentity: () => assert.fail("identity selection needs no runtime-origin proof"),
      canRequireClone: () => assert.fail("identity selection requires no Clone bound"),
    });
    assert.equal(selected?.fact.kind, "provider-operation", "one admitted identity operation");
    assert.equal(selected.fact.target.form, "call", "the existing native invocation form");
    assert.equal(selected.fact.target.path, "core::convert::identity", "the native identity operation");
    assert.equal(selected.fact.target.argModes.length, 1, "one operand");
    assert.equal(selected.fact.target.argModes[0], "value", "no freeze-induced borrow or copy");
    assert.equal(rustTargetTypeRefEquals(selected.resultCarrier, carrier), true, "same result carrier");
    assert.equal(rustTargetTypeRefEquals(selected.parameterCarriers[0], carrier), true, "same input carrier");
    assert.equal(selected.fact.carrierRequirements === undefined, true, "no additional traits");
    assert.equal(selected.fact.isFallible, false, "no runtime frozen-write failure");
  });
}

test("selected isFrozen is refused precisely before target publication", () => {
  const { result } = compileRust({ surfaces: ["js"], files: {
    "index.ts": "export function run(value: object): boolean { return Object.isFrozen(value); }",
  } });
  assert.equal(result.diagnostics.length, 1, "one diagnostic at the selected source call");
  assert.equal(result.diagnostics[0].code, "TSONIC_IS_FROZEN_UNSUPPORTED", "the shared source refusal");
  assert.equal(result.diagnostics[0].message.includes(
    "Object.isFrozen has no native equivalent; immutability is a compile-time property. Use readonly declarations instead."
  ), true, "the precise supported rewrite");
  assert.equal(result.artifacts.length, 0, "no target publication");
});

test("shadowed freeze and isFrozen remain ordinary functions", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
const Object = {
  freeze(value: number): number { return value + 2; },
  isFrozen(value: number): boolean { return value === 4; },
};
export function run(): boolean { return Object.freeze(4) === 6 && Object.isFrozen(4); }
` } });
  assert.equal(result.diagnostics.length, 0, "shadowed declarations remain supported");
  const output = artifactText(result, "src/index.rs");
  assert.equal(typeof output === "string" && output.length > 0, true, "generated source exists");
  assert.equal(output.includes("core::convert::identity"), false, "shadowed freeze is not erased");
  assert.equal(output.includes("isFrozen"), true, "shadowed query is emitted");
});

test("freeze retains TypeScript's readonly write rejection", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": `
export function run(): void {
  const value = Object.freeze({ count: 1 });
  value.count = 2;
}
` } }), /TypeScript diagnostics:[\s\S]*TS2540/u, "the original readonly constraint");
});

test("freeze keeps evaluation, alias identity and ordinary mutable writes", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
class Value { count = 1; }
let evaluations = 0;
function produce(value: Value): Value { evaluations += 1; return value; }
export function run(): boolean {
  const value = new Value();
  const alias = Object.freeze(produce(value));
  value.count = 2;
  const values: number[] = [1, 2];
  const readonlyValues = Object.freeze(values);
  values[0] = 3;
  const callback = (value: number): number => value + 1;
  const readonlyCallback = Object.freeze(callback);
  return evaluations === 1 && alias === value && alias.count === 2 &&
    readonlyValues === values && readonlyValues[0] === 3 && readonlyCallback === callback;
}
` } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 4).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.equal(typeof output === "string" && output.length > 0, true, "actual generated native source");
  assert.equal(/freeze_object|object_is_frozen|freeze_object_state|object_state_is_frozen|validate_data_write/u.test(output),
    false, "no runtime frozen state or guards");
  const project = writeGeneratedProject("compile-time-freeze-identity", result.artifacts);
  const initialization = artifactText(result, "src/lib.rs").includes("pub fn initialize()")
    ? "crate::initialize();" : "";
  appendFileSync(`${project}/src/index.rs`,
    `\n#[test]\nfn readonly_native_identity() { ${initialization} assert!(run()); }\n`);
  runCargo(project, ["test", "--offline", "--", "--test-threads=1"]);
});
