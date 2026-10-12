import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustErrorEffectsFactKey, rustFallibleFactKey, rustSourceErrorEffectsFactKey,
  rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { Node_Expression, Node_Initializer, TryStatement_TryBlock, TryStatement_CatchClause,
  CatchClause_Block, TryStatement_FinallyBlock } from "@tsonic/target-api/source";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";

function fixture(text, options = {}) {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": text }, ...options });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const declaration = name => {
    const selected = nodes.filter(node => (ast.is.IsFunctionDeclaration(node) || ast.is.IsVariableDeclaration(node)) &&
      ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
    assert.equal(selected.length, 1, name);
    return selected[0];
  };
  const effects = node => {
    const value = program.facts.getFact(node, rustErrorEffectsFactKey);
    assert.equal(value !== undefined, true, "exact effects are total on the selected evaluation region");
    assert.equal(Object.isFrozen(value) && Object.isFrozen(value.nativeErrors), true);
    return value;
  };
  return { program, ast, nodes, declaration, effects,
    initializer: name => Node_Initializer(ast, declaration(name)),
    callable: name => effects(declaration(name)),
    calls: name => nodes.filter(node => ast.is.IsCallExpression(node) && ast.text(Node_Expression(ast, node)) === name) };
}

function assertChannels(actual, expected, localErrors = false) {
  assert.equal(actual.localErrors, localErrors, "local package channel remains separate");
  assert.equal(actual.nativeErrors.length, expected.length, "exact native channel count");
  for (const selected of expected) {
    const source = actual.nativeErrors.find(source => source.identity === selected.identity);
    assert.equal(source !== undefined, true, "exact native channel identity");
    assert.equal(rustTargetTypeRefEquals(source.errorType, selected.errorType), true, "exact native channel carrier");
  }
}

test("pure source bodies stay pure while abstract input invocation carries its exact native error", () => {
  const current = fixture(`
    export function pure(): number { return 7; }
    export function invoke(callback: () => number): number { return callback(); }
    export function local(): number { throw new Error("local"); }
  `);
  assertChannels(current.callable("pure"), []);
  assertChannels(current.callable("local"), [], true);
  const native = current.program.callableValues.native.callFor(current.calls("callback")[0]);
  const expected = [{ identity: native.invocationErrorSource, errorType: native.invocationError }];
  assertChannels(current.callable("invoke"), expected);
  assertChannels(current.effects(current.calls("callback")[0]), expected);
  assert.equal(current.program.facts.getFact(current.declaration("pure"), rustFallibleFactKey) === undefined, true);
  assert.equal(current.program.facts.getFact(current.declaration("invoke"), rustFallibleFactKey) !== undefined, true);
});

test("two callbacks retain independent invocation and await errors alongside a local throw", () => {
  const current = fixture(`
    export async function pair(left: () => Promise<number>, right: () => Promise<number>, fail: boolean): Promise<number> {
      const first = left(); const second = right();
      const total = await first + await second;
      if (fail) throw new Error("local");
      return total;
    }
  `);
  const expected = current.program.callableValues.native.calls.flatMap(call => [
    { identity: call.invocationErrorSource, errorType: call.invocationError },
    ...call.awaitErrors.map((errorType, index) => ({ identity: call.awaitErrorSources[index], errorType })),
  ]);
  assert.equal(expected.length, 4);
  assertChannels(current.callable("pair"), expected, true);
  for (const name of ["left", "right"]) {
    const call = current.calls(name)[0];
    const native = current.program.callableValues.native.callFor(call);
    assertChannels(current.effects(call), [{ identity: native.invocationErrorSource, errorType: native.invocationError }]);
  }
});

test("catch suppresses escaping native errors without losing try and finally region evidence", () => {
  const current = fixture(`
    export async function caught(left: () => Promise<number>, right: () => Promise<number>): Promise<number> {
      try { return await left(); } catch { return 0; } finally { await right(); }
    }
  `);
  const statement = current.nodes.find(node => current.ast.kindName(node) === "KindTryStatement");
  const native = name => current.program.callableValues.native.callFor(current.calls(name)[0]);
  const channels = call => [{ identity: call.invocationErrorSource, errorType: call.invocationError },
    { identity: call.awaitErrorSources[0], errorType: call.awaitErrors[0] }];
  assertChannels(current.effects(TryStatement_TryBlock(current.ast, statement)), channels(native("left")));
  assertChannels(current.effects(CatchClause_Block(current.ast, TryStatement_CatchClause(current.ast, statement))), []);
  assertChannels(current.effects(TryStatement_FinallyBlock(current.ast, statement)), channels(native("right")));
  assertChannels(current.callable("caught"), channels(native("right")));
});

test("nested source functions propagate captures only when invoked", () => {
  const current = fixture(`
    export function dormant(callback: () => number): number {
      function hidden(): number { return callback(); } return 1;
    }
    export function active(callback: () => number): number {
      function inner(): number { return callback(); } return inner();
    }
  `);
  assertChannels(current.callable("dormant"), []);
  assert.equal(current.callable("hidden").nativeErrors.length, 1);
  assertChannels(current.callable("active"), current.callable("inner").nativeErrors);
});

test("call edges rebind two same-signature formals to physical caller inputs without rebranding the callee trait", () => {
  const current = fixture(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(left: () => number, right: () => number): number {
      const first = invoke(left); const second = invoke(right); return first + second;
    }
  `);
  const source = current.callable("invoke").nativeErrors[0];
  const inputs = current.program.callableValues.native.inputsFor(current.declaration("forward"));
  const expected = [];
  for (const [index, name] of ["first", "second"].entries()) {
    const call = current.initializer(name);
    const selected = current.program.facts.getFact(call, rustSourceErrorEffectsFactKey);
    assert.equal(selected?.edges.length, 1);
    const edge = selected.edges[0];
    assert.equal(edge.declaration === current.declaration("invoke"), true);
    assert.equal(edge.kind, "invoke");
    assert.equal(edge.nativeErrors.length, 1);
    const route = edge.nativeErrors[0];
    assert.equal(route.source.identity, source.identity);
    assert.equal(route.target.errorType.kind, "associated-type");
    assert.equal(route.target.errorType.owner.identity, inputs[index].implementation.identity);
    assert.equal(route.target.errorType.trait.id, source.errorType.trait.id);
    assert.notEqual(route.target.errorType.trait.id, inputs[index].protocol.trait.id);
    assertChannels(current.effects(call), [route.target]);
    expected.push(route.target);
  }
  assert.notEqual(expected[0].identity, expected[1].identity);
  assertChannels(current.callable("forward"), expected);
});

test("source async invocation remains pure while exact rebound errors belong to awaiting", () => {
  const current = fixture(`
    export async function invoke(callback: () => Promise<number>): Promise<number> { return await callback(); }
    export async function forward(callback: () => Promise<number>): Promise<number> {
      const pending = invoke(callback); return await pending;
    }
  `);
  const call = current.initializer("pending");
  assertChannels(current.effects(call), []);
  const selected = current.program.facts.getFact(call, rustSourceErrorEffectsFactKey);
  const awaited = selected?.edges.find(edge => edge.kind === "await");
  assert.equal(awaited !== undefined, true);
  assert.equal(awaited.effects.nativeErrors.length, 2);
  assertChannels(current.callable("forward"), awaited.effects.nativeErrors);
});

test("selected source generic arguments substitute callee protocol environments at the error owner", () => {
  const current = fixture(`
    export function invoke<Value>(callback: () => Value): Value { return callback(); }
    export function forward(callback: () => number): number { const output = invoke(callback); return output; }
  `);
  const call = current.initializer("output");
  const edge = current.program.facts.getFact(call, rustSourceErrorEffectsFactKey).edges[0];
  const source = edge.nativeErrors[0].source;
  const target = edge.nativeErrors[0].target;
  assert.equal(source.errorType.trait.id, target.errorType.trait.id);
  assert.equal(source.errorType.trait.genericArguments.length, 1);
  assert.equal(target.errorType.trait.genericArguments.length, 1);
  assert.equal(rustTargetTypeRefEquals(source.errorType.trait.genericArguments[0].type,
    target.errorType.trait.genericArguments[0].type), false);
  const operation = current.program.facts.getFact(call, rustTargetOperationFactKey);
  assert.equal(rustTargetTypeRefEquals(target.errorType.trait.genericArguments[0].type, operation.resultCarrier), true);
  assertChannels(current.callable("forward"), [target]);
});

test("distinct callee formal channels survive forwarding the same actual callback twice", () => {
  const current = fixture(`
    export function pair(left: () => number, right: () => number): number { return left() + right(); }
    export function forward(callback: () => number): number { const output = pair(callback, callback); return output; }
  `);
  const edge = current.program.facts.getFact(current.initializer("output"), rustSourceErrorEffectsFactKey).edges[0];
  assert.equal(edge.nativeErrors.length, 2);
  const first = edge.nativeErrors[0];
  const second = edge.nativeErrors[1];
  assert.notEqual(first.source.identity, second.source.identity);
  assert.notEqual(first.target.identity, second.target.identity);
  assert.equal(first.target.errorType.owner.identity, second.target.errorType.owner.identity);
  assertChannels(current.callable("forward"), [first.target, second.target]);
});

test("recursive forwarding converges to one exact source channel rather than accumulating call path identities", () => {
  const current = fixture(`
    export function recurse(callback: () => number, depth: number): number {
      if (depth <= 0) return callback();
      return recurse(callback, depth - 1);
    }
  `);
  const effects = current.callable("recurse");
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 1);
  assertChannels(current.effects(current.calls("recurse")[0]), effects.nativeErrors);
});

test("deferred expression body aggregates argument errors but invocation fact excludes eager argument evaluation", () => {
  const current = fixture(`
    export function fail(): number { throw new Error("argument"); }
    export function make(callback: (value: number) => number): () => number {
      const invoke = (): number => callback(fail()); return invoke;
    }
  `);
  const lambda = current.initializer("invoke");
  const declaration = current.effects(lambda);
  assert.equal(declaration.localErrors, true);
  assert.equal(declaration.nativeErrors.length, 1);
  assertChannels(current.effects(current.calls("callback")[0]), declaration.nativeErrors);
  assertChannels(current.callable("make"), []);
});

test("production package forwarding preserves errors independently of an unrelated root Error subclass", () => {
  for (const extra of ["", "export class RootFailure extends Error { code = 11; }"]) {
    const source = `
      import { forwarded, consume } from "@acme/forward";
      ${extra}
      export function pair(left: () => number, right: () => number): number {
        const first = forwarded(left); const second = forwarded(right);
        return consume(first) + consume(second);
      }
    `;
    const current = fixture(source, { sourcePackages: sourcePackageCallbackErrorGraph,
      files: { ...sourcePackageCallbackErrorFiles, "index.ts": source } });
    assertChannels(current.callable("retain"), []);
    assertChannels(current.callable("forwarded"), []);
    const invoke = current.callable("invoke");
    const consume = current.callable("consume");
    const pair = current.callable("pair");
    assert.equal(invoke.localErrors || consume.localErrors || pair.localErrors, false);
    assert.equal(invoke.nativeErrors.length, 1);
    assert.equal(consume.nativeErrors.length, 1);
    assert.equal(pair.nativeErrors.length, 2);
    for (const effect of pair.nativeErrors) assert.equal(effect.errorType.trait.id, invoke.nativeErrors[0].errorType.trait.id);
    assert.equal(pair.nativeErrors[0].identity !== pair.nativeErrors[1].identity, true);
  }
});
