import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustProgramErrorConversionMatches, selectRustProgramErrorConversion } from "../../dist/target-model/conversions/program-error.js";
import { rustValueConversionContract } from "../../dist/target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../dist/policy/conversions/selection.js";
import { isRustClosedValueCarrier } from "../../dist/target-model/types/carriers/closed-value-kind.js";
import { rustClosedValueRetainsError } from "../../dist/target-model/types/carriers/closed-values.js";
import { rustJsErrorTargetType, rustJsValueTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType,
  rustSourceTypeCarrier, rustTsValueTargetType, rustEmptyObjectTargetType } from "../../dist/target-model/types/index.js";
import { rustMutableJsErrorTargetType, rustRetainedErrorTargetType, rustSourceErrorTargetType,
  rustWritableRetainedErrorTargetType, rustWritableSourceErrorTargetType } from "../../dist/target-model/types/carriers/source-error.js";

const project = rustSourceTypeCarrier("/src/failure.ts", "Failure", "object");
const unrelated = rustSourceTypeCarrier("/src/record.ts", "RecordValue", "object");
const registry = createRustTypeDefinitionRegistry();
assert.equal(registry.registerProgramErrorOrigin(project, { kind: "project", variant: "Failure", sourceError: true }), true);
assert.equal(registry.registerProgramErrorOrigin(unrelated, { kind: "project", variant: "RecordValue", sourceError: false }), true);
const definitions = registry.seal();
const closedCarriers = [rustJsValueTargetType(), rustTsValueTargetType()];

test("closed type definitions preserve one immutable profile selection and reject foreign storage", () => {
  for (const carrier of closedCarriers) {
    const selected = { ...carrier };
    const registry = createRustTypeDefinitionRegistry(selected);
    selected.id = "foreign.closed";
    const definitions = registry.seal();
    assert.equal(isRustClosedValueCarrier(definitions.closedValueCarrier), true);
    assert.equal(Object.isFrozen(definitions.closedValueCarrier), true);
    const source = rustSourcePrimitiveTargetType("uint64");
    const conversion = selectRustProgramErrorConversion(source, undefined, definitions);
    assert.equal(conversion.route.kind, "closed-admission");
    assert.equal(rustProgramErrorConversionMatches(conversion, source, conversion.target, definitions), true);
  }
  for (const carrier of [null, { kind: "target-named", id: "foreign.closed" }, rustJsErrorTargetType()]) {
    assert.throws(() => createRustTypeDefinitionRegistry(carrier), /exact closed value carrier/u);
  }
});

test("finite native closed admission preserves direct routes and rejects malformed or escaping carriers", () => {
  for (const source of [rustEmptyObjectTargetType(), rustSourcePrimitiveTargetType("uint64")]) {
    const conversion = selectRustProgramErrorConversion(source);
    assert.deepEqual(conversion.route, { kind: "closed-admission" });
    assert.equal(rustProgramErrorConversionMatches(conversion, source, conversion.target), true);
    for (const route of [{ kind: "closed-admission", extra: true }, { kind: "closed" }, { kind: "runtime", boundary: "target-runtime" }]) {
      assert.equal(rustProgramErrorConversionMatches({ ...conversion, route }, source, conversion.target), false);
    }
    for (const target of [rustRetainedErrorTargetType(), rustSourceErrorTargetType(), rustWritableSourceErrorTargetType()]) {
      assert.equal(selectRustProgramErrorConversion(source, target), undefined);
      assert.equal(rustProgramErrorConversionMatches({ ...conversion, target }, source, target), false);
    }
  }
  assert.equal(selectRustProgramErrorConversion(rustProgramErrorTargetType()), undefined);
  for (const source of [{ kind: "type-parameter", identity: "foreign:T", name: "T" },
    { kind: "reference", referent: rustSourcePrimitiveTargetType("uint64"), mutable: false }]) {
    assert.equal(selectRustProgramErrorConversion(source), undefined);
  }
  assert.equal(selectRustProgramErrorConversion(project, undefined, definitions).route.kind, "project");
  assert.equal(selectRustProgramErrorConversion(rustJsErrorTargetType()).route.kind, "runtime");
});

test("only exact canonical closed carriers admit a general thrown payload", () => {
  for (const source of closedCarriers) {
    assert.equal(isRustClosedValueCarrier(source), true);
    const conversion = selectRustProgramErrorConversion(source);
    assert.ok(conversion);
    assert.deepEqual(conversion.route, { kind: "closed" });
    assert.equal(Object.isFrozen(conversion) && Object.isFrozen(conversion.route), true);
    assert.equal(rustProgramErrorConversionMatches(conversion, source, conversion.target), true);
    for (const destination of [rustJsErrorTargetType(), rustSourceErrorTargetType(), rustWritableSourceErrorTargetType(),
      rustRetainedErrorTargetType(), rustWritableRetainedErrorTargetType()]) {
      assert.equal(selectRustProgramErrorConversion(source, destination), undefined);
      assert.equal(rustProgramErrorConversionMatches({ ...conversion, target: destination }, source, destination), false);
    }
    for (const malformed of [{ ...source, id: "foreign.JsValue" },
      { ...source, genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }] }]) {
      assert.equal(isRustClosedValueCarrier(malformed), false);
      assert.equal(selectRustProgramErrorConversion(malformed), undefined);
      assert.equal(rustProgramErrorConversionMatches({ ...conversion, source: malformed }, malformed, conversion.target), false);
    }
    for (const route of [{ kind: "closed", variant: "Retained" }, { kind: "retained" },
      { kind: "closed", boundary: "target-runtime" }]) {
      assert.equal(rustProgramErrorConversionMatches({ ...conversion, route }, source, conversion.target), false);
    }
  }
  for (const source of [undefined, rustSourcePrimitiveTargetType("uint64"), unrelated]) {
    assert.equal(isRustClosedValueCarrier(source), false);
  }
});

test("closed admission consumes the exact existing Error capability instead of erasing object identity", () => {
  for (const source of [rustJsErrorTargetType(), rustMutableJsErrorTargetType(), rustSourceErrorTargetType(),
    rustWritableSourceErrorTargetType(), rustRetainedErrorTargetType(), rustWritableRetainedErrorTargetType(), project]) {
    assert.equal(rustClosedValueRetainsError(source, definitions), true);
    for (const target of closedCarriers) {
      const conversion = selectRustSourceValueConversion(source, target, definitions);
      assert.ok(conversion);
      const contract = rustValueConversionContract(conversion, definitions);
      assert.ok(contract);
      assert.equal(contract.lowering, "call");
      assert.equal(contract.path, target.id === rustTsValueTargetType().id ? "rt::TsValue::from_error" : "js_abi::JsValue::from_error");
      assert.equal(contract.sourceMode, "value");
      assert.equal(contract.fallible, false);
    }
  }
  for (const source of [unrelated, rustSourcePrimitiveTargetType("uint64"),
    { ...rustRetainedErrorTargetType(), id: "foreign.RetainedError" },
    { ...rustRetainedErrorTargetType(), genericArguments: [{ kind: "type", type: project }] }]) {
    assert.equal(rustClosedValueRetainsError(source, definitions), false);
  }
  assert.equal(rustClosedValueRetainsError(project), false);
});

test("closed route mutation controls reject extra keys and accessors without evaluating them", () => {
  const source = rustTsValueTargetType();
  const conversion = selectRustProgramErrorConversion(source);
  let reads = 0;
  const accessor = { kind: "closed" };
  Object.defineProperty(accessor, "ignored", { enumerable: true, get() { reads++; return 1; } });
  const wrongSource = rustSourcePrimitiveTargetType("uint64");
  for (const changed of [{ ...conversion, route: accessor }, { ...conversion, extra: true },
    { ...conversion, source: wrongSource }, { ...conversion, target: rustSourceErrorTargetType() },
    { ...conversion, route: { kind: "runtime", boundary: "target-runtime" } }]) {
    assert.equal(rustProgramErrorConversionMatches(changed, source, rustProgramErrorTargetType()), false);
  }
  assert.equal(reads, 0);
});
