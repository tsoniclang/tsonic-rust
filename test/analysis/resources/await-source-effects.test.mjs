import assert from "node:assert/strict";
import test from "node:test";
import { sourceEnclosingCallable, Node_Expression } from "@tsonic/target-api/source";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";




import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustAwaitSelectionLeaves } from "../../../dist/target-model/types/await.js";
import { rustErrorEffectsEqual } from "../../../dist/analysis/errors/error-effects.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { selectRustAwaitSourceErrors } from "../../../dist/analysis/resources/await-source-effects.js";
import { createRustSourceErrorEffectSelection } from "../../../dist/analysis/resources/source-error-effects.js";
import { createRustEffectsWorkBudget } from "../../../dist/analysis/resources/effects-work-budget.js";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";
import { asyncCallableInterfaceFiles } from "../../../../tsonic/test/fixtures/callable-interfaces.mjs";

function fixture(text, options) {
  const context = analyzeRustErrorEffects(text, options);
  const ast = context.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  context.sourceFiles.forEach(visit);
  const declaration = name => {
    const selected = nodes.filter(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
    assert.equal(selected.length, 1, name);
    return selected[0];
  };
  const awaited = name => {
    const owner = declaration(name);
    const matches = nodes.filter(node => ast.kindName(node) === "KindAwaitExpression" && sourceEnclosingCallable(node, ast) === owner);
    assert.equal(matches.length, 1, name);
    return matches[0];
  };
  const fact = name => {
    const selected = context.records.awaitSourceErrorEffects.get(awaited(name));
    assert.equal(selected !== undefined, true, `exact await edge: ${name}`);
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.branches), true);
    return selected;
  };
  return { context, ast, nodes, declaration, awaited, fact };
}

test("await branches retain the exact original source edge instead of adding an ambient local channel", () => {
  const current = fixture(`
    export async function source(callback: () => Promise<number>) { return await callback(); }
    export async function consumer(callback: () => Promise<number>) {
      const pending = source(callback); const alias = pending; return await alias;
    }
  `);
  const fact = current.fact("consumer");
  assert.equal(fact.branches.length, 1);
  const { carrier, edge } = fact.branches[0];
  assert.equal(Object.isFrozen(fact.branches[0]) && Object.isFrozen(edge), true);
  assert.equal(edge.declaration === current.declaration("source"), true);
  assert.equal(edge.kind, "await");
  assert.equal(edge.effects.localErrors, false);
  assert.equal(edge.nativeErrors.length, 2);
  const input = current.context.callableValues.native.inputsFor(current.declaration("consumer"))[0];
  assert.equal(edge.effects.nativeErrors.every(error => error.errorType.owner.identity === input.implementation.identity), true);
  const value = current.context.records.awaitValue.get(current.awaited("consumer"));
  assert.equal(rustAwaitSelectionLeaves(value.selection).some(leaf => rustTargetTypeRefEquals(leaf.carrier, carrier)), true);
  const calls = current.nodes.filter(node => current.ast.is.IsCallExpression(node));
  const original = calls.map(call => current.context.records.sourceErrorEffects.get(call))
    .flatMap(fact => fact?.edges ?? []).find(candidate => candidate === edge);
  assert.equal(original === edge, true, "the await fact reuses the actual selected source edge");
  assert.equal(rustErrorEffectsEqual(current.context.records.errorEffects.get(current.awaited("consumer")), edge.effects), true);
});

test("stored async source results preserve original generic channels through synchronous return activations", () => {
  const current = fixture(`
    export async function source<Value>(callback: () => Promise<Value>) { return await callback(); }
    export function retain<Other>(callback: () => Promise<Other>) { return source(callback); }
    export async function consumer<Actual>(callback: () => Promise<Actual>) { return await retain(callback); }
  `);
  const edge = current.fact("consumer").branches[0].edge;
  assert.equal(edge.declaration === current.declaration("source"), true);
  assert.equal(edge.effects.localErrors, false);
  const input = current.context.callableValues.native.inputsFor(current.declaration("consumer"))[0];
  const sourceEffects = current.context.records.errorEffects.get(current.declaration("source"));
  assert.equal(edge.nativeErrors.length, sourceEffects.nativeErrors.length);
  for (const route of edge.nativeErrors) {
    assert.equal(sourceEffects.nativeErrors.some(source => source.identity === route.source.identity), true);
    assert.equal(route.target.errorType.owner.identity, input.implementation.identity);
    assert.equal(route.target.errorType.trait.id, route.source.errorType.trait.id);
  }
});

test("stored source awaits rebind the original activation without overwriting the producer's lexical call facts", () => {
  const current = fixture(`
    export async function source(callback: () => Promise<number>) { return await callback(); }
    export function retain(callback: () => Promise<number>) { return source(callback); }
    export async function consumer(callback: () => Promise<number>) { return await retain(callback); }
  `);
  const edge = current.fact("consumer").branches[0].edge;
  assert.equal(edge.declaration === current.declaration("source"), true);
  const input = current.context.callableValues.native.inputsFor(current.declaration("consumer"))[0];
  assert.equal(edge.nativeErrors.length, 2);
  assert.equal(edge.nativeErrors.every(route => route.target.errorType.owner.identity === input.implementation.identity), true);
  const original = current.nodes.find(node => current.ast.is.IsCallExpression(node) &&
    current.ast.text(Node_Expression(current.ast, node)) === "source");
  const originalEdges = current.context.records.sourceErrorEffects.get(original)?.edges ?? [];
  assert.equal(originalEdges.some(candidate => candidate.nativeErrors.some(route =>
    route.target.errorType.owner?.identity === input.implementation.identity)), false,
  "the retained call's physical input cannot be replaced by its receiving consumer's unrelated input binder");
});

test("await-source selection rejects an unrelated exact Future branch", () => {
  const current = fixture(`
    export async function pure(): Promise<number> { return 7; }
    export async function consumer(): Promise<number> { return await pure(); }
  `);
  const operand = Node_Expression(current.ast, current.awaited("consumer"));
  const channel = current.fact("consumer").branches[0];
  const walk = { context: current.context };
  const select = branches => {
    let result;
    const budget = createRustEffectsWorkBudget();
    const failure = budget.run(() => {
      result = selectRustAwaitSourceErrors(walk, operand, branches,
        declaration => current.context.records.errorEffects.get(declaration),
        createRustSourceErrorEffectSelection(walk), budget);
    });
    assert.equal(failure === undefined, true);
    return result;
  };
  assert.equal(select([channel.carrier])?.length, 1);
  const unrelated = { ...channel.carrier, genericArguments: channel.carrier.genericArguments.map((argument, index) =>
    index === 1 ? { kind: "type", type: rustSourcePrimitiveTargetType("bool") } : argument) };
  assert.equal(select([unrelated]) === undefined, true, "source error correspondence cannot attach to a different carrier");
});

test("pure source awaits stay pure while caught source errors retain inner correspondence", () => {
  const current = fixture(`
    export async function pure(): Promise<number> { return 7; }
    export async function success(): Promise<number> { return await pure(); }
    export async function failure(callback: () => Promise<number>) { return await callback(); }
    export async function caught(callback: () => Promise<number>): Promise<number> {
      try { return await failure(callback); } catch { return 0; }
    }
  `);
  const success = current.fact("success");
  assert.equal(success.branches.length, 1);
  assert.deepEqual(success.branches[0].edge.effects, { localErrors: false, nativeErrors: [] });
  assert.equal(current.fact("caught").branches[0].edge.nativeErrors.length, 2);
  assert.deepEqual(current.context.records.errorEffects.get(current.declaration("caught")),
    { localErrors: false, nativeErrors: [] });
  assert.equal(current.context.records.errorEffects.get(current.awaited("caught")).nativeErrors.length, 2);
});

test("awaiting a source package Future retains its actual RootFailure owner", () => {
  const files = { ...sourcePackageCallbackErrorFiles,
    "node_modules/@acme/forward/index.ts": sourcePackageCallbackErrorFiles["node_modules/@acme/forward/index.ts"] + `
      export function deferred(callback: () => Promise<number>) { return callback(); }
    `,
    "index.ts": sourcePackageCallbackErrorFiles["index.ts"] + `
      import { deferred } from "@acme/forward";
      export class RootFailure extends Error { code = 9; }
      export async function rootFailure(): Promise<number> { throw new RootFailure("root"); }
      export async function rootConsumer(): Promise<number> {
        const pending = deferred(rootFailure); return await pending;
      }
    `,
  };
  const current = fixture("", { files, sourcePackages: sourcePackageCallbackErrorGraph });
  assert.equal(current.fact("rootConsumer").branches.length, 0,
    "a callback input remains its selected native channel rather than acquiring a guessed source-program edge");
  const value = current.context.records.awaitValue.get(current.awaited("rootConsumer"));
  const future = rustAwaitSelectionLeaves(value.selection)[0].future;
  assert.equal(future.errorBoundary, "source-native");
  const reference = rustProducerErrorReference(future.errorCarrier);
  assert.equal(reference !== undefined, true);
  const producer = current.context.callableValues.nativeProducers.forDeclaration(current.declaration("rootFailure"));
  assert.equal(reference.identity, producer.identity);
  assert.equal(reference.channel, 0);
  const effects = current.context.records.errorEffects.get(current.awaited("rootConsumer"));
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 1);
  assert.equal(effects.nativeErrors[0].identity, future.errorSource);
  assert.equal(rustTargetTypeRefEquals(effects.nativeErrors[0].errorType, future.errorCarrier), true);
});

test("direct native callback awaits keep native identities and do not manufacture source-package edges", () => {
  const current = fixture(`
    export async function consumer(callback: () => Promise<number>) { return await callback(); }
  `);
  assert.equal(current.fact("consumer").branches.length, 0);
  const native = current.context.callableValues.native.calls[0];
  const effects = current.context.records.errorEffects.get(current.awaited("consumer"));
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 1);
  assert.equal(effects.nativeErrors[0].identity, native.awaitErrorSources[0]);
});

for (const surfaces of [[], ["js"]]) {
  test(`the original async callable-interface fixture retains exact await errors on ${surfaces[0] ?? "native"}`, () => {
    const current = fixture("", { files: asyncCallableInterfaceFiles, surfaces });
    const awaited = current.nodes.filter(node => current.ast.kindName(node) === "KindAwaitExpression");
    assert.equal(awaited.length > 0, true);
    for (const expression of awaited) {
      assert.equal(current.context.records.awaitSourceErrorEffects.get(expression) !== undefined, true,
        "every original await has an exact source-edge selection, possibly the empty native-input set");
      assert.equal(current.context.records.awaitValue.get(expression) !== undefined, true,
        "the full physical await contract remains required");
    }
  });
}
