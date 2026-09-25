import assert from "node:assert/strict";
import test from "node:test";
import { withProjectionGenericParameters, requireSourceGenericName } from "../../../../dist/providers/native/projection/utilities.js";

const parameter = (identity, name) => ({ kind: "type", name,
  identity: { itemId: identity, canonicalPath: ["example", identity] }, requirements: [], outlives: [], maybeSized: false });

test("source generic names preserve native identities through shadowing and repeated projection", () => {
  const owner = parameter("owner", "T");
  const method = parameter("method", "T");
  const initial = withProjectionGenericParameters({}, [owner]);
  const scoped = withProjectionGenericParameters(initial, [method]);
  assert.equal(requireSourceGenericName("owner", scoped), "T");
  assert.equal(requireSourceGenericName("method", scoped), "T_2");
  assert.equal(requireSourceGenericName("method", withProjectionGenericParameters(scoped, [method])), "T_2");
  assert.equal(initial.genericNames.has("method"), false);
  assert.throws(() => withProjectionGenericParameters(scoped, [parameter("method", "Other")]), /conflicting native names/u);
  assert.throws(() => requireSourceGenericName("missing", scoped), /no source-visible declaration/u);
  const deeper = withProjectionGenericParameters(scoped, [parameter("other", "T")]);
  assert.equal(requireSourceGenericName("other", deeper), "T_3");
});
