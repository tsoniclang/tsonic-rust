import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { prepareRustNativeCallableGenericContexts } from "../../../dist/analysis/callables/native-inputs.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { retainedPointerInputSource } from "../../../../tsonic/test/fixtures/retained-pointer-inputs.mjs";

for (const [name, source] of [
  ["formals, generic functions, methods and suspended functions", `
    export function invoke(action: () => number): number { return action(); }
    export function identity<T>(value: T): T { return value; }
    export class Counter { value(): number { return 1; } }
    export function* values(value: number): Generator<number, number, number> {
      const next: number = yield value;
      return next;
    }
  `],
  ["retained and forwarded native inputs", retainedPointerInputSource],
]) {
  test(`native generic contexts publish original-owner data before source revocation: ${name}`, () => {
    const { program } = analyzeRust({ files: { "index.ts": source } });
    const owners = program.callableValues.nativeProducers.producers;
    assert.equal(owners.length > 0, true, "checked concrete callable owners exist");
    const guarded = [];
    const guard = value => {
      const selected = Proxy.revocable(value, {});
      guarded.push(selected);
      return selected.proxy;
    };
    const result = prepareRustNativeCallableGenericContexts({
      ast: guard(program.source.ast), records: guard(program.records),
      native: guard(program.callableValues.native),
      nativeStorage: guard(program.callableValues.nativeStorage),
      nativeProducers: guard(program.callableValues.nativeProducers),
      nativeGenericProducers: guard(program.callableValues.nativeGenericProducers),
      retainedCallableInputs: guard(program.retainedCallableInputs),
      declarationGenericRequirements: guard(program.declarationGenericRequirements),
    });
    assert.equal(result.kind, "resolved", "the same completed checked inputs admit the same context");
    const expected = owners.map(({ declaration }) => ({ declaration,
      original: program.callableValues.nativeGenericContexts.get(declaration),
      actual: result.value.get(declaration) }));
    for (const selected of guarded) selected.revoke();
    assert.equal(Object.isFrozen(result.value), true, "the published context index is immutable");
    assert.equal("set" in result.value, false, "publication exposes no writer");
    assert.equal(result.value.get({}) === undefined, true, "foreign nodes cannot inherit a context");
    for (const { declaration, original, actual } of expected) {
      assert.equal(original !== undefined && actual !== undefined, true, "every original emitted owner is covered");
      assert.equal(result.value.get(declaration) === actual, true, "post-revocation access is the same stored value");
      assert.equal(Object.isFrozen(actual) && Object.isFrozen(actual.inputs) && Object.isFrozen(actual.implicitLifetimes), true,
        "published vectors and their context are frozen");
      assert.equal(actual.sourceRequirements === original.sourceRequirements, true, "source requirements retain their exact final identity");
      assert.equal(actual.bodyRequirements === original.bodyRequirements, true, "native-body requirements retain their exact final identity");
      assert.equal(actual.implicitLifetimes.length, original.implicitLifetimes.length, "the same native lifetime parameters are retained");
      for (const [index, lifetime] of actual.implicitLifetimes.entries()) {
        const prior = original.implicitLifetimes[index];
        assert.equal(lifetime.declaration === prior.declaration && lifetime.kind === prior.kind &&
          lifetime.sourceName === prior.sourceName && lifetime.lifetime === prior.lifetime, true,
        "each lifetime retains its original checked owner and exact native lifetime");
      }
      assert.equal(actual.inputs.length, original.inputs.length, "native input order and cardinality are unchanged");
      for (const [index, input] of actual.inputs.entries()) {
        const prior = original.inputs[index];
        assert.equal(Object.isFrozen(input) && Object.isFrozen(input.traits), true, "input and ordered trait evidence are immutable");
        assert.equal(input.implementation === prior.implementation, true, "native implementation identity is not reconstructed");
        assert.equal(input.traits.length, prior.traits.length, "trait requirements preserve their complete cardinality");
        for (const [traitIndex, trait] of input.traits.entries())
          assert.equal(trait === prior.traits[traitIndex], true, "each trait is the exact selected native carrier");
        assert.equal((input.retained === undefined) === (prior.retained === undefined), true, "retained absence is explicit and unchanged");
        if (input.retained !== undefined) {
          assert.equal(Object.isFrozen(input.retained), true, "retained error evidence is frozen");
          assert.equal(rustTargetTypeRefEquals(input.retained.error, prior.retained.error), true, "the exact invocation error carrier is retained");
          assert.equal(input.retained.targets === prior.retained.targets, true, "the original final retained target vector is preserved");
        }
      }
    }
  });
}
