import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
  sourceCharCodeUnit,
} from "../../../../dist/target-model/syntax/literals.js";
import { selectedIntegerLiteralUnionJoin, selectedSourceLiteralIsRepresentable } from "../../../../dist/policy/types/resolution/selected-numeric-literal.js";
import { checkedSource, projectSourceFile } from "../../../../../tsonic/test/fixtures/source-navigation.mjs";
import { rustUnionLeaves } from "../../../../dist/target-model/types/union-relations.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustSourcePrimitiveTargetType, rustSourceUnionTargetType, rustOptionTargetType } from "../../../../dist/target-model/types/index.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

test("floating literal selection shares source token parsing without broadening selected source forms", async () => {
  const cases = [
    ["1_000", true], ["0xFF_FF", true], ["0b1010_0101", true], ["1e3", true],
    ["-1_000", true], ["+0.5", true], ["-0", true], ["1e9999", false],
    ["(1)", false], ["-(+1)", false], ["1n", false], ["\"1\"", false],
  ];
  const source = await checkedSource("selected-floating-literal-text", { "src/index.ts":
    cases.map(([text], index) => `export const value${index} = ${text};`).join("\n") });
  const initializers = [];
  const visit = node => {
    if (source.ast.is.IsVariableDeclaration(node)) {
      const initializer = source.ast.as.AsVariableDeclaration(node)?.Initializer;
      if (initializer !== undefined) initializers.push(initializer);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(projectSourceFile(source, "src/index.ts"));
  assert.equal(initializers.length, cases.length, "each checked source initializer is observed");
  for (const [index, initializer] of initializers.entries()) {
    for (const primitive of ["float32", "float64"]) {
      assert.equal(selectedSourceLiteralIsRepresentable(initializer, primitive, source.ast), cases[index][1],
        `${primitive}: ${cases[index][0]}`);
    }
  }
});

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

function literalSelection(text, rows, carrier) {
  const node = { ...fakeStatement({ kindName: text.endsWith("n") ? "KindBigIntLiteral" : "KindNumericLiteral",
    end: text.length }), text };
  const sourceFile = fakeSourceFile({ text, statements: [node] });
  const ast = fakeAstReader([sourceFile]);
  const literalAst = { ...ast, is: { ...ast.is, IsPrefixUnaryExpression: () => false },
    authoredRange: () => ({ kind: "authored", start: 0, end: text.length }) };
  const definitions = { programErrorOrigin: () => undefined, sourceUnionVariants: value => [...rows].find(([key]) => rustTargetTypeRefEquals(key, value))?.[1] };
  return selectedIntegerLiteralUnionJoin(node, carrier, literalAst, definitions);
}

test("integer union literal selection preserves one exact native payload and absence", () => {
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Value");
  const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
  const integer = rustSourcePrimitiveTargetType("int32");
  const flag = rustSourcePrimitiveTargetType("bool");
  const rows = new Map([[carrier, [{ name: "Nested", carrier: inner }, { name: "Flag", carrier: flag }]],
    [inner, [{ name: "Integer", carrier: integer }]]]);
  assert.deepEqual(literalSelection("7", rows, carrier), integer);
  assert.deepEqual(literalSelection("7", rows, { ...rustOptionTargetType(carrier), sourceAbsence: true }), integer);
  assert.equal(literalSelection("7", rows, rustOptionTargetType(carrier)), undefined,
    "an explicit native Option is not an implicit source absence carrier");
  assert.deepEqual(literalSelection("2147483648", rows, carrier), rustSourcePrimitiveTargetType("int64"));
  assert.equal(literalSelection("1.5", rows, carrier), undefined);
  rows.set(inner, [{ name: "Integer", carrier: rustSourcePrimitiveTargetType("uint64") }]);
  assert.deepEqual(literalSelection("9007199254740993n", rows, carrier), rustSourcePrimitiveTargetType("uint64"));
});

test("integer union literal selection rejects ambiguous widths, floating payloads and invalid graphs", () => {
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Value");
  const integer = rustSourcePrimitiveTargetType("int32");
  for (const name of ["int64", "uint32", "float32", "float64"]) {
    const rows = new Map([[carrier, [{ name: "Integer", carrier: integer },
      { name: "Other", carrier: rustSourcePrimitiveTargetType(name) }]]]);
    assert.equal(literalSelection("7", rows, carrier), undefined, `distinct ${name} is not guessed`);
  }
  assert.equal(literalSelection("7", new Map(), carrier), undefined);
  assert.equal(literalSelection("7", new Map([[carrier, [{ name: "Self", carrier }]]]), carrier), undefined);
  const rows = new Map([[carrier, [{ name: "Integer", carrier: rustSourcePrimitiveTargetType("uint128") }]]]);
  assert.equal(literalSelection("340282366920938463463374607431768211456n", rows, carrier), undefined);
});

test("the canonical union reader rejects excessive depth and breadth without partial selection", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const carriers = Array.from({ length: 130 }, (_unused, index) => rustSourceUnionTargetType("/src/index.ts", `Layer${index}`));
  const rows = new Map(carriers.map((carrier, index) => [carrier,
    [{ name: "Next", carrier: carriers[index + 1] ?? integer }]]));
  const definitions = { programErrorOrigin: () => undefined, sourceUnionVariants: value => rows.get(value) };
  assert.equal(rustUnionLeaves(carriers[0], definitions), undefined);
  assert.equal(literalSelection("7", rows, carriers[0]), undefined);
  rows.set(carriers[0], Array.from({ length: 4096 }, (_unused, index) => ({ name: `Value${index}`, carrier: integer })));
  assert.equal(rustUnionLeaves(carriers[0], definitions), undefined);
  assert.equal(literalSelection("7", rows, carriers[0]), undefined);
  rows.set(carriers[0], [{ name: "Value", carrier: integer }]);
  assert.equal(rustUnionLeaves(carriers[0], definitions).length, 1);
});
