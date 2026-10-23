import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";

function generator(text) {
  const context = analyzeRustErrorEffects(text, { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "values");
  assert.equal(declaration !== undefined, true, "the checked source generator retains its original declaration");
  const selected = context.records.generator.get(declaration);
  assert.equal(selected !== undefined, true, "the sole source producer publishes its required reentry selection");
  return selected;
}

test("a generator object captured by its own body may reenter", () => {
  const selected = generator(`let current: Generator<number, void, unknown> | undefined;
function* values(): Generator<number, void, unknown> {
  if (current !== undefined) current.next();
  yield 1;
}
current = values();
current.next();`);
  assert.equal(selected.reentry, "possible", "same-object body access never receives the unreachable reentry policy");
});

test("a plain local generator iterated by for-of excludes reentry", () => {
  const selected = generator(`function* values(): Generator<number, void, unknown> { yield 1; }
for (const value of values()) { const observed = value + 1; }`);
  assert.equal(selected.reentry, "excluded", "a closed body with no object reads or unchecked exposure needs no runtime error channel");
  assert.equal(selected.resultCarrier.genericArguments.length, 3,
    "the source signature does not manufacture physical error or reentry parameters before their owner runs");
});

test("a generator receiver escaping to an unchecked boundary remains possible", () => {
  const selected = generator(`declare function opaque(value: Generator<number, void, unknown>): void;
function* values(): Generator<number, void, unknown> { yield 1; }
opaque(values());`);
  assert.equal(selected.reentry, "possible", "an unproven external receiver cannot be certified as nonreentrant");
});
