import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs } from "../../../dist/target-model/operations/finalized-inputs.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const sharedSource = `
export function shared(): number {
  const values = [1];
  const updated = values[0] += 2;
  return updated + values[0];
}
export function effects(values: number[]): number {
  let indexReads = 0;
  function index(): number { indexReads += 1; return 0; }
  const updated = values[index()] += values.push(7);
  return updated + values[0] + indexReads;
}
export function rebound(): number {
  let values = [1];
  const original = values;
  function index(): number { values = [9]; return 0; }
  const updated = values[index()] += 2;
  return updated + original[0] + values[0];
}
function make(): number[] { return [1]; }
export function fresh(): number {
  return make()[0] += 2;
}
`;

function indexedAssignments(program) {
  const selected = new Map();
  const ast = program.source.ast;
  const visit = (node, owner) => {
    const current = ast.is.IsFunctionDeclaration(node) ? ast.text(ast.name(node)) : owner;
    const plan = program.records.assignmentEvaluation.get(node);
    if (plan?.kind === "compound" && ast.is.IsElementAccessExpression(plan.left)) {
      selected.set(current, { node, plan });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child, current); });
  };
  program.sourceFiles.forEach(file => visit(file, undefined));
  return selected;
}

test("shared native compound receivers retain one identity through index, getter, RHS and setter", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": sharedSource } });
  const selected = indexedAssignments(program);
  assert.equal(selected.size, 4, "all real indexed compound source classes reach their one producer");
  for (const name of ["shared", "effects"]) {
    const { node, plan } = selected.get(name);
    const receiver = plan.operands.find(operand => operand.role === "receiver");
    const index = plan.operands.find(operand => operand.role === "index");
    assert.equal(receiver !== undefined && index !== undefined, true, `${name}: receiver and index are evaluated once`);
    assert.equal(receiver.node === Node_Expression(program.source.ast, plan.left), true,
      `${name}: the captured receiver is the actual checked source receiver`);
    assert.equal(index.node === ElementAccessExpression_ArgumentExpression(program.source.ast, plan.left), true,
      `${name}: the index retains its exact checked source and effects`);
    assert.equal(plan.operands[0] === receiver && plan.operands[1] === index, true,
      `${name}: native binding order remains receiver before index`);
    assert.equal(receiver.storage, "shared-reference", `${name}: native immutable receiver identity is not moved or cloned`);
    assert.equal(index.storage, "value", `${name}: the index is materialized rather than re-evaluated`);
    const read = program.records.readOwnership.get(receiver.node);
    assert.equal(read?.source.kind === "borrow" && !read.source.mutable, true,
      `${name}: the existing ownership producer selects the immutable native read`);
    assert.equal(read.borrowedAcross.has(index.node), true,
      `${name}: the existing proof preserves the native receiver through index evaluation`);
    assert.equal(read.borrowedAcross.has(plan.right), true,
      `${name}: the existing proof extends through RHS evaluation before the setter, not only the getter`);
    const getter = program.records.targetOperation.get(plan.left);
    const setter = program.records.compoundWrite.get(node);
    assert.equal(getter?.kind === "provider-operation" && setter?.kind === "runtime-set", true,
      `${name}: both actual native getter and setter are admitted`);
    for (const operation of [getter, setter]) {
      const receivers = rustFinalizedSourceInputs(operation.abi).filter(input => input.source.kind === "receiver");
      assert.equal(receivers.length > 0, true, `${name}: native ABI actually consumes the receiver`);
      assert.equal(receivers.every(input => input.mode === "ref" && input.conversion.kind === "identity" &&
        rustTargetTypeRefEquals(input.sourceCarrier, receiver.carrier)), true,
      `${name}: every native receiver input preserves the same exact immutable identity`);
    }
  }
  const rebound = selected.get("rebound");
  const reboundReceiver = rebound.plan.operands.find(operand => operand.role === "receiver");
  const reboundRead = program.records.readOwnership.get(reboundReceiver.node);
  assert.equal(reboundReceiver.storage, "value", "receiver rebinding keeps its real owned snapshot before the index");
  assert.equal(reboundRead?.source.kind, "clone", "the existing owner preserves the original shared object when its binding changes");
  const reboundIndex = rebound.plan.operands.find(operand => operand.role === "index");
  assert.equal(reboundRead.borrowedAcross.has(reboundIndex.node), false,
    "a changing source binding cannot borrow through the actual rebinding index evaluation");
  const fresh = selected.get("fresh");
  const freshReceiver = fresh.plan.operands.find(operand => operand.role === "receiver");
  assert.equal(freshReceiver.storage, "value", "an actual owned temporary remains alive through the complete assignment");
  assert.equal(program.records.readOwnership.get(freshReceiver.node)?.readsStorage, false,
    "a fresh result is not relabelled as an existing native borrowed place");
});

test("native mutable indexed places and scalar compound assignments retain their existing storage route", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function indexed(values: number[]): number {
  const updated = values[0] += 2;
  return updated + values[0];
}
export function scalar(): number { let value = 1; return value += 2; }
` } });
  const indexed = indexedAssignments(program).get("indexed");
  const receiver = indexed.plan.operands.find(operand => operand.role === "receiver");
  assert.equal(receiver?.storage, "direct-identifier", "native Vec writes keep their deferred direct mutable-place use");
  assert.equal(program.records.compoundWrite.get(indexed.node), undefined,
    "native indexed mutation is not given a fabricated runtime setter ABI");
  let scalar;
  const visit = node => {
    const plan = program.records.assignmentEvaluation.get(node);
    if (plan?.kind === "compound" && program.source.ast.is.IsIdentifier(plan.left)) scalar = plan;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(scalar?.operands.length, 0, "a scalar write does not gain synthetic receiver/index bindings");
});

for (const surfaces of [[], ["js"]]) {
  test(`compound acquisition retains one selected native place or real owning result (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Counter {
  value = 3n;
  static shared = 3n;
  get amount(): bigint { return this.value; }
  set amount(value: bigint) { this.value = value; }
}
export function indexed(values: bigint[]): bigint { return values[0] += values[0]; }
export function scalar(): number { let value = 1; return value += 2; }
export function local(): bigint { let value = 3n; return value += 2n; }
export function getter(value: Counter): bigint { return value.amount += 2n; }
export function staticValue(): bigint { return Counter.shared += 2n; }
function make(): bigint[] { return [3n]; }
export function fresh(): bigint { return make()[0] += 2n; }
export function nullable(value: number | undefined): number { return value ??= 2; }
` } });
    const ast = program.source.ast;
    const selected = new Map();
    let nullish;
    const visit = (node, owner) => {
      const current = ast.is.IsFunctionDeclaration(node) ? ast.text(ast.name(node)) : owner;
      const plan = program.records.assignmentEvaluation.get(node);
      if (plan?.kind === "compound") selected.set(current, { node, plan });
      if (plan?.kind === "nullish") nullish = plan;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child, current); });
    };
    program.sourceFiles.forEach(file => visit(file, undefined));
    assert.equal(selected.size, 6, "all actual direct, owning and temporary acquisition classes are retained");
    for (const name of ["indexed", "fresh", "scalar", "local", "getter", "staticValue"]) {
      const { node, plan } = selected.get(name);
      const direct = name === "scalar" || name === "local" || surfaces.length === 0 && (name === "indexed" || name === "fresh");
      assert.equal(plan.current.kind, direct ? "direct" : "value", `${name}: native places are distinct from real owning getter results`);
      assert.equal(Object.hasOwn(plan, "valueField"), false, `${name}: compound acquisition has no competing legacy flag`);
      assert.equal(Object.isFrozen(plan.current), true, `${name}: the exact acquisition is sealed data`);
      if (direct) assert.equal(plan.current.ownership === program.records.assignmentValue.get(node).previous, true,
        `${name}: acquisition carries the identical canonical previous-value record, not a second choice`);
      else assert.equal(Object.hasOwn(plan.current, "ownership"), false,
        `${name}: an owned getter result is not given an additional storage snapshot`);
    }
    assert.equal(nullish?.kind, "nullish", "the existing nullish source still reaches its real assignment producer");
    assert.equal(typeof nullish.valueField, "boolean", "nullish retains its actual field-location flag");
    assert.equal(Object.hasOwn(nullish, "current"), false, "nullish does not acquire a second compound-only representation");
  });
}
