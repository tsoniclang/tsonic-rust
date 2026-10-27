import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { independentFrameAlternativesSource } from "../../../../tsonic/test/fixtures/independent-frame-alternatives.mjs";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createRustFrameCallablePlan } from "../../../dist/analysis/callables/values/frame-values.js";

test("native frame storage retains only counters required after construction", () => {
  const { program } = analyzeRust({ files: { "index.ts": independentFrameAlternativesSource } });
  const definitions = program.callableValues.frames.definitions;
  assert.equal(definitions.length, 3);
  const named = name => definitions.find(definition => program.names.nameForDeclaration(definition.activation.ownerDeclaration) === name);
  const value = named("Value");
  const replaced = named("Replaced");
  const rebinding = named("Rebinding");
  assert.equal(value !== undefined && replaced !== undefined && rebinding !== undefined, true, "three exact frame owners");
  assert.equal(program.callableValues.frames.counterNameFor(value), undefined);
  assert.equal(program.callableValues.frames.counterNameFor(replaced), undefined);
  assert.equal(program.callableValues.frames.counterNameFor(rebinding), rebinding.counterName);
});

test("native frame counters close once before source revocation and require original frame identities", () => {
  const { program, source: checked } = analyzeRust({ files: { "index.ts": independentFrameAlternativesSource } });
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, program.sourceFiles);
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const guarded = [];
  const guard = value => {
    const selected = Proxy.revocable(value, {});
    guarded.push(selected);
    return selected.proxy;
  };
  const frames = createRustFrameCallablePlan({ ast: guard(program.source.ast), records: guard(program.records),
    frameBindingCarriers: new Map(program.callableValues.frames.definitions.flatMap(definition => definition.bindings
      .filter(binding => definition.activation.slotDeclarations.includes(binding.declaration))
      .map(binding => [binding.declaration, binding.carrier]))),
    ownership: guard(program.callableOwnership), sourceStorage: guard(storage), nativeNodes: nodes, usedNames: new Set(),
    navigation: guard(source.navigation), projectTypes: guard(program.projectTypes),
    objectRepresentations: guard(program.objectRepresentations) });
  assert.equal(frames.definitions.length, 3, "the same three checked native frame owners");
  assert.throws(() => frames.counterNameFor(frames.definitions[0]), {
    message: "Native frame counter decisions require finalized construction plans before publication.",
  });
  const constructions = program.projectTypes.definitions.flatMap(definition => {
    const plan = program.projectConstructions.forDefinition(definition);
    return plan === undefined ? [] : [guard(plan)];
  });
  const sealed = frames.sealCounters(constructions);
  const expected = frames.definitions.map(definition => ({ definition, counter: sealed.counterNameFor(definition) }));
  assert.equal("sealCounters" in sealed, false, "construction authority is absent from the published plan");
  for (const selected of guarded) selected.revoke();
  assert.equal(frames.sealCounters(constructions) === sealed, true, "a second seal returns the original complete plan without recomputing");
  for (const { definition, counter } of expected) {
    assert.equal(sealed.counterNameFor(definition), counter, "an exact original frame has its same stored decision after all input revocation");
    assert.equal(sealed.definitions.includes(definition), true, "publication preserves original frame definition identity");
    assert.throws(() => sealed.counterNameFor({ ...definition }), {
      message: "A native frame counter lookup requires its exact original sealed frame definition.",
    });
  }
});
