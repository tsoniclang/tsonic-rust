import assert from "node:assert/strict";
import test from "node:test";
import { planRustScopedStringComparison } from "../../../../dist/backend/planner/expressions/scoped-comparisons.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

// Selection is analysis-owned (test/analysis/expressions/native-scoped-string-comparisons.test.mjs); the planner
// borrows the selected field once and compares its str view without cloning or allocating.
const node = {};
const field = {};

function plan(selected, withRead = true) {
  let projected = 0;
  const location = { bindings: [], read: { kind: "path", path: "snapshot" },
    ...(withRead ? { withRead: project => { projected += 1; return project({ kind: "path", path: "borrowed" }); } } : {}) };
  const context = { input: { program: { records: {
    nativeComparison: { get: subject => subject === node ? selected : undefined },
    sourceBinding: { get: () => undefined },
  } } }, diagnostics: [], usedAliases: new Set(), valueFieldLocations: new Map([[field, location]]) };
  return { planned: planRustScopedStringComparison(node, context), projected: () => projected };
}

test("scoped native string comparisons preserve exact borrow and literal boundaries", () => {
  for (const [value, reversed, operator, pattern] of [
    ["abc", false, "==", /borrowed\.as_str\(\) == "abc"/u],
    ["abc", true, "==", /"abc" == borrowed\.as_str\(\)/u],
    ["abc", false, "!=", /borrowed\.as_str\(\) != "abc"/u],
    ["", false, "==", /borrowed\.as_str\(\)\.is_empty\(\)/u],
    ["", true, "!=", /!borrowed\.as_str\(\)\.is_empty\(\)/u],
  ]) {
    const { planned, projected } = plan({ kind: "scoped-string", field, value, reversed, operator });
    assert.equal(projected(), 1, "one scoped read");
    const printed = printRustExpr(planned);
    assert.doesNotMatch(printed, /clone|String::|Box::|Rc::/u);
    assert.match(printed, pattern);
  }
  assert.equal(plan({ kind: "ordinary" }).planned, undefined, "an ordinary comparison is not scoped");
  assert.throws(() => plan({ kind: "scoped-string", field, value: "abc", reversed: false, operator: "==" }, false),
    /exact native field borrow/u, "an owned read cannot claim a scoped borrow");
});
