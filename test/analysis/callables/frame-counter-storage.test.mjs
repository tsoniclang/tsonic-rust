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
});
