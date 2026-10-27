import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/index.js";
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
  ["Promise source and native-body facets", `
    import type { int32 } from "@tsonic/core/types.js";
    import type { Life, Ref } from "@tsonic/rust/types.js";
    import { load } from "@tsonic/rust/lang.js";
    export async function read<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
      return load(value);
    }
  `],
  ["retained and forwarded native inputs", retainedPointerInputSource],
]) {
  test(`native generic contexts publish original-owner data before source revocation: ${name}`, () => {
    const guarded = [];
    const guard = value => {
      const selected = Proxy.revocable(value, {});
      guarded.push(selected);
      return selected.proxy;
    };
    let program;
    const compiled = compileRust({ files: { "index.ts": source }, compileTarget(request) {
      const analysis = analyzeRustAnalysisProgram({ ...request, input: { ...request.input, source: {
        ...request.input.source, ast: guard(request.input.source.ast),
        navigation: guard(request.input.source.navigation), semantics: guard(request.input.source.semantics),
      } } });
      if (analysis.kind === "rejected") return analysis;
      program = analysis.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    } });
    assert.equal(compiled.result.diagnostics.length, 0,
      `the real producer admits the complete checked fixture: ${JSON.stringify(compiled.result.diagnostics.slice(0, 8)
        .map(({ code, message }) => ({ code, message: message.slice(0, 512) })))}`);
    const nodes = [];
    const visit = node => { nodes.push(node); compiled.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
    visit(compiled.source.getSourceFile("/src/index.ts"));
    const owners = nodes.filter(node => program.records.nativeGenerics.get(node) !== undefined);
    assert.equal(owners.length > 0, true, "checked concrete callable owners exist");
    const reader = program.records.nativeGenerics;
    const expected = owners.map(declaration => ({ declaration, original: reader.get(declaration), actual: reader.get(declaration) }));
    const specializations = owners.flatMap(declaration => {
      const callable = program.records.callableDeclaration.get(declaration);
      return callable === undefined ? [] : [{ declaration, variants: callable.specializations }];
    });
    for (const selected of guarded) selected.revoke();
    assert.equal(Object.isFrozen(reader), true, "the published context index is immutable");
    assert.equal("set" in reader, false, "publication exposes no writer");
    assert.equal(reader.get({}) === undefined, true, "foreign nodes cannot inherit a context");
    for (const { declaration, variants } of specializations) {
      assert.equal(Object.isFrozen(variants), true, "the complete named specialization vector is frozen");
      assert.equal(program.records.callableDeclaration.get(declaration).specializations === variants, true,
        "the published specialization read never filters or allocates another vector");
      for (const variant of variants) assert.equal(Object.isFrozen(variant.targetTypeArguments), true,
        "each specialization retains its exact sealed native argument vector");
    }
    for (const { declaration, original, actual } of expected) {
      assert.equal(original !== undefined && actual !== undefined, true, "every original emitted owner is covered");
      assert.equal(reader.get(declaration) === actual, true, "post-revocation access is the same stored value");
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
