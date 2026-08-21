import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
  sourceCharCodeUnit,
} from "../../../dist/target-model/syntax/literals.js";

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

test("source char code units preserve the exact neutral UTF-16 contract", () => {
  assert.equal(sourceCharCodeUnit("A"), 65);
  assert.equal(sourceCharCodeUnit("\ud800"), 0xd800);
  assert.equal(sourceCharCodeUnit(""), undefined);
  assert.equal(sourceCharCodeUnit("ab"), undefined);
  assert.equal(sourceCharCodeUnit("😀"), undefined);
});
