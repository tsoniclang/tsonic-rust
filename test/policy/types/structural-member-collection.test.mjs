import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { resolveStructuralObjectType } from "../../../dist/analysis/types/resolution/target.js";

function scenario(count) {
  const foreign = { kind: "KindClassDeclaration" };
  const symbol = {};
  const declarations = new Map([[symbol, [foreign]]]);
  const properties = [{ name: "unavailable", symbol, rootSymbols: [], type: {} }];
  let laterReads = 0;
  for (let index = 1; index < count; index++) {
    const nextSymbol = {};
    declarations.set(nextSymbol, [{ kind: "KindPropertySignature" }]);
    properties.push({ name: `field${index}`, symbol: nextSymbol, rootSymbols: [], get type() {
      laterReads++;
      assert.fail("a rejected record cannot derive a later field carrier");
    } });
  }
  let publications = 0;
  const context = {
    ast: { kindName: node => node.kind },
    source: { navigation: { isProjectDeclaration: () => true }, sourceFacts: { getFact: () => undefined } },
    records: createRustRecordFixture(),
    currentSemantics: {
      declarations: { typeSymbol: () => undefined, symbolDeclarations: selected => declarations.get(selected) ?? [] },
      types: {
        aliasApplication: () => undefined, indexInfos: () => [], isSymbolLike: () => false,
        constructSignatures: () => [], callSignatures: () => [], isIntersection: () => false,
        propertyInfos: () => properties,
      },
    },
  };
  const options = { sourceTypes: { registerStructuralObject() { publications++; return true; } } };
  return { context, options, counts: () => ({ laterReads, publications }) };
}

test("structural members stop at the first unavailable declaration without publishing a partial shape", () => {
  for (const count of [1, 3, 256]) {
    const { context, options, counts } = scenario(count);
    assert.equal(resolveStructuralObjectType({}, context, options, new Set()) === undefined, true, `closed rejection of ${count} fields`);
    assert.deepEqual(counts(), { laterReads: 0, publications: 0 });
  }
});
