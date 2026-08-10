import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
} from "../dist/common/source-literal-values.js";

test("source integer literal parsing preserves exact authored integer values", () => {
  assert.equal(parseSourceIntegerLiteral("9_007_199_254_740_991"), 9007199254740991n);
  assert.equal(parseSourceIntegerLiteral("0xFF_FF"), 65535n);
  assert.equal(parseSourceIntegerLiteral("0o7_7"), 63n);
  assert.equal(parseSourceIntegerLiteral("0b10_10"), 10n);
  assert.equal(parseSourceIntegerLiteral("1.5"), undefined);
});

test("source bigint literal parsing requires and removes the bigint suffix", () => {
  assert.equal(parseSourceBigIntLiteral("123_456n"), 123456n);
  assert.equal(parseSourceBigIntLiteral("0xFFn"), 255n);
  assert.equal(parseSourceBigIntLiteral("123"), undefined);
  assert.equal(parseSourceBigIntLiteral("not-a-bigint"), undefined);
});
