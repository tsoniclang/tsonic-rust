import assert from "node:assert/strict";
import test from "node:test";
import { sourceMarkerFactKey } from "@tsonic/tsts";
import { resolveRustSourceMarker } from "../../../dist/analysis/source-evidence/types/resolution/markers.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";

test("finalized source evidence is fetched once on both present and absent paths without consulting native records", () => {
  const subject = {};
  for (const selected of [undefined, Object.freeze({ marker: "js-string" })]) {
    let reads = 0;
    const context = {
      ast: { kind: node => node === subject ? 1 : undefined },
      currentSemantics: { facts: { typeSubjects: () => [] } },
      source: { sourceFacts: { getFact(node, key) {
        assert.equal(node === subject, true, "exact source subject");
        assert.equal(key === sourceMarkerFactKey, true, "checker-owned source key");
        reads += 1;
        return selected;
      } } },
      records: createRustRecordFixture({ runtimeCarrier: {
        get: () => assert.fail("source marker evidence is not a native record"),
      } }),
    };
    assert.equal(resolveRustSourceMarker(subject, context), selected?.marker);
    assert.equal(reads, 1, "the finalized owner is queried once, including absence");
  }
});
