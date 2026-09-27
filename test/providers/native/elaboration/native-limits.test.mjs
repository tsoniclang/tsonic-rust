import assert from "node:assert/strict";
import test from "node:test";
import { defaultRustNativeSourceLimits, validateRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/limits.js";
import { createRustNativeSourceTool } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { decodeNativeTokenResponse } from "../../../../dist/providers/native/elaboration/tokens.js";
import { nativeEvidenceFixture } from "./native-evidence-fixture.mjs";

const evidence = nativeEvidenceFixture();
const tokens = { kind: "tokens", protocolVersion: 1, tokens: [] };
const defaults = defaultRustNativeSourceLimits;
const ceilings = { maximumRows: 4_194_304, maximumDepth: 512,
  maximumOutputBytes: 256 * 1024 * 1024, timeoutMilliseconds: 3_600_000 };
const consumers = [
  ["validator", limits => validateRustNativeSourceLimits(limits)],
  ["factory", limits => createRustNativeSourceTool({ cacheRoot: "must-not-be-used", limits })],
  ["type decoder", limits => decodeNativeEvidence(evidence, limits)],
  ["token decoder", limits => decodeNativeTokenResponse(tokens, limits)],
];

test("native source finite defaults and exact supported ceilings share one contract", () => {
  assert.ok(Object.isFrozen(defaults));
  for (const limits of [defaults, ceilings, Object.fromEntries(Object.keys(ceilings).map(key => [key, 1]))]) {
    validateRustNativeSourceLimits(limits);
    if (limits.maximumRows === 1) assert.throws(() => decodeNativeEvidence(evidence, limits), /row limit/u);
    else assert.equal(decodeNativeEvidence(evidence, limits).phase, "declarations");
    assert.deepEqual(decodeNativeTokenResponse(tokens, limits), []);
  }
});

for (const [name, consume] of consumers) {
  test(`${name} rejects every malformed native-source budget field`, () => {
    for (const [field, ceiling] of Object.entries(ceilings)) {
      for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, ceiling + 1, "1", null, undefined]) {
        assert.throws(() => consume({ ...defaults, [field]: value }), /Native Rust source/u, `${field}=${value}`);
      }
      const incomplete = { ...defaults };
      delete incomplete[field];
      assert.throws(() => consume(incomplete), /Native Rust source/u);
    }
    for (const selection of [null, false, 1, "limit", [], {}, { ...defaults, unchecked: true }]) {
      assert.throws(() => consume(selection), /Native Rust source/u);
    }
  });
}

test("native decoders preserve independent row and depth limits", () => {
  const leaf = { kind: "identifier", text: "value", raw: false, source: { start: 2, end: 7 } };
  const response = { ...tokens, tokens: [{ kind: "group", delimiter: "parentheses", source: { start: 0, end: 9 },
    tokens: [{ kind: "group", delimiter: "brackets", source: { start: 1, end: 8 }, tokens: [leaf] }] }] };
  assert.throws(() => decodeNativeTokenResponse(response, { ...defaults, maximumRows: 2 }), /row limit/u);
  assert.throws(() => decodeNativeTokenResponse(response, { ...defaults, maximumDepth: 1 }), /depth limit/u);
  assert.equal(decodeNativeTokenResponse(response, { ...defaults, maximumRows: 3, maximumDepth: 2 }).length, 1);
  const twoTypes = { ...evidence, types: [
    { id: 0, value: { kind: "primitive", name: "u32" } },
    { id: 1, value: { kind: "primitive", name: "u64" } },
  ] };
  assert.throws(() => decodeNativeEvidence(twoTypes, { ...defaults, maximumRows: 1 }), /row limit/u);
  assert.equal(decodeNativeEvidence(twoTypes, defaults).types.length, 2);
});
