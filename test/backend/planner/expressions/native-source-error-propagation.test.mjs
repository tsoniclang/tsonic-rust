import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { planRustSourceErrorPropagation } from "../../../../dist/backend/planner/expressions/calls/source-errors.js";

// A source callable invoking a native callable input has a native error region (the input's associated error).
// A caller propagates that error unchanged when its region has the same single error, and through the joined
// region's variant when it has more than one.
const source = joined => `
import type { int32 } from "@tsonic/core/types.js";
function inner(first: () => int32): int32 { return first(); }
export function outer(first: () => int32, second: () => int32): int32 { return inner(first) + ${joined ? "second()" : "1"}; }
`;

function outerBody(joined) {
  const { result } = compileRust({ files: { "index.ts": source(joined) } });
  assert.deepEqual(result.diagnostics, []);
  const text = rustSourceText(result);
  const body = text.match(/pub fn outer<[\s\S]*?\n\}\n/u)?.[0];
  assert.equal(body !== undefined, true, "the native outer function is emitted");
  return body;
}

test("exact unchanged source errors propagate without an identity map closure", () => {
  const body = outerBody(false);
  assert.match(body, /inner\(&first\)\?/u, "the identical native error propagates through ?");
  assert.doesNotMatch(body, /map_err/u, "validated identical error payload needs no adapter");
});

test("a source error entering a real join retains the exact variant adapter", () => {
  const body = outerBody(true);
  assert.match(body, /inner\(&first\)\.map_err::<crate::index::NativeErrors2<[\s\S]*?>, _>\(\|source_error\| \{[\s\S]*?>::Error1\(source_error\)\s*\}\)\?/u);
});

test("equal native error types never bypass missing source correspondence", () => {
  const { program } = analyzeRust({ files: { "index.ts": source(false) } });
  const { ast } = program.source;
  let call;
  const visit = node => {
    if (ast.is.IsCallExpression(node) && program.records.sourceCall.get(node)?.errorEdge !== undefined) call = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(call !== undefined, true, "the inner call carries its declaration-to-caller error edge");
  const edge = program.records.sourceCall.get(call).errorEdge;
  assert.equal(edge.nativeErrors.length, 1);
  // The same error type from an unrelated producer identity has no sealed correspondence in the caller.
  const foreign = { ...edge, nativeErrors: [{ ...edge.nativeErrors[0],
    source: { ...edge.nativeErrors[0].source, identity: "foreign-producer" } }] };
  const context = rustSourceFilePlanContext(program, call);
  assert.throws(() => planRustSourceErrorPropagation(call, foreign, { kind: "call", path: "inner", args: [] }, context),
    failure => failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      failure.message === "An admitted source invocation requires its declaration-to-caller error channels in the active region.");
});
