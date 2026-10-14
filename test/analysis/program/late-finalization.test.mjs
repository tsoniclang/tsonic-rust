import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { recordFallibilityFacts } from "../../../dist/analysis/resources/fallibility.js";
import { recordResourceManagementFacts, recordFutureValueFacts } from "../../../dist/analysis/resources/suspension.js";
import { recordRustDeferredProducerEffects } from "../../../dist/analysis/resources/deferred-producer-effects.js";
import { recordMethodSelfModeFacts } from "../../../dist/analysis/declarations/project-types.js";

for (const [name, invoke] of [
  ["carrier probe", walk => createRustCarrierProbe(walk)],
  ["fallibility", walk => recordFallibilityFacts(walk, [], NaN)],
  ["resource management", walk => recordResourceManagementFacts(walk, [])],
  ["future values", walk => recordFutureValueFacts(walk, [])],
  ["deferred producer effects", walk => recordRustDeferredProducerEffects(walk)],
  ["method receivers", walk => recordMethodSelfModeFacts(walk, [])],
]) test(`${name} rejects sealed analysis before source, metadata or empty-input inspection`, () => {
  const records = createRustProgramRecordBuilder();
  records.seal();
  let reads = 0;
  const context = { records };
  for (const property of ["ast", "typeDefinitions", "sourceStorage", "callableValues"]) {
    Object.defineProperty(context, property, { get() { reads++; throw new Error(`unexpected ${property} read`); } });
  }
  assert.throws(() => invoke({ context }), /after analysis is sealed/u);
  assert.equal(reads, 0, "the owning lifecycle boundary precedes every caller-controlled query");
});
