import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

import { rustBorrowedElementRead, rustBorrowPureProviderInputs } from "../../../dist/analysis/program/borrowed-element-purity.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { Node_Expression } from "@tsonic/target-api/source";

test("borrowed indexed reads require their own exact pure operation, not owned Clone purity", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function length(values: string[]): number { return values[0]!.length; }
  ` } });
  let receiver;
  let element;
  const visit = node => {
    if (source.ast.is.IsNonNullExpression(node)) receiver = node;
    if (source.ast.is.IsElementAccessExpression(node)) element = node;
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.ok(receiver);
  assert.ok(element);
  const operation = program.records.targetOperation.get(element);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(operation.abi.effects.evaluation, "observable");
  assert.deepEqual(operation.borrowedIndexOperation, { method: "borrow_number_element", evaluation: "pure" });
  assert.ok(Object.isFrozen(operation.borrowedIndexOperation));
  assert.equal(rustBorrowedElementRead(receiver, source.ast, program.records)?.method, "borrow_number_element");
  for (const replacement of [
    { ...operation, borrowedIndexOperation: undefined },
    { ...operation, borrowedIndexOperation: { evaluation: "pure" } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, extra: true } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, method: "" } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, evaluation: "observable" } },
    { ...operation, borrowedIndexOperation: { ...operation.borrowedIndexOperation, method: "read; mutate()" } },
    ...[{ safety: "requires-unsafe" }, { invocation: "fallible" }].map(effects => ({ ...operation,
      abi: { ...operation.abi, effects: { ...operation.abi.effects, ...effects } } })),
    { ...operation, abi: { ...operation.abi, result: { ...operation.abi.result, kind: "async" } } },
  ]) {
    const records = createRustRecordFixture({
targetOperation: { get: (subject) => {
    return subject === element
        ? replacement : program.records.targetOperation.get(subject);
} }}, program.records);
    assert.equal(rustBorrowedElementRead(receiver, source.ast, records), undefined);
  }
});

test("provider purity includes the evaluation-only receiver of an actual pure native read", () => {
  const carrier = { kind: "target-named", id: "r14.PureReceiver" };
  const nativeBool = { kind: "source-primitive", name: "bool" };
  const reference = { kind: "provider-ref", moduleSpecifier: "@r14/pure-receiver", exportName: "Receiver" };
  const provider = createRustProviderPackage({ id: "r14-pure-receiver", displayName: "Pure receiver", version: "1.0.0",
    modules: [{ moduleSpecifier: "@r14/pure-receiver", providerModuleId: "r14.pure-receiver", exports: [
      { id: "Receiver", name: "Receiver", kind: "interface", members: [
        { id: "Receiver.empty", name: "empty", kind: "property", readonly: true, type: { kind: "boolean" } },
      ] },
      { id: "open", name: "open", kind: "function", signatures: [{ id: "open()", parameters: [], returnType: reference }] },
    ] }], types: [{ exportId: "Receiver", targetCarrier: carrier }], carrierPaths: { "r14.PureReceiver": "String" }, crates: [],
    operations: [
      { exportId: "open", operationKind: "method", target: { form: "call", path: "String::new" }, resultCarrier: carrier },
      { exportId: "Receiver", memberId: "Receiver.empty", operationKind: "property",
        target: { form: "call", path: "bool::default" }, resultCarrier: nativeBool, evaluation: "pure" },
    ] });
  const { source, program } = analyzeRust({ surfaces: [], packages: [provider], files: { "index.ts": `
    import { open, type Receiver } from "@r14/pure-receiver";
    function selected(): Receiver { return open(); }
    export function observed(): boolean { return selected().empty; }
  ` } });
  let property;
  const visit = node => {
    if (source.ast.is.IsPropertyAccessExpression(node)) property = node;
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(property !== undefined, true, "the checked source contains its selected native read");
  const operation = program.records.targetOperation.get(property);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(operation.abi.sourceReceiver.disposition, "evaluation-only", "the real ABI retains the source-only receiver");
  const receiver = Node_Expression(source.ast, property);
  const inputs = rustBorrowPureProviderInputs(property, source.ast, program.records);
  assert.equal(inputs !== undefined, true, "the exact pure-provider input proof is available");
  assert.equal(inputs.length, 1, "the source-only receiver participates in purity");
  assert.equal(inputs[0] === receiver, true, "the effectful checked receiver identity is retained");
  assert.equal(program.sourceNavigation.expressionEffects(receiver).invokes, true,
    "the retained receiver carries the source invocation effect");
});
