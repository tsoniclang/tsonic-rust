import assert from "node:assert/strict";
import test from "node:test";
import { sourceEnclosingCallable, Node_Expression } from "@tsonic/target-api/source";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { acmeDbPackage } from "../../helpers/rust-session.mjs";




import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustAwaitSelectionLeaves } from "../../../dist/target-model/types/await.js";
import { mergeRustErrorEffects, rustErrorEffectsEqual } from "../../../dist/analysis/errors/error-effects.js";
import { rustJsRejectionErrorIdentity } from "../../../dist/target-model/records/errors/error-effects.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { isRustNativeFutureCarrier, rustFutureTargetType, rustJsPromiseTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustAwaitSourceErrors } from "../../../dist/analysis/errors/await-source-effects.js";
import { createRustSourceErrorEffectSelection } from "../../../dist/analysis/errors/source-error-effects.js";
import { createRustEffectsWorkBudget } from "../../../dist/analysis/errors/effects-work-budget.js";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";
import { asyncCallableInterfaceFiles } from "../../../../tsonic/test/fixtures/callable-interfaces.mjs";
import { nativeAsyncCallableFiles } from "../../../../tsonic/test/fixtures/callable-interfaces.mjs";
import { finiteCompletionSequencingSource } from "../../../../tsonic/test/fixtures/finite-completion-sequencing.mjs";

function fixture(text, options = {}) {
  const context = analyzeRustErrorEffects(text, { surfaces: [], ...options });
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

const sourceAwaitProgram = `
    export async function source(callback: () => Promise<number>) { return await callback(); }
    export async function consumer(callback: () => Promise<number>) {
      const pending = source(callback); const alias = pending; return await alias;
    }
  `;

const genericReturnProgram = `
    export async function source<Value>(callback: () => Promise<Value>) { return await callback(); }
    export function retain<Other>(callback: () => Promise<Other>) { return source(callback); }
    export async function consumer<Actual>(callback: () => Promise<Actual>) { return await retain(callback); }
  `;

const lexicalReturnProgram = `
    export async function source(callback: () => Promise<number>) { return await callback(); }
    export function retain(callback: () => Promise<number>) { return source(callback); }
    export async function consumer(callback: () => Promise<number>) { return await retain(callback); }
  `;

const rootFailureFiles = { ...sourcePackageCallbackErrorFiles,
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

const nativeFutureFiles = { ...nativeAsyncCallableFiles,
  "index.ts": nativeAsyncCallableFiles["index.ts"] +
    '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("native callable ownership"); }\nawait main();\n',
};

function requireNativeFuture(current, name, boundary) {
  const value = current.context.records.awaitValue.get(current.awaited(name));
  assert.equal(value !== undefined, true, name + ": the complete physical await is published");
  const leaves = rustAwaitSelectionLeaves(value.selection);
  assert.equal(leaves.length, 1, name + ": the witness has one actual pending native Future");
  assert.equal(isRustNativeFutureCarrier(leaves[0].carrier), true, name + ": the selected physical carrier is the canonical native Future");
  assert.equal(leaves[0].future?.errorBoundary, boundary, name + ": the exact admitted native error boundary is retained");
  return leaves[0];
}

function assertPureNativeAwait(current, name, producer) {
  const leaf = requireNativeFuture(current, name, "none");
  const value = current.context.records.awaitValue.get(current.awaited(name));
  assert.equal(rustTargetTypeRefEquals(leaf.future.outputCarrier, value.resultCarrier), true,
    "the native async body preserves its exact output carrier");
  const source = current.fact(name);
  assert.equal(source.branches.length, 1, "a native async declaration retains its original pending Future edge");
  assert.equal(source.branches[0].edge.declaration === current.declaration(producer), true);
  assert.equal(rustTargetTypeRefEquals(source.branches[0].carrier, leaf.carrier), true);
  assert.deepEqual(source.branches[0].edge.effects, { localErrors: false, nativeErrors: [] });
  assert.deepEqual(current.context.records.errorEffects.get(current.awaited(name)),
    { localErrors: false, nativeErrors: [] });
}

function assertCompletedValueAwait(current, name) {
  const value = current.context.records.awaitValue.get(current.awaited(name));
  assert.equal(value !== undefined, true, "the actual completed primitive await is published");
  const leaves = rustAwaitSelectionLeaves(value.selection);
  assert.equal(leaves.length === 1 && leaves[0].future === undefined &&
    rustTargetTypeRefEquals(leaves[0].carrier, value.resultCarrier), true,
  "an already-completed primitive is never fabricated into a pending Future");
  assert.equal(current.fact(name).branches.length, 0);
  assert.deepEqual(current.context.records.errorEffects.get(current.awaited(name)),
    { localErrors: false, nativeErrors: [] });
}

function assertUniformJsAwait(current, name) {
  const expression = current.awaited(name);
  const operand = Node_Expression(current.ast, expression);
  const value = current.context.records.awaitValue.get(expression);
  assert.equal(operand !== undefined && value !== undefined, true, "the original checked Promise operand is retained");
  const leaves = rustAwaitSelectionLeaves(value.selection);
  assert.equal(leaves.length, 1, "the original Promise object has one physical await branch");
  const leaf = leaves[0];
  assert.equal(leaf.future?.errorBoundary, "js-rejection");
  assert.equal(rustTargetTypeRefEquals(leaf.carrier, rustJsPromiseTargetType(leaf.future.outputCarrier)), true,
    "the full selected JsPromise payload and native identity remain exact");
  assert.equal(rustTargetTypeRefEquals(value.operandCarrier, leaf.carrier), true,
    "no producer-specific Future replaces the actual Promise object");
  assert.equal(current.fact(name).branches.length, 0, "uniform JS rejection does not manufacture a source-native edge");
  const operandEffects = current.context.records.errorEffects.get(operand);
  const rejection = { localErrors: false,
    nativeErrors: [{ identity: rustJsRejectionErrorIdentity, errorType: rustJsValueTargetType() }] };
  let expected;
  if (current.ast.is.IsIdentifier(operand)) {
    assert.equal(operandEffects === undefined, true, "a bare local reference has no operation-effect record");
    expected = rejection;
  } else {
    assert.equal(operandEffects !== undefined, true, "the eager operation retains its own selected effects");
    expected = mergeRustErrorEffects([operandEffects, rejection]);
  }
  const actual = current.context.records.errorEffects.get(expression);
  assert.equal(expected !== undefined && actual !== undefined && rustErrorEffectsEqual(actual, expected), true,
    "await adds exactly the uniform JsValue channel to its original eager effects, never an ambient local channel");
}

test("await branches retain the exact original source edge instead of adding an ambient local channel", () => {
  const current = fixture(sourceAwaitProgram, { surfaces: [] });
  requireNativeFuture(current, "consumer", "source-program");
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
  const current = fixture(genericReturnProgram, { surfaces: [] });
  requireNativeFuture(current, "consumer", "source-program");
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
  const current = fixture(lexicalReturnProgram, { surfaces: [] });
  requireNativeFuture(current, "consumer", "source-program");
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

test("direct native provider awaits consume their exact ABI without inventing authored body producers", () => {
  const current = fixture(`import { connect } from "@acme/db";
import type { int32 } from "@tsonic/core/types.js";
export async function run(path: string): Promise<int32> {
  const db = await connect(path);
  return await db.execute("native exact provider await");
}`, { packages: [acmeDbPackage()] });
  const awaits = current.nodes.filter(node => current.ast.is.IsAwaitExpression(node) &&
    current.context.records.targetOperation.get(Node_Expression(current.ast, node))?.kind === "provider-operation");
  assert.equal(awaits.length, 2, "both the original provider function and native receiver method are retained");
  for (const awaited of awaits) {
    const operand = Node_Expression(current.ast, awaited);
    const carrier = current.context.records.runtimeCarrier.get(operand)?.carrier;
    assert.equal(carrier !== undefined, true, "the original provider result has its exact native future carrier");
    const original = current.context.records.awaitSourceErrorEffects.get(awaited);
    assert.equal(original !== undefined && original.branches.length === 0, true,
      "a native provider ABI does not acquire a source-authored function error edge");
    let storageQueries = 0;
    const sourceStorage = { ...current.context.sourceStorage,
      subjectFor() {
        storageQueries += 1;
        return { kind: "unresolved", reason: "the inverse has no exact source producer" };
      },
    };
    const walk = { context: { ...current.context, sourceStorage } };
    const select = branch => {
      const budget = createRustEffectsWorkBudget();
      let selected;
      const failure = budget.run(() => {
        selected = selectRustAwaitSourceErrors(walk, operand, [branch],
          declaration => current.context.records.errorEffects.get(declaration),
          createRustSourceErrorEffectSelection(walk), budget);
      });
      assert.equal(failure === undefined, true, "the exact provider branch stays within the existing effects budget");
      return selected;
    };
    const selected = select(carrier);
    assert.equal(selected.kind === "resolved" && selected.branches.length === 0, true,
      "the existing validated native future ABI supplies the complete non-source ownership decision");
    assert.equal(storageQueries, 0, "no authored producer or caller activation is fabricated for an opaque native operation");
    const unrelated = rustFutureTargetType(rustSourcePrimitiveTargetType("bool"));
    assert.equal(rustTargetTypeRefEquals(unrelated, carrier), false, "the inverse changes the actual native future branch");
    assert.equal(select(unrelated).kind, "rejected", "a matching output alone cannot admit a foreign native future");
    assert.equal(storageQueries, 1, "only the unproved branch still requires its original source ownership evidence");
  }
});

test("await-source selection rejects an unrelated exact Future branch", () => {
  const pure = fixture(`
    export async function pure(): Promise<number> { return 7; }
    export async function consumer(): Promise<number> { return await pure(); }
    export async function immediate(): Promise<number> { return await 7; }
  `, { surfaces: [] });
  assertPureNativeAwait(pure, "consumer", "pure");
  assertCompletedValueAwait(pure, "immediate");
  for (const declaration of [pure.declaration("pure"), pure.declaration("consumer"), pure.declaration("immediate")])
    assert.deepEqual(pure.context.records.errorEffects.get(declaration), { localErrors: false, nativeErrors: [] });

  const current = fixture("", { files: nativeFutureFiles, surfaces: [] });
  const witnesses = current.nodes.filter(node => current.ast.is.IsAwaitExpression(node)).flatMap(node => {
    const value = current.context.records.awaitValue.get(node);
    const source = current.context.records.awaitSourceErrorEffects.get(node);
    assert.equal(value !== undefined && source !== undefined, true, "the admitted native fixture retains both complete await records");
    return source.branches.filter(branch => rustAwaitSelectionLeaves(value.selection).some(leaf =>
      leaf.future !== undefined && isRustNativeFutureCarrier(leaf.carrier) &&
      rustTargetTypeRefEquals(leaf.carrier, branch.carrier)))
      .map(channel => ({ node, channel }));
  });
  assert.equal(witnesses.length > 0, true,
    "the mismatch inverse requires an actual pending source-native Future from the existing supported fixture");
  const { node, channel } = witnesses[0];
  const operand = Node_Expression(current.ast, node);
  assert.equal(operand !== undefined, true);
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
  const selected = select([channel.carrier]);
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.branches.length, 1);
  const unrelated = rustFutureTargetType(rustSourcePrimitiveTargetType("bool"));
  assert.equal(rustTargetTypeRefEquals(unrelated, channel.carrier), false, "the inverse changes the actual native Future payload");
  assert.equal(select([unrelated]).kind, "rejected", "source error correspondence cannot attach to a different carrier");
});

test("pure source awaits stay pure while caught source errors retain inner correspondence", () => {
  const current = fixture(`
    export async function pure(): Promise<number> { return 7; }
    export async function success(): Promise<number> { return await pure(); }
    export async function immediate(): Promise<number> { return await 7; }
    export async function failure(callback: () => Promise<number>) { return await callback(); }
    export async function caught(callback: () => Promise<number>): Promise<number> {
      try { return await failure(callback); } catch { return 0; }
    }
  `, { surfaces: [] });
  assertPureNativeAwait(current, "success", "pure");
  assertCompletedValueAwait(current, "immediate");
  assert.deepEqual(current.context.records.errorEffects.get(current.declaration("pure")),
    { localErrors: false, nativeErrors: [] });
  requireNativeFuture(current, "caught", "source-program");
  assert.equal(current.fact("caught").branches[0].edge.nativeErrors.length, 2);
  assert.deepEqual(current.context.records.errorEffects.get(current.declaration("caught")),
    { localErrors: false, nativeErrors: [] });
  assert.equal(current.context.records.errorEffects.get(current.awaited("caught")).nativeErrors.length, 2);
});

test("awaiting a source package Future retains its actual RootFailure owner", () => {
  const current = fixture("", { files: rootFailureFiles, sourcePackages: sourcePackageCallbackErrorGraph, surfaces: [] });
  requireNativeFuture(current, "rootConsumer", "source-native");
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

for (const [name, source] of [
  ["stored source result", sourceAwaitProgram],
  ["generic synchronous return", genericReturnProgram],
  ["original lexical call", lexicalReturnProgram],
]) {
  test(`JS Promise ${name} retains its full uniform rejection carrier without a native source edge`, () => {
    assertUniformJsAwait(fixture(source, { surfaces: ["js"] }), "consumer");
  });
}

test("a JS Promise RootFailure result keeps uniform JsValue rejection instead of a per-producer native ABI", () => {
  const current = fixture("", { files: rootFailureFiles, sourcePackages: sourcePackageCallbackErrorGraph, surfaces: ["js"] });
  assertUniformJsAwait(current, "rootConsumer");
  const errors = current.context.records.errorEffects.get(current.awaited("rootConsumer"));
  const rejection = errors.nativeErrors.filter(error => error.identity === rustJsRejectionErrorIdentity);
  assert.equal(rejection.length, 1);
  assert.equal(rustTargetTypeRefEquals(rejection[0].errorType, rustJsValueTargetType()), true);
  assert.equal(rustProducerErrorReference(rejection[0].errorType) === undefined, true,
    "the actual JS object does not acquire a guessed RootFailure producer-error carrier");
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

test("completed native error channels retain their full correspondence through repeated transport", () => {
  const current = fixture(`
    export function source(callback: () => number): number { return callback(); }
    export function consumer(callback: () => number): number { return source(callback); }
  `);
  const declaration = current.declaration("source");
  const invocation = current.nodes.find(node => current.ast.is.IsCallExpression(node) &&
    current.ast.text(Node_Expression(current.ast, node)) === "source");
  assert.equal(invocation !== undefined, true, "the original checked invocation is retained");
  const effects = current.context.records.errorEffects.get(declaration);
  const selection = createRustSourceErrorEffectSelection({ context: current.context });
  const bindings = selection.bindingsFor(invocation, declaration, effects.nativeErrors.map(error => error.errorType));
  assert.equal(bindings !== undefined, true, "the original selected parameters supply the actual native bindings");
  const edge = selection.edgeFor(declaration, "invoke", effects, bindings);
  assert.equal(edge !== undefined && edge.nativeErrors.length === 1, true, "the real callback supplies one exact channel");
  const pending = edge.nativeErrors[0].target;
  const physical = current.context.callableValues.nativeStorage;
  const completed = selection.complete(pending, physical);
  assert.equal(completed !== undefined, true, "the canonical physical owner completes the original channel");
  assert.equal(selection.complete(pending, physical) === completed, true, "the original pending input retains its cached result");
  const transported = selection.complete(completed, physical);
  assert.equal(transported !== undefined && transported.identity === completed.identity &&
    rustTargetTypeRefEquals(transported.errorType, completed.errorType), true,
  "the owner's completed identity and full native carrier remain admissible together");
  const foreign = rustSourcePrimitiveTargetType("bool");
  assert.equal(rustTargetTypeRefEquals(foreign, pending.errorType), false, "the pending inverse changes its real native payload");
  assert.equal(rustTargetTypeRefEquals(foreign, completed.errorType), false, "the completed inverse changes its real native payload");
  assert.equal(selection.complete({ ...pending, errorType: foreign }, physical) === undefined, true,
    "a cached pending identity never authorizes a contradictory native payload");
  assert.equal(selection.complete({ ...completed, errorType: foreign }, physical) === undefined, true,
    "a completed identity never authorizes a contradictory native payload");
});

for (const [name, files] of [
  ["original finite lexical sequencing", { "index.ts": finiteCompletionSequencingSource }],
  ["original closed native async callables", nativeFutureFiles],
]) {
  test(`${name} publishes the identical completed native await error identity`, () => {
    const current = fixture("", { files, surfaces: [] });
    let channels = 0;
    for (const expression of current.nodes.filter(node => current.ast.is.IsAwaitExpression(node))) {
      const selected = current.context.records.awaitValue.get(expression);
      assert.equal(selected !== undefined, true, name + ": every original await is admitted");
      const effects = current.context.records.errorEffects.get(expression);
      for (const leaf of rustAwaitSelectionLeaves(selected.selection)) {
        const future = leaf.future;
        if (future?.errorBoundary !== "source-native") continue;
        channels += 1;
        assert.equal(effects?.nativeErrors.some(error => error.identity === future.errorSource &&
          rustTargetTypeRefEquals(error.errorType, future.errorCarrier)), true,
        name + ": immutable await and completed source effects retain the same full native channel");
      }
    }
    assert.equal(channels > 0, true, name + ": the actual native callable await channels are exercised");
  });
}

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
