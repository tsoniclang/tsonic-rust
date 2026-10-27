import assert from "node:assert/strict";
import test from "node:test";
import { createRustComputedMemberProducer } from "../../../dist/analysis/program/records/objects/computed-member.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { recordRustComputedCallEvaluation } from "../../../dist/analysis/operations/computed-members.js";

const ast = { kindName: node => node.kind };

test("a complete computed-member query admits once and returns its canonical evidence", () => {
  let guards = 0;
  const producer = createRustComputedMemberProducer(() => { guards += 1; });
  const expression = {};
  const receiver = {};
  const key = { kind: "KindCallExpression" };
  const first = producer.evaluate(ast, expression, receiver, key, "read", false);
  assert.equal(guards, 2, "query and first private admission each guard the open transaction");
  assert.equal(first === producer.records.get(expression), true, "the returned evidence is canonical");
  assert.equal(producer.evaluate(ast, expression, receiver, key, "read", false) === first, true);
  assert.equal(guards, 3, "a repeated complete request never invokes private admission");
  const foreign = producer.evaluate(ast, {}, receiver, key, "read", false);
  assert.equal(foreign === first, false, "equal-looking foreign subjects remain distinct");
  assert.equal(guards, 5);
});

for (const callFirst of [false, true]) {
  test(`computed ${callFirst ? "call" : "element"}-first consumers share one canonical decision`, () => {
    const builder = createRustProgramRecordBuilder();
    const expression = {};
    const receiver = {};
    const key = { kind: "KindCallExpression" };
    const source = { sourceCalleeAccess: { kind: "element", expression,
      receiver: { expression: receiver }, argument: { expression: key } } };
    const call = () => recordRustComputedCallEvaluation(ast, builder, [], source, expression, false);
    const element = () => builder.computedMembers.evaluate(ast, expression, receiver, key, "read", false);
    if (callFirst) call();
    else element();
    const canonical = builder.computedMember.get(expression);
    assert.equal(call() === key, true);
    assert.equal(element() === canonical, true);
    assert.equal(builder.computedMember.get(expression) === canonical, true);
    assert.equal(canonical.evaluateReceiver, false);
    assert.equal(canonical.evaluateKey, true);
  });
}

test("inherited and live-parent computed evidence needs no child admission", () => {
  const parent = createRustComputedMemberProducer(() => {});
  let guards = 0;
  const child = createRustComputedMemberProducer(() => { guards += 1; }, parent.records);
  const receiver = {};
  const key = { kind: "KindStringLiteral" };
  for (const expression of [{}, {}]) {
    const canonical = parent.evaluate(ast, expression, receiver, key, "read");
    assert.equal(child.evaluate(ast, expression, receiver, key, "read") === canonical, true);
  }
  assert.equal(guards, 2, "only the query guard runs for each inherited complete request");
  const childOnly = {};
  child.evaluate(ast, childOnly, receiver, key, "read");
  assert.equal(parent.records.get(childOnly) === undefined, true);
});

test("closed computed-call queries reject before examining either source or AST metadata", () => {
  const builder = createRustProgramRecordBuilder();
  const expression = {};
  const key = { kind: "KindCallExpression" };
  builder.computedMembers.evaluate(ast, expression, {}, key, "read");
  builder.seal([]);
  let reads = 0;
  const unreadable = new Proxy({}, { get() { reads += 1; throw new Error("unexpected metadata read"); } });
  assert.throws(() => recordRustComputedCallEvaluation(unreadable, builder, [], unreadable, expression, true), /sealed/u);
  assert.throws(() => recordRustComputedCallEvaluation(unreadable, builder, [], undefined, expression, true), /sealed/u);
  assert.throws(() => builder.computedMembers.evaluate(unreadable, expression, {}, key, "read"), /sealed/u);
  assert.equal(reads, 0);
});
