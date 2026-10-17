import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { independentFrameAlternativesSource } from "../../../../tsonic/test/fixtures/independent-frame-alternatives.mjs";
import { rustRetainedFrameCounterName } from "../../../dist/analysis/callables/frame-counter-storage.js";

test("native frame storage retains only counters required after construction", () => {
  const { program } = analyzeRust({ files: { "index.ts": independentFrameAlternativesSource } });
  const definitions = program.callableValues.frames.definitions;
  assert.equal(definitions.length, 3);
  const named = name => definitions.find(definition => program.names.nameForDeclaration(definition.activation.ownerDeclaration) === name);
  const value = named("Value");
  const replaced = named("Replaced");
  const rebinding = named("Rebinding");
  assert.equal(value !== undefined && replaced !== undefined && rebinding !== undefined, true, "three exact frame owners");
  assert.equal(rustRetainedFrameCounterName(value, program), undefined);
  assert.equal(rustRetainedFrameCounterName(replaced, program), undefined);
  assert.equal(rustRetainedFrameCounterName(rebinding, program), rebinding.counterName);
  for (const definition of [value, replaced, rebinding]) {
    const owner = program.projectTypes.definitionForDeclaration(definition.activation.ownerDeclaration);
    const construction = program.projectConstructions.forDefinition(owner);
    assert.equal(construction.emission.frame === definition, true, "the existing construction owns its canonical frame");
    assert.equal(Object.isFrozen(construction.emission.counterDisposition), true, "the selected counter disposition is immutable");
    assert.equal(construction.emission.counterDisposition.kind,
      definition === rebinding ? "retained" : "construction-only", "the original three native storage decisions are unchanged");
    const noAst = { ...program, source: { get ast() { assert.fail("a published counter lookup cannot read source syntax"); } } };
    assert.equal(rustRetainedFrameCounterName(definition, noAst), definition === rebinding ? definition.counterName : undefined,
      "the final consumer reads the one pre-seal disposition without AST traversal");
    assert.throws(() => rustRetainedFrameCounterName({ ...definition }, program), /exact canonical frame definition/u,
      "an equal-looking foreign frame is not a canonical owner");
    assert.throws(() => rustRetainedFrameCounterName(definition, { ...program, callableValues: { ...program.callableValues,
      frames: { ...program.callableValues.frames, definitionForOwner: () => undefined },
    } }), /exact canonical frame definition/u, "a missing required frame is not retained by default");
    assert.throws(() => rustRetainedFrameCounterName(definition, { ...program, projectConstructions: {
      ...program.projectConstructions, forDefinition: () => undefined,
    } }), /exact completed construction owner/u, "a missing construction is not a retained-counter fallback");
    assert.throws(() => rustRetainedFrameCounterName(definition, { ...program, projectConstructions: {
      ...program.projectConstructions, forDefinition: () => ({ ...construction, emission: { ...construction.emission,
        frame: { ...definition },
      } }),
    } }), /exact completed construction owner/u, "a foreign construction cannot supply the same frame disposition");
  }
});
