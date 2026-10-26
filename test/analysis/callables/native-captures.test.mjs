import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { createRustNativeCapturePlan, completeRustNativeCaptureCarrier } from "../../../dist/analysis/callables/native-captures.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustFixedArrayTargetType, rustFixedArrayCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { rustProducerErrorTargetType } from "../../../dist/target-model/types/carriers/producer-errors.js";

function fixture(text) {
  const program = analyzeRustErrorEffects(text, { surfaces: [] });
  const source = program.source;
  const storage = program.sourceStorage;
  const native = program.callableValues.native;
  const plan = createRustNativeCapturePlan({ records: program.records, storage,
    nativeStorage: program.callableValues.nativeStorage });
  const closures = storage.nodes.filter(node => source.ast.is.IsArrowFunction(node));
  const declaration = name => storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  return { program, native, storage, plan, closures, declaration };
}

test("used module declarations publish their explicit empty native environment before capture completion", () => {
  const current = fixture(`
    function selected(): number { return 7; }
    export function unused(): number { return 9; }
    type Unused = typeof unused;
    export function read(): number { return selected(); }
  `);
  const declaration = current.declaration("selected");
  const source = current.program.records.closureCapture.get(declaration);
  assert.equal(source !== undefined, true, "the source owner supplies an actual declaration environment");
  assert.equal(source.captures.length + source.receiverFields.length + source.receivers.length, 0,
    "this exact source module item has no runtime captured state");
  const plan = current.program.callableValues.selected.nativeCaptures;
  const selected = plan.forDeclaration(declaration);
  assert.equal(selected.kind, "resolved", "the used module item was requested before capture publication");
  assert.equal(selected.captures.length + selected.receiverFields.length + selected.receivers.length, 0,
    "no environment object or captured component is fabricated");
  assert.equal(selected.inputs.length, 0, "a direct native item adds no invocation dependency");
  assert.equal(selected.environment.typeParameters.length + selected.environment.lifetimes.length +
    selected.environment.constParameters.length, 0, "the environment is not the declaration's return signature");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.captures), true,
    "retention reads immutable native capture evidence");
  assert.equal(plan.forDeclaration(declaration) === selected, true, "retention does not recompute the selected environment");
  assert.equal(plan.forDeclaration(current.declaration("unused")).kind, "unresolved",
    "an unused module declaration is not made a demanded native environment");
  assert.equal(current.program.records.closureCapture.get(declaration) === source, true,
    "physical publication retains the original logical capture fact unchanged");
});

test("native captured equal-signature inputs retain distinct physical types without rewriting logical facts", () => {
  const current = fixture(`
    export function make(left: () => number, right: () => number): <Value>(value: Value) => Value {
      return <Value>(value: Value): Value => { left(); right(); return value; };
    }
  `);
  const closure = current.closures[0];
  const logical = current.program.records.closureCapture.get(closure);
  const selected = current.plan.forDeclaration(closure);
  assert.equal(selected.kind, "resolved", selected.reason);
  const inputs = current.native.inputsFor(current.declaration("make"));
  assert.equal(selected.inputs.length, 2);
  assert.equal(selected.captures.length, 2);
  assert.equal(inputs[0].implementation.identity !== inputs[1].implementation.identity, true);
  for (const input of inputs) {
    assert.equal(selected.inputs.includes(input), true);
    assert.equal(selected.captures.includes(input.implementation), true);
    assert.equal(selected.environment.typeIdentities.includes(input.implementation.identity), true);
    assert.equal(logical.captures.some(capture => capture.carrier === input.implementation), false);
  }
  assert.equal(current.program.records.closureCapture.get(closure) === logical, true);
  assert.equal(current.plan.forDeclaration(closure) === selected, true);
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.captures) && Object.isFrozen(selected.inputs), true);
});

test("native capture environment keeps ordinary captured values and excludes method generic parameters", () => {
  const current = fixture(`
    export function make<Outer>(captured: Outer): <Value>(value: Value) => Outer {
      return <Value>(value: Value): Outer => captured;
    }
  `);
  const closure = current.closures[0];
  const selected = current.plan.forDeclaration(closure);
  assert.equal(selected.kind, "resolved", selected.reason);
  assert.equal(selected.inputs.length, 0);
  assert.equal(selected.environment.typeParameters.length, 1);
  const logical = current.program.records.closureCapture.get(closure);
  assert.equal(rustTargetTypeRefEquals(selected.captures[0], logical.captures[0].carrier), true);
});

test("native capture environment rejects ambiguous mutation instead of choosing the first input", () => {
  const source = `
    export function make(left: () => number, right: () => number): <Value>(value: Value) => Value {
      left = right;
      return <Value>(value: Value): Value => { left(); return value; };
    }
  `;
  const current = fixture(source);
  const selected = current.plan.forDeclaration(current.closures[0]);
  assert.equal(selected.kind, "unresolved");
  assert.match(selected.reason, /physical|distinct|alternative/u);
  const { result } = compileRust({ files: { "index.ts": source } });
  assert.equal(result.artifacts.length, 0, "ambiguous mutation never publishes native output");
  assert.equal(result.diagnostics.length > 0, true, "the complete physical ABI also rejects the unresolved capture");
});

test("native capture environments retain exact receiver fields and whole receiver owners", () => {
  const current = fixture(`
    export class Counter {
      readonly count = 2;
      read(): number { return this.count; }
      field(): <Value>(value: Value) => number { return <Value>(value: Value): number => this.count; }
      owner(): <Value>(value: Value) => number { return <Value>(value: Value): number => this.read(); }
    }
  `);
  let fields = 0;
  let receivers = 0;
  for (const closure of current.closures) {
    const logical = current.program.records.closureCapture.get(closure);
    const selected = current.plan.forDeclaration(closure);
    assert.equal(selected.kind, "resolved", selected.reason);
    fields += selected.receiverFields.length;
    receivers += selected.receivers.length;
    for (const [index, carrier] of selected.receiverFields.entries())
      assert.equal(rustTargetTypeRefEquals(carrier, logical.receiverFields[index].carrier), true);
    for (const [index, carrier] of selected.receivers.entries())
      assert.equal(rustTargetTypeRefEquals(carrier, logical.receivers[index].carrier), true);
  }
  assert.equal(fields, 1);
  assert.equal(receivers, 1);
});

test("native capture query rejects foreign declarations without inspecting custom getters", () => {
  const current = fixture(`export function make(): <Value>(value: Value) => Value { return <Value>(value: Value): Value => value; }`);
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw Error("not owned"); } });
  assert.equal(current.plan.forDeclaration(foreign).kind, "unresolved");
  assert.equal(inspected, 0);
  const make = current.declaration("make");
  assert.equal(current.program.records.closureCapture.get(make) !== undefined, true,
    "the actual native source has complete capture evidence before constructing a missing-fact inverse");
  const missing = createRustNativeCapturePlan({ records: createRustRecordFixture({ closureCapture: {
    get: subject => subject === make ? undefined : current.program.records.closureCapture.get(subject),
  } }, current.program.records), storage: current.storage, nativeStorage: current.program.callableValues.nativeStorage });
  const declaration = missing.forDeclaration(make);
  assert.equal(declaration.kind === "unresolved" && /exact finalized capture declarations/u.test(declaration.reason), true,
    "only declarations with finalized capture facts are accepted");
  const unrequired = missing.complete().forDeclaration(make);
  assert.equal(unrequired.kind === "unresolved" && /only for its required/u.test(unrequired.reason), true,
    "a failed construction probe does not become a published required environment");
  assert.equal(current.program.callableValues.selected.nativeCaptures.forDeclaration(current.declaration("make")).kind,
    "unresolved", "the actual completed owner also excludes an unrequired declaration");
  assert.equal(current.plan.complete().forDeclaration(make).kind, "unresolved",
    "the valid fresh construction plan does not publish an unrequested outer declaration");
});

test("completed capture tuples bind every storage category before error normalization without deciding retention", () => {
  const parameter = { kind: "type-parameter", identity: "capture:Value", name: "Value" };
  const integer = { kind: "source-primitive", name: "int32" };
  const lifetime = { kind: "parameter", identity: "capture:Region", name: "Region" };
  const selectedLifetime = { kind: "parameter", identity: "actual:Region", name: "ActualRegion" };
  const length = { kind: "parameter", identity: "capture:Length", name: "Length" };
  const reference = { kind: "reference", mutable: false, referent: parameter, lifetime };
  const array = rustFixedArrayTargetType(parameter, length);
  const original = Object.freeze({ kind: "resolved", captures: Object.freeze([parameter]),
    receiverFields: Object.freeze([reference]), receivers: Object.freeze([array]), inputs: Object.freeze([]),
    environment: rustTargetGenericReferences({ kind: "tuple", elements: [parameter, reference, array] }) });
  const bindings = { types: new Map([[parameter.identity, integer]]),
    lifetimes: new Map([[rustLifetimeKey(lifetime), selectedLifetime]]),
    consts: new Map([[length.identity, { kind: "integer", value: "7" }]]) };
  let unrelatedReads = 0;
  const errorTypes = Object.defineProperties({}, Object.fromEntries(["ast", "components", "producers", "records", "definitions"]
    .map(name => [name, { get() { unrelatedReads++; assert.fail(`closed native captures do not query ${name}`); } }])));
  const selected = completeRustNativeCaptureCarrier({}, original, bindings, errorTypes);
  assert.equal(selected.kind, "resolved", "all three actual capture categories complete together");
  assert.equal(selected.carrier.kind, "tuple", "the result is physical captured storage, not a static verdict");
  assert.equal(selected.carrier.elements.length, 3, "ordinary captures, receiver fields and receivers are all retained");
  assert.equal(rustTargetTypeRefEquals(selected.carrier.elements[0], integer), true, "actual type binding reaches ordinary captures");
  const field = selected.carrier.elements[1];
  assert.equal(field.kind === "reference" && rustTargetTypeRefEquals(field.referent, integer), true,
    "the same actual type binding reaches the receiver field");
  assert.equal(field.lifetime.identity, selectedLifetime.identity, "the actual borrowed lifetime is preserved, never made static");
  const receiver = rustFixedArrayCarrierValue(selected.carrier.elements[2]);
  assert.equal(receiver !== undefined && rustTargetTypeRefEquals(receiver.element, integer), true,
    "receiver storage receives the same type binding");
  assert.equal(receiver.length.kind === "integer" && receiver.length.value === "7", true,
    "receiver storage retains the actual const binding");
  assert.equal(unrelatedReads, 0, "normal closed carriers require no second source or static classifier");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.carrier) && Object.isFrozen(selected.carrier.elements), true,
    "the completed tuple is immutable");
  assert.equal(original.captures[0] === parameter && original.receiverFields[0] === reference && original.receivers[0] === array,
    true, "completion never rewrites the original capture inventory");
  assert.equal(original.receiverFields[0].lifetime === lifetime, true, "the original template lifetime stays intact");
});

test("capture completion preserves unresolved evidence and refuses an unregistered physical error", () => {
  const unresolved = Object.freeze({ kind: "unresolved", reason: "the exact captured native owner is unavailable" });
  const bindings = { types: new Map(), lifetimes: new Map(), consts: new Map() };
  assert.equal(completeRustNativeCaptureCarrier({}, unresolved, bindings, {}) === unresolved, true,
    "unresolved evidence is not an empty successful environment");
  const error = rustProducerErrorTargetType({ identity: "missing:producer", fileName: "/missing.ts",
    channel: "invoke", genericArguments: [] });
  const captures = { kind: "resolved", captures: [error], receiverFields: [], receivers: [], inputs: [],
    environment: rustTargetGenericReferences(error) };
  let lookups = 0;
  const selected = completeRustNativeCaptureCarrier({}, captures, bindings, { producers: {
    forIdentity(identity) {
      lookups++;
      assert.equal(identity, "missing:producer", "the existing error owner receives the exact source identity");
      return undefined;
    },
  } });
  assert.equal(lookups, 1, "the original error normalizer is the only physical error lookup");
  assert.equal(selected.kind === "unresolved" && /admitted physical error-boundary carriers/u.test(selected.reason), true,
    "missing native error evidence is not relabelled as an empty or infallible capture");
});
