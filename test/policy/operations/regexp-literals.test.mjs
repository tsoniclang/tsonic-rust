import assert from "node:assert/strict";
import test from "node:test";
import { selectRustRegularExpressionLiteral } from "../../../dist/policy/operations/syntax/regexp-literal.js";
import { resolveRegExpCreation } from "../../../dist/analysis/expressions/regexp.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

test("RegExp literal policy retains the complete native operation, pattern, flags and carrier", () => {
  for (const [pattern, flags] of [["provider[/-]pattern", "im"], ["(?<=prefix)(?<word>\\p{Letter}+)", "dgu"],
    ["[\\p{ASCII}&&\\p{Letter}]", "v"]]) {
    const selected = selectRustRegularExpressionLiteral(pattern, flags);
    assert.deepEqual(selected.operation, { kind: "regexp-create", operationId: "tsonic.rust.js.regexp.create", pattern, flags });
    assert.deepEqual(selected.targetType, { kind: "target-named", id: "rust.js.JsRegExp" });
    assert.equal(Object.isFrozen(selected), true);
    assert.equal(Object.isFrozen(selected.operation), true);
    assert.equal(Object.isFrozen(selected.targetType), true);
  }
});

test("source regexp admission publishes only on the explicit JS profile and preserves canonical identity", () => {
  for (const jsEnabled of [false, true]) {
    const records = createRustProgramRecordBuilder();
    const subject = {};
    const other = {};
    const carrier = resolveRegExpCreation({ jsEnabled, context: { records } }, subject, "(?<word>a)[/-]", "gu");
    if (!jsEnabled) {
      assert.equal(carrier === undefined, true, "native source profile has no regexp admission");
      assert.equal(records.targetOperation.get(subject) === undefined, true);
      assert.equal(records.runtimeCarrier.get(subject) === undefined, true);
    } else {
      assert.equal(carrier === records.runtimeCarrier.get(subject)?.carrier, true, "canonical recorded carrier returned");
      assert.deepEqual(records.targetOperation.get(subject), { kind: "regexp-create",
        operationId: "tsonic.rust.js.regexp.create", pattern: "(?<word>a)[/-]", flags: "gu" });
      assert.deepEqual(carrier, { kind: "target-named", id: "rust.js.JsRegExp" });
    }
    assert.equal(records.targetOperation.get(other) === undefined, true, "source subjects are not matched by shape");
    assert.equal(records.runtimeCarrier.get(other) === undefined, true);
  }
});

test("checked regexp literal syntax reaches the one native form and exact source records", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts":
    "export function sample(value: string): boolean { return /(?<word>a)[/-]/gu.test(value); }" } });
  const nodes = [];
  const collect = node => {
    if (program.source.ast.kindName(node) === "KindRegularExpressionLiteral") nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
  };
  for (const file of program.sourceFiles) collect(file);
  assert.equal(nodes.length, 1);
  const operation = program.records.targetOperation.get(nodes[0]);
  assert.deepEqual(operation, { kind: "regexp-create", operationId: "tsonic.rust.js.regexp.create",
    pattern: "(?<word>a)[/-]", flags: "gu" });
  assert.deepEqual(program.records.runtimeCarrier.get(nodes[0])?.carrier, { kind: "target-named", id: "rust.js.JsRegExp" });
});
