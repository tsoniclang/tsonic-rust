import assert from "node:assert/strict";
import test from "node:test";
import { planRustScopedStringComparison } from "../../../../dist/backend/planner/expressions/scoped-comparisons.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { planProviderOperationExpression } from "../../../../dist/backend/planner/expressions/conversions.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { planRustErrorRegion } from "../../../../dist/backend/planner/program/error-regions.js";

// Selection is analysis-owned (test/analysis/operations/native-scoped-string-comparisons.test.mjs); the planner
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
    const { planned, projected } = plan({ kind: "scoped-string", source: { kind: "field", field }, value, reversed, operator });
    assert.equal(projected(), 1, "one scoped read");
    const printed = printRustExpr(planned);
    assert.doesNotMatch(printed, /clone|String::|Box::|Rc::/u);
    assert.match(printed, pattern);
  }
  assert.equal(plan({ kind: "ordinary" }).planned, undefined, "an ordinary comparison is not scoped");
  assert.throws(() => plan({ kind: "scoped-string", source: { kind: "field", field }, value: "abc", reversed: false, operator: "==" }, false),
    /exact native field borrow/u, "an owned read cannot claim a scoped borrow");
});

test("the canonical scoped provider consumes exactly once and propagates consumer failure", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function observed(values: readonly string[]): boolean { return values[0]! === "before"; }
` } });
  const { ast } = program.source;
  let selected;
  const visit = node => {
    const comparison = program.records.nativeComparison.get(node);
    if (comparison?.kind === "scoped-string" && comparison.source.kind === "provider") selected = comparison.source;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected !== undefined, true, "the real native program publishes its exact scoped source");
  for (const succeeds of [false, true]) {
    let calls = 0;
    const fileContext = rustSourceFilePlanContext(program, selected.node);
    const callable = sourceEnclosingCallable(selected.node, ast);
    assert.equal(callable !== undefined, true, "the original native index belongs to its real checked function");
    const region = planRustErrorRegion(callable, fileContext);
    assert.equal(region?.boundary !== undefined, true, "the original checked index conversion retains its real error region");
    const context = { ...fileContext, fallibleBoundary: region.boundary };
    const expression = planProviderOperationExpression(context, selected.operation, selected.receiver, selected.arguments, selected.node,
      { resultUse: "scoped", consume: value => {
        calls++;
        assert.equal(value.kind, "index", "the continuation receives the original native place, not a copied String");
        return succeeds ? { kind: "bool-literal", value: true } : undefined;
      } });
    assert.equal(calls, 1, "the consumer is invoked exactly once by the canonical provider renderer");
    assert.equal(expression === undefined, !succeeds, "a failed consumer cannot become an ordinary owned result");
    if (succeeds) assert.equal(printRustExpr(expression), "true", "the real consumed result is returned without a second lowering");
  }
});
