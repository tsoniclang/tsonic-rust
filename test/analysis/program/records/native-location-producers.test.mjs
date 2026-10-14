import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";

const integer = Object.freeze({ kind: "source-primitive", name: "uint32" });
const otherInteger = Object.freeze({ kind: "source-primitive", name: "uint64" });
const layout = Object.freeze({ kind: "scalar", pointeeCarrier: integer, size: 4, alignment: 4,
  width: 64, littleEndian: true, fields: Object.freeze([]) });
const changedLayout = Object.freeze({ ...layout, alignment: 1 });
const families = [["nativeArrayStorage", "nativeArrays"], ["nativeBacking", "nativeBackings"],
  ["rawLocationPlan", "rawLocations"], ["memoryBindingPlan", "memoryBindings"], ["rawAddressPlan", "rawAddresses"]];

test("native-location families expose one immutable reader and no generic publication port", () => {
  const builder = createRustProgramRecordBuilder();
  const records = builder.seal();
  for (const [family, producer] of families) {
    assert.equal(builder[family] === builder[producer].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(Object.isFrozen(records[family]), true, family);
    assert.equal(Object.isFrozen(builder[producer]), true, producer);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.equal(records[family].get({}) === undefined, true, family);
    for (const removed of ["set", "admit", "reuse", "seal"]) {
      assert.equal(builder[family][removed] === undefined, true, `${family}:${removed}`);
    }
    assert.equal(records[producer] === undefined, true, producer);
  }
});

test("each native-location producer refuses every admission form after sealing", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  builder.seal();
  for (const write of [
    () => builder.nativeArrays.promote([], subject, layout, 4),
    () => builder.nativeArrays.promote([[subject, "binding"]], subject, layout, 4),
    () => builder.nativeBackings.require(subject, layout),
    () => builder.rawLocations.conversion(subject, "to-raw", subject, integer, layout),
    () => builder.rawLocations.conversion(subject, "reinterpret", subject, integer, layout),
    () => builder.memoryBindings.field(subject, integer, subject),
    () => builder.memoryBindings.record(subject, integer, []),
    () => builder.rawAddresses.identity(subject, "same", integer, []),
    () => builder.rawAddresses.identity(subject, "hash", integer, []),
    ...["address", "from_address", "offset", "offset_unsigned"].map(method =>
      () => builder.rawAddresses.address(subject, method, 64, integer, [])),
  ]) assert.throws(write, /after analysis is sealed/u);
});

test("native array promotion constructs exact binding, reference, literal and element records", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const subjects = ["binding", "reference", "literal", "element"].map(kind => [{}, kind]);
  assert.equal(builder.nativeArrays.promote(subjects, declaration, layout, 8), true);
  for (const [subject, kind] of subjects) {
    const actual = builder.nativeArrayStorage.get(subject);
    assert.equal(Object.isFrozen(actual), true, kind);
    assert.equal(actual.kind, kind);
    assert.equal(actual.layout === layout, true, kind);
    assert.equal(actual.stride, 8);
    assert.equal("declaration" in actual, kind === "element");
    if (kind === "element") assert.equal(actual.declaration === declaration, true);
    assert.equal(builder.nativeArrayStorage.get({}) === undefined, true, kind);
  }
  assert.equal(builder.minimumFoundation(), "core", "the original family does not invent a foundation requirement");
});

test("native array compatibility is checked for the entire group before publishing any member", () => {
  for (const [label, incomingLayout, stride] of [["layout", changedLayout, 8], ["stride", layout, 4]]) {
    const builder = createRustProgramRecordBuilder();
    const declaration = {};
    const existing = {};
    const fresh = {};
    assert.equal(builder.nativeArrays.promote([[existing, "binding"]], declaration, layout, 8), true);
    const original = builder.nativeArrayStorage.get(existing);
    assert.equal(builder.nativeArrays.promote([[fresh, "literal"], [existing, "binding"]], declaration,
      incomingLayout, stride), false, label);
    assert.equal(builder.nativeArrayStorage.get(fresh) === undefined, true, label);
    assert.equal(builder.nativeArrayStorage.get(existing) === original, true, label);
  }
});

test("native array promotion preserves inherited canonical identity and strict kind/declaration conflicts", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  const subject = {};
  parent.nativeArrays.promote([[subject, "element"]], declaration, layout, 8);
  const original = parent.nativeArrayStorage.get(subject);
  const records = parent.seal();
  const child = createRustProgramRecordBuilder(undefined, records);
  assert.equal(child.nativeArrays.promote([[subject, "element"]], declaration, { ...layout }, 8), true);
  assert.equal(child.nativeArrayStorage.get(subject) === original, true);
  assert.throws(() => child.nativeArrays.promote([[subject, "element"]], {}, layout, 8), /Conflicting Rust semantic plan/u);
  assert.throws(() => child.nativeArrays.promote([[subject, "reference"]], declaration, layout, 8), /Conflicting Rust semantic plan/u);
  assert.equal(child.nativeArrayStorage.get(subject) === original, true);
  const fresh = {};
  child.nativeArrays.promote([[fresh, "binding"]], fresh, layout, 8);
  assert.equal(records.nativeArrayStorage.get(fresh) === undefined, true, "specialization never mutates its parent");
});

test("native array demand coalesces identical component contributions without replacing canonical evidence", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const element = {};
  const reference = {};
  assert.equal(builder.nativeArrays.promote([[element, "element"], [element, "element"]], declaration, layout, 8), true);
  const original = builder.nativeArrayStorage.get(element);
  assert.equal(builder.nativeArrays.promote([[element, "element"], [reference, "reference"], [element, "element"]],
    declaration, { ...layout }, 8), true);
  assert.equal(builder.nativeArrayStorage.get(element) === original, true, "the exact original component record is retained");
  const referenceRecord = builder.nativeArrayStorage.get(reference);
  assert.equal(referenceRecord?.kind, "reference");
  assert.equal(builder.nativeArrays.promote([[reference, "reference"], [element, "element"]], declaration, layout, 8), true);
  assert.equal(builder.nativeArrayStorage.get(reference) === referenceRecord, true);
  builder.seal();
  assert.throws(() => builder.nativeArrays.promote([[element, "element"]], declaration, layout, 8), /after analysis is sealed/u);
});

test("native array metadata conflicts refuse the whole group before any new publication", () => {
  for (const existingConflict of [false, true]) {
    const builder = createRustProgramRecordBuilder();
    const declaration = {};
    const fresh = {};
    const subject = {};
    if (existingConflict) builder.nativeArrays.promote([[subject, "element"]], declaration, layout, 8);
    const original = builder.nativeArrayStorage.get(subject);
    const group = existingConflict ? [[fresh, "literal"], [subject, "reference"]]
      : [[fresh, "literal"], [subject, "binding"], [subject, "reference"]];
    assert.throws(() => builder.nativeArrays.promote(group, declaration, layout, 8), /Conflicting Rust semantic plan/u);
    assert.equal(builder.nativeArrayStorage.get(fresh) === undefined, true, "no earlier group member may leak");
    assert.equal(builder.nativeArrayStorage.get(subject) === original, true, "no partial new or replaced subject");
    if (existingConflict) {
      assert.equal(builder.nativeArrays.promote(group, declaration, changedLayout, 8), false,
        "the established layout refusal precedes internal metadata correspondence");
    }
  }
});

test("native backing admits the exact layout once and reports incompatible source demands without replacing it", () => {
  const parent = createRustProgramRecordBuilder();
  const subject = {};
  assert.equal(parent.nativeBackings.require(subject, layout), true);
  assert.equal(parent.nativeBacking.get(subject) === layout, true);
  assert.equal(parent.nativeBackings.require(subject, { ...layout, pointeeCarrier: { ...integer } }), true);
  assert.equal(parent.nativeBackings.require(subject, changedLayout), false);
  const inherited = parent.seal();
  const child = createRustProgramRecordBuilder(undefined, inherited);
  assert.equal(child.nativeBacking.get(subject) === layout, true);
  assert.equal(child.nativeBackings.require(subject, { ...layout }), true);
  assert.equal(child.nativeBackings.require(subject, { ...layout, pointeeCarrier: otherInteger }), false);
  assert.equal(child.nativeBacking.get(subject) === layout, true);
  const fresh = {};
  assert.equal(child.nativeBackings.require(fresh, changedLayout), true);
  assert.equal(inherited.nativeBacking.get(fresh) === undefined, true);
  assert.equal(child.minimumFoundation(), "core");
});

test("raw-location conversion construction keeps exact expression identity, operation, carrier and layout", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const expression = {};
  builder.rawLocations.conversion(subject, "to-raw", expression, integer, layout);
  const original = builder.rawLocationPlan.get(subject);
  assert.equal(original.expression === expression, true);
  assert.equal(original.operation, "to-raw");
  assert.equal(original.inputCarrier === integer, true);
  assert.equal(original.layout === layout, true);
  assert.equal(Object.isFrozen(original), true);
  builder.rawLocations.conversion(subject, "to-raw", expression, { ...integer }, { ...layout });
  assert.equal(builder.rawLocationPlan.get(subject) === original, true);
  for (const [operation, operand, carrier, selectedLayout] of [
    ["reinterpret", expression, integer, layout], ["to-raw", {}, integer, layout],
    ["to-raw", expression, otherInteger, layout], ["to-raw", expression, integer, changedLayout],
  ]) assert.throws(() => builder.rawLocations.conversion(subject, operation, operand, carrier, selectedLayout),
    /Conflicting Rust semantic plan/u);
  const child = createRustProgramRecordBuilder(undefined, builder.seal());
  child.rawLocations.conversion(subject, "to-raw", expression, integer, layout);
  assert.equal(child.rawLocationPlan.get(subject) === original, true);
});

test("field and record memory-binding construction preserves exact ordered location storage", () => {
  const builder = createRustProgramRecordBuilder();
  const field = {};
  const expression = {};
  builder.memoryBindings.field(field, integer, expression);
  const original = builder.memoryBindingPlan.get(field);
  assert.equal(original.kind, "field");
  assert.equal(original.expression === expression, true);
  assert.equal(original.carrier === integer, true);
  assert.equal(Object.isFrozen(original), true);
  builder.memoryBindings.field(field, { ...integer }, expression);
  assert.equal(builder.memoryBindingPlan.get(field) === original, true);
  assert.throws(() => builder.memoryBindings.field(field, integer, {}), /Conflicting Rust semantic plan/u);
  assert.throws(() => builder.memoryBindings.field(field, otherInteger, expression), /Conflicting Rust semantic plan/u);
  assert.throws(() => builder.memoryBindings.record(field, integer, []), /Conflicting Rust semantic plan/u);
  const record = {};
  const fields = [Object.freeze({ expression, storageIndex: 0, carrier: integer }),
    Object.freeze({ expression: {}, storageIndex: 1, carrier: otherInteger })];
  builder.memoryBindings.record(record, integer, fields);
  const selected = builder.memoryBindingPlan.get(record);
  assert.equal(selected.kind, "record");
  assert.equal(selected.fields === fields, true, "no copying or competing field storage");
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(fields), true);
  builder.memoryBindings.record(record, { ...integer }, fields.map(entry => ({ ...entry })));
  assert.equal(builder.memoryBindingPlan.get(record) === selected, true);
  for (const changed of [[], [...fields].reverse(), [{ ...fields[0], storageIndex: 1 }, fields[1]],
    [{ ...fields[0], expression: {} }, fields[1]], [{ ...fields[0], carrier: otherInteger }, fields[1]]]) {
    assert.throws(() => builder.memoryBindings.record(record, integer, changed), /Conflicting Rust semantic plan/u);
  }
  const empty = {};
  builder.memoryBindings.record(empty, integer, []);
  assert.equal(builder.memoryBindingPlan.get(empty).fields.length, 0);
  const child = createRustProgramRecordBuilder(undefined, builder.seal());
  child.memoryBindings.field(field, integer, expression);
  child.memoryBindings.record(record, integer, fields);
  assert.equal(child.memoryBindingPlan.get(field) === original, true);
  assert.equal(child.memoryBindingPlan.get(record) === selected, true);
});

test("raw address constructors preserve width only for exact address operations and ordered argument evidence", () => {
  const builder = createRustProgramRecordBuilder();
  const operands = [Object.freeze({ expression: {}, carrier: integer, input: "raw-ref" }),
    Object.freeze({ expression: {}, carrier: otherInteger, input: "i128" })];
  for (const method of ["same", "hash", "address", "from_address", "offset", "offset_unsigned"]) {
    const subject = {};
    const arguments_ = [...operands];
    if (method === "same" || method === "hash") builder.rawAddresses.identity(subject, method, integer, arguments_);
    else builder.rawAddresses.address(subject, method, 32, integer, arguments_);
    const actual = builder.rawAddressPlan.get(subject);
    assert.equal(actual.method, method);
    assert.equal(actual.resultCarrier === integer, true);
    assert.equal(actual.arguments === arguments_, true, "the original argument array is not cloned");
    assert.equal(Object.isFrozen(arguments_), true);
    assert.equal(Object.isFrozen(actual), true);
    assert.equal("width" in actual, method !== "same" && method !== "hash");
    if ("width" in actual) assert.equal(actual.width, 32);
  }
});

test("raw address equality keeps every exact native operation, width, result and argument discriminator", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const operand = { expression: {}, carrier: integer, input: "u64" };
  builder.rawAddresses.address(subject, "address", 64, integer, [operand]);
  const original = builder.rawAddressPlan.get(subject);
  builder.rawAddresses.address(subject, "address", 64, { ...integer }, [{ ...operand, carrier: { ...integer } }]);
  assert.equal(builder.rawAddressPlan.get(subject) === original, true);
  for (const [method, width, result, arguments_] of [
    ["from_address", 64, integer, [operand]], ["address", 32, integer, [operand]],
    ["address", 64, otherInteger, [operand]], ["address", 64, integer, []],
    ["address", 64, integer, [{ ...operand, expression: {} }]],
    ["address", 64, integer, [{ ...operand, input: "i128" }]],
    ["address", 64, integer, [{ ...operand, carrier: otherInteger }]],
  ]) assert.throws(() => builder.rawAddresses.address(subject, method, width, result, arguments_), /Conflicting Rust semantic plan/u);
  assert.throws(() => builder.rawAddresses.identity(subject, "hash", integer, [operand]), /Conflicting Rust semantic plan/u);
  const child = createRustProgramRecordBuilder(undefined, builder.seal());
  child.rawAddresses.address(subject, "address", 64, integer, [operand]);
  assert.equal(child.rawAddressPlan.get(subject) === original, true);
  const fresh = {};
  child.rawAddresses.identity(fresh, "same", integer, []);
  assert.equal(builder.rawAddressPlan.get(fresh) === undefined, true);
  assert.equal(child.minimumFoundation(), "core");
});
