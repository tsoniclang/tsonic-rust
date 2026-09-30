import assert from "node:assert/strict";
import test from "node:test";
import { planRustFlowReadProjection } from "../../../../dist/backend/planner/expressions/flow-reads.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

test("optional native associated values move or borrow without inventing Clone, and reject an unproved owned copy", () => {
  const selectedCarrier = { kind: "associated-type", owner: { kind: "type-parameter", identity: "Owner", name: "Owner" },
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] },
    name: "Output",
  };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const fact = { kind: "option-value", sourceCarrier, selectedCarrier };
  const node = {};
  for (const [canMove, borrowedResult, succeeds] of [[true, false, true], [false, true, true], [false, false, false]]) {
    const diagnostics = [];
    const result = planRustFlowReadProjection(node, { kind: "path", path: "value" }, fact, {
      input: { program: {
        facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
        valueLifetimes: { canMove: () => canMove }, typeDefinitions: emptyRustTypeDefinitions,
        source: { ast: { getFileName: () => "", getSourceText: () => "", pos: () => -1, end: () => -1, kindName: () => "KindIdentifier" } },
      } }, diagnostics, syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() },
    }, borrowedResult);
    if (succeeds) {
      assert.equal(result.kind, "match");
      assert.equal(result.arms[0].expression.kind, "path");
      assert.deepEqual(diagnostics, []);
    } else {
      assert.equal(result, undefined);
      assert.equal(diagnostics.length, 1);
      assert.match(diagnostics[0].message, /proven non-consuming clone contract/u);
    }
  }
});
