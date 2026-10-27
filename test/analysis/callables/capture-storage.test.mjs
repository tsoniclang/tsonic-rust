import { rustBindingStorageEquals } from "../../../dist/target-model/records/equality.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram, sourceBindingHasSingleCaptureOwner } from "@tsonic/target-api/source";
import { rustCapturedBindingStorage } from "../../../dist/analysis/callables/storage/capture-storage.js";




import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustBorrowedStrTargetType, rustFutureTargetType } from "../../../dist/target-model/types/index.js";
import { sourceInput } from "../../../dist/policy/operations/members/abi/conversions.js";
import { rustStringToBorrowedStrValueConversion } from "../../../dist/target-model/conversions/model.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const scalarCarrier = { kind: "source-primitive", name: "float64" };
const stringCarrier = { kind: "target-named", id: "rust.std.String" };

test("single captured native strings retain inline storage through exact pure borrowed observations", () => {
  const borrowed = rustBorrowedStrTargetType();
  const size = { kind: "source-primitive", name: "native-uint" };
  const conversion = { kind: "identity", sourceCarrier: size, targetCarrier: size, fallible: false };
  const input = sourceInput({ kind: "receiver" }, stringCarrier, "value", rustStringToBorrowedStrValueConversion);
  const mutableOwner = sourceInput({ kind: "receiver" }, stringCarrier, "mut-ref", undefined);
  const owned = sourceInput({ kind: "receiver" }, stringCarrier, "value", undefined);
  const mutableView = sourceInput({ kind: "receiver" }, stringCarrier, "mut-ref", rustStringToBorrowedStrValueConversion);
  for (const [label, selected] of [["borrowed", input], ["mutable owner", mutableOwner], ["owned", owned], ["mutable converted view", mutableView]])
    assert.equal(selected !== undefined, true, label + ": the canonical ABI finalizer admits the complete input");
  assert.equal(input.sharedConversion, true);
  assert.equal(mutableOwner.sharedConversion, false);
  assert.equal(mutableOwner.parameterCarrier.mutable, true);
  assert.equal(mutableView.sharedConversion, true);
  assert.equal(mutableView.parameterCarrier.mutable, true);
  assert.equal(mutableView.parameterCarrier.referent.kind, "reference");
  assert.equal(rustTargetTypeRefEquals(input.parameterCarrier, borrowed), true);
  const original = { kind: "provider-operation", operationId: "fixture.string.length", abi: {
    operationKind: "property", target: { form: "field", name: "length" },
    sourceReceiver: { kind: "receiver", carrier: stringCarrier, declaredCarrier: stringCarrier, disposition: "runtime" },
    sourceArguments: [], targetGenericArguments: [], dispatchInputs: [],
    effects: { evaluation: "pure", safety: "safe", invocation: "infallible", awaiting: "not-applicable", errorBoundary: "none" },
    result: { kind: "sync", rawCarrier: size, conversion, carrier: size },
    targetReceiver: { kind: "input", input }, targetArguments: [],
  } };
  for (const [label, operation, expected] of [
    ["exact borrowed view", original, "borrow-cell"],
    ["no selected operation", undefined, "location"],
    ["observable", { ...original, abi: { ...original.abi, effects: { ...original.abi.effects, evaluation: "observable" } } }, "location"],
    ["unsafe", { ...original, abi: { ...original.abi, effects: { ...original.abi.effects, safety: "requires-unsafe" } } }, "location"],
    ["fallible", { ...original, abi: { ...original.abi, effects: { ...original.abi.effects, invocation: "fallible" } } }, "location"],
    ["suspended", { ...original, abi: { ...original.abi, result: { kind: "async", futureCarrier: rustFutureTargetType(size),
      awaitedRawCarrier: size, awaitedConversion: conversion, awaitedCarrier: size } } }, "location"],
    ["retained result", { ...original, abi: { ...original.abi, result: { ...original.abi.result, carrier: stringCarrier } } }, "location"],
    ["missing receiver", { ...original, abi: { ...original.abi, targetReceiver: { kind: "none" } } }, "location"],
    ["mutable original owner", { ...original, abi: { ...original.abi, targetReceiver: { kind: "input", input: mutableOwner } } }, "location"],
    ["wrong view", { ...original, abi: { ...original.abi, targetReceiver: { kind: "input", input: owned } } }, "location"],
    ["mutable converted view only", { ...original, abi: { ...original.abi, targetReceiver: { kind: "input", input: mutableView } } }, "borrow-cell"],
  ]) {
    const current = fixture(`export function outer(seed: string) {
      const callback = () => { seed += "!"; return seed.length; }; return callback;
    }`, { carrier: stringCarrier });
    let property;
    const visit = node => {
      if (current.source.ast.is.IsPropertyAccessExpression(node)) property = node;
      current.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(current.owner);
    assert.equal(property !== undefined, true, label);
    if (operation !== undefined) current.records.targetOperations.source(property, operation);
    assert.equal(current.select()?.storage, expected, label);
  }
});

test("selected native borrowed method receivers retain the same single-owner proof as direct inputs", () => {
  const borrowed = rustBorrowedStrTargetType();
  const input = sourceInput({ kind: "receiver" }, stringCarrier, "value", rustStringToBorrowedStrValueConversion);
  const owned = sourceInput({ kind: "receiver" }, stringCarrier, "value", undefined);
  assert.equal(input !== undefined && owned !== undefined, true, "both complete native receiver contracts are admitted");
  assert.equal(rustTargetTypeRefEquals(input.parameterCarrier, borrowed), true);
  const result = { kind: "source-primitive", name: "int32" };
  const original = { kind: "provider-operation", operationId: "fixture.string.indexOf", abi: {
    operationKind: "method", target: { form: "instance-method", method: "index_of" },
    sourceReceiver: { kind: "receiver", carrier: stringCarrier, declaredCarrier: stringCarrier, disposition: "runtime" },
    sourceArguments: [], targetGenericArguments: [], dispatchInputs: [],
    effects: { evaluation: "pure", safety: "safe", invocation: "infallible", awaiting: "not-applicable", errorBoundary: "none" },
    result: { kind: "sync", rawCarrier: result, carrier: result,
      conversion: { kind: "identity", sourceCarrier: result, targetCarrier: result, fallible: false } },
    targetReceiver: { kind: "input", input }, targetArguments: [],
  } };
  for (const wrapped of [false, true]) for (const [label, operation, expected] of [
    ["selected borrowed receiver", original, "borrow-cell"],
    ["unknown native method", undefined, "location"],
    ["observable receiver", { ...original, abi: { ...original.abi, effects: { ...original.abi.effects, evaluation: "observable" } } }, "location"],
    ["fallible receiver", { ...original, abi: { ...original.abi, effects: { ...original.abi.effects, invocation: "fallible" } } }, "location"],
    ["owned receiver", { ...original, abi: { ...original.abi, targetReceiver: { kind: "input", input: owned } } }, "location"],
  ]) {
    const current = fixture(`export function outer(seed: string) {
      const callback = () => { seed += "!"; return ${wrapped ? "((seed))" : "seed"}.indexOf("7"); }; return callback;
    }`, { carrier: stringCarrier });
    let call;
    const visit = node => {
      if (current.source.ast.is.IsCallExpression(node)) call = node;
      current.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(current.owner);
    assert.equal(call !== undefined, true, label);
    if (operation !== undefined) current.records.targetOperations.source(call, operation);
    assert.equal(current.select()?.storage, expected, `${label}, wrapped=${wrapped}`);
  }
});

test("loop activation identities distinguish immutable values, live lexical storage and var bindings", () => {
  for (const [kind, body, expected] of [
    ["let", "", "value"], ["let", "seed += 1;", "location"], ["var", "", "location"],
  ]) {
    const current = fixture(`
      export function outer() {
        let previous: (() => number) | undefined;
        for (${kind} seed = 0; seed < 3; seed++) {
          const callback = () => seed;
          ${body}
          previous = callback;
        }
        return previous;
      }
    `);
    const selected = current.select({ permitSingleOwner: false });
    assert.equal(selected?.storage, expected, "exact native capture representation");
    const scope = current.source.ast.as.AsForStatement(current.source.ast.parent(
      current.source.ast.parent(current.declaration)));
    assert.equal(scope !== undefined, true, "source header has an exact for scope");
    assert.equal(selected?.iterationScope !== undefined, kind === "let" && expected === "location");
    if (selected?.iterationScope !== undefined) {
      assert.equal(current.source.ast.kindName(selected.iterationScope), "KindForStatement");
      const fact = { storage: selected.storage, valueCarrier: scalarCarrier, iterationScope: selected.iterationScope };
      assert.equal(rustBindingStorageEquals(fact, { ...fact }), true);
      assert.equal(rustBindingStorageEquals(fact, { ...fact, iterationScope: {} }), false);
      assert.equal(rustBindingStorageEquals(fact, { storage: selected.storage, valueCarrier: scalarCarrier }), false);
    }
  }
});

test("incrementor-created captures retain their live lexical activation", () => {
  const current = fixture(`
    export function outer() {
      let callback = () => -1;
      for (let seed = 0; seed < 3; (callback = () => seed, seed++)) {}
      return callback;
    }
  `);
  const owner = current.source.ast.as.AsForStatement(
    current.source.ast.parent(current.source.ast.parent(current.declaration)))?.Incrementor;
  assert.equal(owner !== undefined, true, "exact incrementor expression");
  const selected = current.select({ permitSingleOwner: false, roots: [owner] });
  assert.equal(selected?.storage, "location");
  assert.equal(selected?.iterationScope !== undefined, true);
});

test("loop storage selection includes later incrementor captures before caching any owner", () => {
  const current = fixture(`
    export function outer() {
      let saved = () => -1;
      for (let seed = 0; seed < 3; (saved = () => seed, seed++)) {
        const callback = () => seed;
        callback();
      }
      return saved;
    }
  `);
  const selected = current.select({ permitSingleOwner: false });
  assert.equal(selected?.storage, "location", "a body capture cannot hide a later live incrementor capture");
  assert.equal(selected?.iterationScope !== undefined, true);
});

test("binding activation facts reject incomplete, accessor-backed and competing storage", () => {
  const scope = {};
  const fact = { storage: "location", valueCarrier: scalarCarrier, iterationScope: scope };
  for (const changed of [{ ...fact, unrelated: true }, { ...fact, valueCarrier: undefined },
    { ...fact, storage: "cell" }, { ...fact, initialization: "unchecked" }, { ...fact, iterationScope: null }]) {
    assert.equal(rustBindingStorageEquals(fact, changed), false, "exact sealed native activation");
  }
  let reads = 0;
  const accessor = { ...fact };
  Object.defineProperty(accessor, "iterationScope", { get() { reads++; return scope; }, enumerable: true });
  assert.equal(rustBindingStorageEquals(fact, accessor), false);
  assert.equal(reads, 0, "evidence validation never evaluates a metadata accessor");
});

function fixture(text, options = {}) {
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: { "/project/index.ts": text },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 1024));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  assert.equal(file !== undefined, true, "exact checked fixture");
  const declarations = new Map();
  const visit = node => {
    if (source.ast.is.IsVariableDeclaration(node) || source.ast.is.IsParameterDeclaration(node) ||
      source.ast.is.IsFunctionDeclaration(node)) {
      const name = source.ast.name(node);
      if (name !== undefined) declarations.set(source.ast.text(name), node);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  const declaration = declarations.get("seed");
  const callback = declarations.get(options.ownerBinding ?? "callback");
  const owner = source.ast.as.AsVariableDeclaration(callback)?.Initializer ?? callback;
  assert.equal(declaration !== undefined && owner !== undefined, true, "exact binding and capture owner");
  const summary = source.navigation.declarationUseSummary(declaration);
  const reference = summary.uses.find(use => use.kind !== "type-only")?.reference;
  assert.equal(reference !== undefined, true, "exact retained reference");
  const records = createRustProgramRecordBuilder();
  const navigation = options.summary === undefined ? source.navigation : {
    ...source.navigation,
    declarationUseSummary: selected => {
      const current = source.navigation.declarationUseSummary(selected);
      return selected === declaration ? options.summary(current) : current;
    },
  };
  const walk = {
    context: { ast: source.ast, source: { ...source, navigation }, records, requiredRecords: [] },
    capturedBindingStorage: new Map(),
    promotedStorageDeclarations: new Set(),
  };
  const select = (settings = {}) => rustCapturedBindingStorage(walk, declaration,
    settings.reference ?? reference, owner,
    Object.hasOwn(settings, "carrier") ? settings.carrier : options.carrier ?? scalarCarrier,
    settings.permitSingleOwner ?? true, settings.nativeCallTrait, settings.roots ?? [owner]);
  return { source, declaration, declarations, owner, reference, summary, walk, records, select };
}

for (const kind of ["deferred", "iteration"]) for (const addressFirst of [false, true]) {
  test(`complete ${kind} storage is admitted once with ${addressFirst ? "address" : "capture"} demand first`, () => {
    const current = fixture(kind === "deferred" ? `
      export function outer() {
        const callback = () => seed;
        const second = () => seed;
        const seed: number = 3;
        return callback;
      }
    ` : `
      export function outer() {
        for (let seed = 0; seed < 2; seed++) {
          const callback = () => seed;
          const second = () => seed;
          callback(); second();
        }
      }
    `);
    current.walk.promotedStorageDeclarations.add(current.declaration);
    let admissions = 0;
    const producer = current.records.bindingStoragePlans;
    const tracked = { ...producer, capture(...arguments_) {
      admissions++;
      return producer.capture(...arguments_);
    }, requireLocation(...arguments_) {
      const absent = current.records.bindingStorage.get(current.declaration) === undefined;
      const accepted = producer.requireLocation(...arguments_);
      if (absent && accepted) admissions++;
      return accepted;
    } };
    current.walk.context.records = { ...current.records, bindingStoragePlans: tracked };
    const address = () => tracked.requireLocation(current.walk.context, current.declaration, scalarCarrier);
    if (addressFirst) assert.equal(address(), true);
    const selected = current.select({ permitSingleOwner: false });
    const canonical = current.records.bindingStorage.get(current.declaration);
    assert.equal(selected.storage, "location");
    assert.equal(canonical.initialization, kind === "deferred" ? "deferred" : undefined);
    assert.equal(canonical.iterationScope !== undefined, kind === "iteration");
    assert.equal(address(), true);
    assert.equal(address(), true);
    assert.equal(current.select({ permitSingleOwner: false }) === selected, true);
    assert.equal(current.records.bindingStorage.get(current.declaration) === canonical, true);
    assert.equal(admissions, 1, "two captures and two addresses share the complete declaration decision");
    assert.equal(tracked.requireLocation(current.walk.context, current.declaration, stringCarrier), false);
    assert.throws(() => current.select({ carrier: stringCarrier }), /Conflicting Rust semantic plan/u);
    assert.equal(current.records.bindingStorage.get(current.declaration) === canonical, true);
    current.records.seal(current.walk.context.requiredRecords);
    assert.throws(address, /after analysis is sealed/u);
    assert.throws(() => current.select(), /after analysis is sealed/u);
  });
}

test("an addressability demand cannot replace a selected cell or native carrier", () => {
  const current = fixture(`
    export function outer(seed: number) {
      const callback = () => { seed += 1; return seed; };
      return callback;
    }
  `);
  assert.equal(current.select().storage, "cell");
  const canonical = current.records.bindingStorage.get(current.declaration);
  assert.equal(current.records.bindingStoragePlans.requireLocation(current.walk.context, current.declaration, scalarCarrier), false);
  assert.equal(current.records.bindingStorage.get(current.declaration) === canonical, true);
});

for (const [name, text, carrier, storage] of [
  ["arithmetic non-Copy read", `
    export function outer(seed: string) {
      const callback = (suffix: string) => { seed = seed + suffix; return seed; };
      return callback;
    }
  `, stringCarrier, "borrow-cell"],
  ["branching Copy read", `
    export function outer(seed: number) {
      const callback = (increment: boolean) => {
        if (increment) seed += 2; else seed = seed - 1;
        return seed;
      };
      return callback;
    }
  `, scalarCarrier, "cell"],
  ["transparent checked read", `
    export function outer(seed: string) {
      const callback = (suffix: string) => { seed = (seed as string) + suffix; return seed; };
      return callback;
    }
  `, stringCarrier, "borrow-cell"],
]) test(`exact native ${name} completes classification without changing the shared owner proof`, () => {
  const current = fixture(text, { carrier });
  assert.equal(current.summary.hasUnclassifiedValueUse, true, name);
  assert.equal(sourceBindingHasSingleCaptureOwner(current.declaration, current.owner, [current.owner],
    current.source.ast, current.source.navigation, use => use.role !== "value"), false,
    "shared source classification remains conservative");
  assert.deepEqual(current.select(), { storage });
  assert.equal(current.source.navigation.declarationUseSummary(current.declaration) === current.summary, true);
  assert.equal(current.summary.hasUnclassifiedValueUse, true, "native classification does not mutate shared evidence");
});

test("type-only uses do not skip later native alias checks", () => {
  const current = fixture(`
    export function outer(seed: number) {
      type Value = typeof seed;
      const callback = () => ++seed;
      const second = (): Value => ++seed;
      return [callback, second];
    }
  `);
  assert.equal(current.summary.uses.some(use => use.kind === "type-only"), true);
  assert.deepEqual(current.select(), { storage: "location" });
});

for (const [name, text] of [
  ["independent captures", `
    export function outer(seed: number) {
      const callback = () => ++seed;
      const other = () => ++seed;
      return [callback, other];
    }
  `],
  ["repeated owner activation", `
    export function outer(seed: number) {
      for (let index = 0; index < 2; index++) {
        const callback = () => ++seed;
        callback();
      }
      return 0;
    }
  `],
  ["nested retained owner", `
    export function outer(seed: number) {
      const callback = () => () => ++seed;
      return callback;
    }
  `],
  ["outer live use", `
    export function outer(seed: number) {
      const callback = () => ++seed;
      callback();
      return seed;
    }
  `],
  ["external reassignment", `
    export function outer(seed: number) {
      const callback = () => ++seed;
      seed = 99;
      return callback;
    }
  `],
]) test(`${name} cannot acquire inline single-owner storage`, () => {
  assert.deepEqual(fixture(text).select(), { storage: "location" });
});

test("deferred initialization cannot be reduced to inline storage", () => {
  const current = fixture(`
    export function outer() {
      const callback = () => ++seed;
      let seed = 1;
      return callback;
    }
  `);
  assert.deepEqual(current.select(), { storage: "location", initialization: "deferred" });
});

test("a reassigned lexical callback retains live binding storage instead of a fixed inline payload", () => {
  const current = fixture(`
    export function outer() {
      let seed: (count: number) => number = count => count === 0 ? 1 : seed(count - 1);
      const callback = seed;
      seed = () => 99;
      return callback;
    }
  `, { ownerBinding: "seed", carrier: rustCallableTargetType([scalarCarrier], scalarCarrier) });
  assert.equal(current.summary.bindingWritten, true, "exact rebinding evidence");
  assert.deepEqual(current.select(), { storage: "location" });
});

test("direct lexical roots retain reachability and first-class alias guards", () => {
  for (const retained of [false, true]) {
    const current = fixture(`
      export function outer(seed: number) {
        function next() { return ++seed; }
        const callback = () => next();
        return ${retained ? "[callback, next]" : "callback"};
      }
    `);
    assert.deepEqual(current.select({ roots: [current.owner, current.declarations.get("next")] }),
      { storage: retained ? "location" : "cell" });
  }
  const disconnected = fixture(`
    export function outer(seed: number) {
      function left(depth: number): number { return depth === 0 ? seed : right(depth - 1); }
      function right(depth: number): number { return left(depth); }
      const callback = () => ++seed;
      return callback;
    }
  `);
  assert.deepEqual(disconnected.select({ roots: [disconnected.owner,
    disconnected.declarations.get("left"), disconnected.declarations.get("right")] }), { storage: "location" });
});

test("native call argument evidence must prove ownership rather than an address-bearing or macro use", () => {
  const sourceCall = { kind: "source-call", operationId: "fixture.observe", target: { form: "function",
    fileName: "/project/index.ts", name: "observe", selectedTargetName: "observe" }, parameters: [], resultCarrier: scalarCarrier };
  for (const [mode, operation, storage] of [
    ["by-value", sourceCall, "cell"],
    ["borrow-shared", sourceCall, "location"],
    ["borrow-mut", sourceCall, "location"],
    [undefined, sourceCall, "location"],
    ["by-value", undefined, "location"],
    ["by-value", { kind: "provider-operation", operationId: "fixture.macro", abi: {
      operationKind: "method", sourceReceiver: { kind: "none" }, sourceArguments: [],
      targetReceiver: { kind: "none" }, targetArguments: [], targetGenericArguments: [], dispatchInputs: [],
      result: { kind: "sync", rawCarrier: scalarCarrier, carrier: scalarCarrier,
        conversion: { kind: "identity", sourceCarrier: scalarCarrier, targetCarrier: scalarCarrier, fallible: false } },
      effects: { evaluation: "observable", safety: "safe", invocation: "infallible", awaiting: "not-applicable", errorBoundary: "none" },
      target: { form: "expression-macro", path: "fixture_macro" },
    } }, "location"],
  ]) {
    const current = fixture(`
      function observe(value: number): number { return value; }
      export function outer(seed: number) {
        const callback = () => { seed += 1; return observe(seed); };
        return callback;
      }
    `);
    const argument = current.summary.uses.find(use => use.role === "argument")?.reference;
    assert.equal(argument !== undefined, true, "exact selected argument");
    if (mode !== undefined) current.records.argumentPassingPlans.pass(argument, mode);
    if (operation !== undefined)
      current.records.targetOperations.source(current.source.ast.parent(argument), operation);
    assert.deepEqual(current.select(), { storage });
  }
});

test("malformed, duplicate and oversized owner evidence cannot weaken the canonical guards", () => {
  const text = `
    export function outer(seed: number) {
      const callback = () => { seed = seed + 1; return seed; };
      return callback;
    }
  `;
  const inconsistent = fixture(text, { summary: summary => ({ ...summary, hasUnclassifiedValueUse: false }) });
  assert.deepEqual(inconsistent.select(), { storage: "location" });
  const exported = fixture(text, { summary: summary => ({ ...summary, exported: true }) });
  assert.deepEqual(exported.select(), { storage: "location" });
  const missing = fixture(text, { summary: summary => ({ ...summary, uses: [], hasUnclassifiedValueUse: false }) });
  assert.deepEqual(missing.select(), { storage: "location" });
  for (const roots of [owner => [], owner => [owner, owner],
    owner => Array.from({ length: 65_537 }, () => owner)]) {
    const current = fixture(text);
    assert.deepEqual(current.select({ roots: roots(current.owner) }), { storage: "location" });
  }
});

test("cached storage requires the exact source reference and a complete carrier", () => {
  const current = fixture(`
    export function outer(seed: string) {
      const callback = (suffix: string) => { seed = seed + suffix; return seed; };
      return callback;
    }
  `, { carrier: stringCarrier });
  assert.equal(current.select({ carrier: undefined }) === undefined, true, "incomplete evidence is not cached");
  assert.equal(current.walk.capturedBindingStorage.has(current.declaration), false);
  const selected = current.select();
  assert.deepEqual(selected, { storage: "borrow-cell" });
  const foreign = current.source.navigation.declarationUseSummary(current.declarations.get("suffix")).uses[0]?.reference;
  assert.equal(foreign !== undefined, true, "exact foreign parameter reference");
  assert.equal(current.select({ reference: foreign }) === undefined, true, "cached storage cannot bypass declaration identity");
  assert.equal(current.select({ carrier: undefined }) === undefined, true, "cached storage cannot replace carrier evidence");
  assert.equal(current.select() === selected, true, "complete native binding storage remains canonical");
});

test("an immutable tuple capture does not require Clone for an unread generic element", () => {
  const current = fixture(`
    export function outer<Outer>(value: Outer) {
      const seed: [Outer, boolean] = [value, true];
      const callback = () => seed[1];
      return callback;
    }
  `, { carrier: { kind: "tuple", elements: [
    { kind: "type-parameter", identity: "Outer", name: "Outer" },
    { kind: "source-primitive", name: "bool" },
  ] } });
  assert.deepEqual(current.select(), { storage: "value" });
});

test("native callable traits, existing shared locations and mutation facts retain their selected storage", () => {
  const text = `
    export function outer(seed: string) {
      const callback = (suffix: string) => { seed = seed + suffix; return seed; };
      return callback;
    }
  `;
  for (const nativeCallTrait of ["FnMut", "FnOnce"])
    assert.deepEqual(fixture(text, { carrier: stringCarrier }).select({ nativeCallTrait }), { storage: "value", mutable: true });
  assert.deepEqual(fixture(text, { carrier: stringCarrier }).select({ nativeCallTrait: "Fn" }), { storage: "borrow-cell" });
  assert.deepEqual(fixture(text, { carrier: stringCarrier }).select({ permitSingleOwner: false }), { storage: "location" });
  const shared = fixture(text, { carrier: stringCarrier });
  assert.equal(shared.records.bindingStoragePlans.requireLocation(shared.walk.context, shared.declaration, stringCarrier), true);
  assert.deepEqual(shared.select({ nativeCallTrait: "FnMut" }), { storage: "location" });
  const immutable = fixture(`
    export function outer(seed: number) {
      const callback = () => seed;
      return callback;
    }
  `);
  assert.deepEqual(immutable.select(), { storage: "value" });
  const mutated = fixture(`
    export function outer(seed: number) {
      const callback = () => seed;
      return callback;
    }
  `);
  mutated.records.mutatedBindings.written(mutated.declaration);
  assert.deepEqual(mutated.select(), { storage: "cell" });
});
