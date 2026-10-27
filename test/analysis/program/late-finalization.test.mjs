import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { recordFallibilityFacts } from "../../../dist/analysis/errors/fallibility.js";
import { recordResourceManagementFacts } from "../../../dist/analysis/control-flow/resource-management.js";
import { recordFutureValueFacts } from "../../../dist/analysis/callables/async/suspension.js";
import { recordRustDeferredProducerEffects } from "../../../dist/analysis/errors/deferred-producer-effects.js";
import { recordMethodSelfModeFacts } from "../../../dist/analysis/declarations/project-types.js";

for (const [name, invoke] of [
  ["carrier probe", walk => createRustCarrierProbe(walk)],
  ["fallibility", walk => recordFallibilityFacts(walk, [], { spawns: [], owners: [], calls: [], entries: [] }, NaN)],
  ["resource management", walk => recordResourceManagementFacts(walk, [])],
  ["future values", walk => recordFutureValueFacts(walk, [])],
  ["deferred producer effects", walk => recordRustDeferredProducerEffects(walk)],
  ["method receivers", walk => recordMethodSelfModeFacts(walk, [])],
]) test(`${name} rejects sealed analysis before source, metadata or empty-input inspection`, () => {
  const records = createRustProgramRecordBuilder();
  records.seal([]);
  let reads = 0;
  const context = { records };
  for (const property of ["ast", "typeDefinitions", "sourceStorage", "callableValues"]) {
    Object.defineProperty(context, property, { get() { reads++; throw new Error(`unexpected ${property} read`); } });
  }
  assert.throws(() => invoke({ context }), /after analysis is sealed/u);
  assert.equal(reads, 0, "the owning lifecycle boundary precedes every caller-controlled query");
});
