import assert from "node:assert/strict";
import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";
import test from "node:test";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRustErrorEffects } from "../../../helpers/rust-error-analysis.mjs";
import { rustAwaitSelectionLeaves } from "../../../../dist/target-model/types/await.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustJsValueTargetType } from "../../../../dist/target-model/types/carriers/js.js";
import { rustJsRejectionErrorIdentity } from "../../../../dist/target-model/records/errors/error-effects.js";

function fixture(text, surfaces = ["js"]) {
  const context = analyzeRustErrorEffects(text, { surfaces });
  const ast = context.ast;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  context.sourceFiles.forEach(visit);
  return { context, ast, nodes, records: context.records };
}

test("prepared callbacks and declaration or closure effects publish each positive subject once", () => {
  const counts = new Map();
  const context = analyzeRustErrorEffects(`
    export function fail(): void { throw new Error("original"); }
    export function register(): void {
      const callback = (): void => { throw new Error("original"); };
      setTimeout(fail, 0);
      setTimeout(callback, 0);
    }
  `, {}, current => ({ ...current, records: { ...current.records,
    fallibleSubjects: { ...current.records.fallibleSubjects, selected(subject) {
      counts.set(subject, (counts.get(subject) ?? 0) + 1);
      return current.records.fallibleSubjects.selected(subject);
    } },
  } }));
  const declared = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "fail");
  const closure = context.sourceStorage.nodes.find(node => context.ast.is.IsArrowFunction(node));
  assert.equal(declared !== undefined && closure !== undefined, true);
  assertRustRecordRequirement(context.requiredRecords, "fallible", declared);
  assertRustRecordRequirement(context.requiredRecords, "fallible", closure);
  assertRustRecordRequirement(context.requiredRecords, "errorEffects", declared);
  assertRustRecordRequirement(context.requiredRecords, "errorEffects", context.sourceFiles[0]);
  assert.equal(counts.get(declared), 1, "prepared named callback and declaration converge before publication");
  assert.equal(counts.get(closure), 1, "prepared lambda and closure analysis converge before publication");
  assert.equal([...counts.values()].every(count => count === 1), true);
  assert.equal(context.records.fallible.get(declared)?.fallible, true);
  assert.equal(context.records.fallible.get(closure)?.fallible, true);
});

test("native awaits publish exact value and source-error branches through the same selected producer", () => {
  const current = fixture(`
    import type { int32 } from "@tsonic/core/types.js";
    export async function source(value: int32): Promise<int32> { return value; }
    export async function consumer(value: int32): Promise<int32> { return await source(value); }
  `, []);
  const awaits = current.nodes.filter(node => current.ast.kindName(node) === "KindAwaitExpression");
  assert.equal(awaits.length, 1);
  const node = awaits[0];
  const value = current.records.awaitValue.get(node);
  const errors = current.records.awaitSourceErrorEffects.get(node);
  const operand = Node_Expression(current.ast, node);
  assert.equal(value !== undefined && errors !== undefined, true);
  assert.equal(value.resultCarrier.name, "int32");
  assert.equal(errors.branches.length, 1);
  assert.equal(rustAwaitSelectionLeaves(value.selection).some(leaf =>
    rustTargetTypeRefEquals(leaf.carrier, errors.branches[0].carrier)), true);
  assert.equal(current.records.futureValue.get(operand) !== undefined, true);
  assert.equal(errors.branches[0].edge.effects.localErrors, false);
  assert.equal(errors.branches[0].edge.effects.nativeErrors.length, 0);
  assert.equal(Object.isFrozen(errors) && Object.isFrozen(errors.branches), true);
});

for (const surface of ["native", "js"]) test(`aliased ${surface} futures preserve their exact selected rejection transport`, () => {
  const current = fixture(`
    export async function source(callback: () => Promise<number>) { return await callback(); }
    export async function consumer(callback: () => Promise<number>) {
      const pending = source(callback); const alias = pending; return await alias;
    }
  `, surface === "js" ? ["js"] : []);
  const consumer = current.nodes.find(node => current.ast.is.IsFunctionDeclaration(node) &&
    current.ast.text(current.ast.name(node)) === "consumer");
  const awaited = current.nodes.find(node => current.ast.kindName(node) === "KindAwaitExpression" &&
    sourceEnclosingCallable(node, current.ast) === consumer);
  assert.equal(consumer !== undefined && awaited !== undefined, true);
  const branches = current.records.awaitSourceErrorEffects.get(awaited).branches;
  const input = current.context.callableValues.native.inputsFor(consumer)[0];
  assert.equal(input !== undefined, true);
  if (surface === "native") {
    assert.equal(branches.length, 1);
    const route = branches[0].edge;
    assert.equal(route.effects.localErrors, false);
    assert.equal(route.nativeErrors.length, 2);
    assert.equal(route.effects.nativeErrors.every(error => error.errorType.owner.identity === input.implementation.identity), true);
    const routes = current.nodes.flatMap(node => current.records.sourceErrorEffects.get(node)?.edges ?? []);
    assert.equal(routes.some(edge => edge === route), true, "the exact native source-error edge remains canonical");
  } else {
    assert.equal(branches.length, 0, "F1/C01: a shared Promise boundary does not expose its producer's native error edges");
    const errors = current.records.errorEffects.get(awaited);
    assert.equal(errors.localErrors, false);
    assert.equal(errors.nativeErrors.length, 1, "one canonical JS rejection transport survives aliasing");
    assert.equal(errors.nativeErrors[0].identity, rustJsRejectionErrorIdentity);
    assert.equal(rustTargetTypeRefEquals(errors.nativeErrors[0].errorType, rustJsValueTargetType()), true,
      "the rejected value uses the canonical identity-preserving JS carrier");
    assert.equal(Object.isFrozen(errors) && Object.isFrozen(errors.nativeErrors), true);
  }
  const alias = Node_Expression(current.ast, awaited);
  assert.equal(current.records.futureValue.get(alias) !== undefined, true);
  assert.equal(current.records.fallible.get(consumer)?.fallible, true);
});

test("native abstract calls publish the exact pre-selected invocation errors before source forwarding", () => {
  const current = fixture(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(left: () => number, right: () => number): number { return invoke(left) + invoke(right); }
  `);
  const calls = current.context.callableValues.native.calls;
  assert.equal(calls.length, 1);
  const input = calls[0];
  const fact = current.records.sourceCallEffects.get(input.node);
  assert.equal(fact.invocation, "fallible");
  assert.equal(fact.awaiting, "not-applicable");
  assert.equal(fact.nativeInput.invocationError === input.invocationError, true);
  assert.equal(fact.nativeInput.invocationErrorSource, input.invocationErrorSource);
  assert.equal(fact.nativeInput.awaitErrors === input.awaitErrors, true);
  assert.equal(fact.nativeInput.awaitErrorSources === input.awaitErrorSources, true);
  const forwarded = current.nodes.filter(node => current.ast.is.IsCallExpression(node) &&
    current.ast.text(Node_Expression(current.ast, node)) === "invoke");
  assert.equal(forwarded.length, 2);
  for (const node of forwarded) {
    for (const family of ["sourceCallEffects", "sourceErrorEffects", "errorEffects"]) {
      assertRustRecordRequirement(current.context.requiredRecords, family, node);
    }
  }
  const callback = current.nodes.find(node => current.ast.is.IsCallExpression(node) && current.ast.text(Node_Expression(current.ast, node)) === "callback");
  const invoke = current.nodes.find(node => current.ast.is.IsFunctionDeclaration(node) && current.ast.text(current.ast.name(node)) === "invoke");
  assertRustRecordRequirement(current.context.requiredRecords, "sourceCallEffects", callback);
  assertRustRecordRequirement(current.context.requiredRecords, "sourceCallEffects", invoke);
  assert.equal(forwarded.every(node => current.records.sourceErrorEffects.get(node)?.edges.length === 1), true);
  assert.equal(forwarded.every(node => current.records.errorEffects.get(node)?.nativeErrors.length === 1), true);
});

for (const surfaces of [[], ["js"]]) test(`resource selection retains checked disposer identity on ${surfaces.length === 0 ? "native" : "JS"}`, () => {
  const current = fixture(`
    export class Resource { constructor() {} [Symbol.dispose](): void {} }
    export function use(): void { using resource = new Resource(); }
  `, surfaces);
  const declaration = current.nodes.find(node => current.ast.is.IsVariableDeclaration(node) &&
    current.ast.variableDeclarationKind(node) === "using");
  const disposer = current.nodes.find(node => current.ast.is.IsMethodDeclaration(node));
  assert.equal(declaration !== undefined && disposer !== undefined, true);
  assertRustRecordRequirement(current.context.requiredRecords, "resourceManagement", declaration);
  const selected = current.records.resourceManagement.get(declaration);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.declarationKind, "using");
  assert.equal(selected.disposal.kind, "sync");
  assert.equal(selected.disposal.fallible, false);
  assert.equal(selected.disposal.target.errorBoundary, "none");
  assert.equal(selected.disposal.target.form, "source-method");
  assert.equal(selected.disposal.target.name, "dispose");
  const uses = current.context.generatedDeclarationUses.seal();
  assert.equal(uses.some(use => use.reference === declaration && use.declaration === disposer), true);
  const checked = current.context.semanticsFor(declaration).operations.resourceManagement(declaration);
  assert.equal(checked !== undefined, true);
  assert.equal(checked.disposal.alternatives[0].selectedDeclaration === disposer, true);
});

test("accessor effects keep selected read and write effects separate without duplicating declaration decisions", () => {
  const current = fixture(`
    export class Value {
      stored: number = 1;
      get value(): number { return this.stored; }
      set value(value: number) { if (value < 0) throw new Error("negative"); this.stored = value; }
    }
    export function use(value: Value): number { value.value = 2; return value.value; }
  `);
  const accessors = current.nodes.filter(node => current.records.sourceAccessorEffects.get(node) !== undefined);
  assert.equal(accessors.length, 2);
  const effects = accessors.map(node => current.records.sourceAccessorEffects.get(node));
  assert.equal(effects.some(fact => fact.read === "infallible"), true);
  assert.equal(effects.some(fact => fact.write === "fallible"), true);
  const setter = current.nodes.find(node => current.ast.kindName(node) === "KindSetAccessor");
  const use = current.nodes.find(node => current.ast.is.IsFunctionDeclaration(node) && current.ast.text(current.ast.name(node)) === "use");
  const expectedAccesses = current.nodes.filter(node => current.ast.is.IsPropertyAccessExpression(node) &&
    current.ast.text(current.ast.name(node)) === "value" && sourceEnclosingCallable(node, current.ast) === use);
  assert.equal(expectedAccesses.length, 2);
  for (const access of expectedAccesses) assertRustRecordRequirement(current.context.requiredRecords, "sourceAccessorEffects", access);
  assertRustRecordRequirement(current.context.requiredRecords, "errorEffects", setter);
  assertRustRecordRequirement(current.context.requiredRecords, "fallible", setter);
  assert.equal(setter !== undefined, true);
  assert.equal(current.records.errorEffects.get(setter).localErrors, true);
  assert.equal(current.records.fallible.get(setter)?.fallible, true);
});

for (const surface of ["native", "js"]) test(`deferred generic ${surface} completion preserves its exact rejection ABI and frozen channels`, () => {
  const current = fixture(`
    export function retain<Value>(callback: () => Promise<Value>) { return callback(); }
    export function forward<Other>(callback: () => Promise<Other>) { return retain(callback); }
    export function concrete(callback: () => Promise<string>) { return forward(callback); }
  `, surface === "js" ? ["js"] : []);
  const declarations = current.nodes.filter(node => current.ast.is.IsFunctionDeclaration(node));
  assert.equal(declarations.length, 3);
  for (const declaration of declarations) {
    assertRustRecordRequirement(current.context.requiredRecords, "deferredProducerEffects", declaration);
    const input = current.context.callableValues.native.inputsFor(declaration)[0];
    const fact = current.records.deferredProducerEffects.get(declaration);
    assert.equal(input !== undefined && fact !== undefined, true);
    assert.equal(fact.kind, "futures");
    assert.equal(fact.channels.length, 1);
    assert.equal(fact.channels[0].awaiting, "fallible");
    if (surface === "native") {
      assert.equal(fact.channels[0].errorCarrier.kind, "associated-type");
      assert.equal(fact.channels[0].errorCarrier.owner.identity, input.implementation.identity);
    } else {
      assert.equal(rustTargetTypeRefEquals(fact.channels[0].errorCarrier, rustJsValueTargetType()), true,
        "F1/C01: the shared JS Promise transports one rejection type, not a callback-specific native projection");
    }
    assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.channels) && Object.isFrozen(fact.channels[0]), true);
  }
});

test("a selected first-class generic value publishes its actual physical invocation before error finalization", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function choose(flag: boolean): Identity {
      return flag ? <Value>(value: Value): Value => value : <Value>(value: Value): Value => value;
    }
    export function run(): number { const selected = choose(true); return selected<number>(7); }
  `, []);
  const selected = current.nodes.filter(node => current.records.genericCallableInvocation.get(node) !== undefined);
  const expectedCall = current.nodes.find(node => current.ast.is.IsCallExpression(node) && current.ast.text(Node_Expression(current.ast, node)) === "selected");
  for (const family of ["genericCallableInvocation", "sourceCallEffects", "errorEffects"]) {
    assertRustRecordRequirement(current.context.requiredRecords, family, expectedCall);
  }
  assert.equal(current.context.requiredRecords.some(row => row.family === "sourceErrorEffects" && row.subject === expectedCall), false);
  assert.equal(selected.length, 1);
  const node = selected[0];
  const invocation = current.records.genericCallableInvocation.get(node);
  assert.equal(invocation.effects.invocation, "infallible");
  assert.equal(invocation.effects.awaiting, "not-applicable");
  assert.equal(invocation.invocation.length, 0);
  assert.equal(invocation.awaiting.length, 0);
  assert.equal(current.context.callableValues.generic.physical.definitionFor(invocation.carrier) !== undefined, true);
  assert.equal(current.records.targetOperation.get(node).kind, "source-call");
  assert.equal(current.records.sourceCallEffects.get(node).invocation, "infallible");
  assert.equal(current.records.errorEffects.get(node).localErrors, false);
  assert.equal(current.records.errorEffects.get(node).nativeErrors.length, 0);
  assert.equal(Object.isFrozen(invocation) && Object.isFrozen(invocation.invocation) && Object.isFrozen(invocation.awaiting), true);
});
